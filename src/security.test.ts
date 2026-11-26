import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { redactUrl } from "./lib/logger.js";

// Les requetes ci-dessous sont rejetees avant tout acces a la base (validation ou limite).

function build(t: { after: (fn: () => unknown) => void }, config: Partial<AppConfig>, logStream?: Writable) {
  const app = buildApp({
    logger: false,
    databaseCheck: async () => {},
    config,
    ...(logStream && { logStream }),
  });
  t.after(() => app.close());
  return app;
}

test("requests beyond the per-minute limit get 429 in the standard error format", async (t) => {
  const app = build(t, { rateLimitMax: 3 });
  const statuses: number[] = [];
  let last;
  for (let i = 0; i < 4; i++) {
    last = await app.inject({ method: "GET", url: "/zones/pas-un-uuid" });
    statuses.push(last.statusCode);
  }
  assert.deepEqual(statuses, [400, 400, 400, 429]);
  assert.equal(last!.json().error.code, "RATE_LIMITED");
  assert.match(last!.json().error.message, /limite de 3 par minute/);
  assert.ok(last!.headers["retry-after"]);
  assert.equal(last!.headers["x-ratelimit-limit"], "3");
});

test("health routes are never rate limited (Render health checks)", async (t) => {
  const app = build(t, { rateLimitMax: 2 });
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
  }
});

test("behind a trusted proxy, each client IP has its own limit", async (t) => {
  const app = build(t, { rateLimitMax: 2, trustProxy: true });
  const from = (ip: string) =>
    app.inject({ method: "GET", url: "/zones/x", headers: { "x-forwarded-for": ip } });

  assert.equal((await from("203.0.113.1")).statusCode, 400);
  assert.equal((await from("203.0.113.1")).statusCode, 400);
  assert.equal((await from("203.0.113.1")).statusCode, 429);
  assert.equal((await from("198.51.100.7")).statusCode, 400);
});

test("a rate limit of 0 disables the limit", async (t) => {
  const app = build(t, { rateLimitMax: 0 });
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: "GET", url: "/zones/x" })).statusCode, 400);
  }
});

test("security headers are set and Swagger UI still loads", async (t) => {
  const app = build(t, {});
  const response = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(response.headers["cross-origin-resource-policy"], "cross-origin");
  assert.equal(response.headers["x-powered-by"], undefined);

  const docs = await app.inject({ method: "GET", url: "/docs" });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers["content-type"] as string, /text\/html/);
});

test("sensitive query parameters and headers never reach the logs", async (t) => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const app = build(t, {}, stream);

  await app.inject({
    method: "GET",
    url: "/zones/x?token=super-secret-123&page=2&api_key=cle-privee",
    headers: { authorization: "Bearer jeton-tres-secret", cookie: "session=abc-secret" },
  });

  const logs = lines.join("");
  assert.ok(logs.includes("/zones/x?"), "la requete doit etre journalisee");
  for (const secret of ["super-secret-123", "cle-privee", "jeton-tres-secret", "abc-secret"]) {
    assert.ok(!logs.includes(secret), `secret present dans les journaux : ${secret}`);
  }
  assert.match(logs, /token=MASQUE/);
  assert.match(logs, /page=2/);
});

test("redactUrl only masks sensitive keys", () => {
  assert.equal(redactUrl("/zones"), "/zones");
  assert.equal(redactUrl("/zones?page=2"), "/zones?page=2");
  assert.equal(redactUrl("/a?Password=x&b=1"), "/a?Password=MASQUE&b=1");
  assert.equal(redactUrl("/a?access_token=x&secret=y"), "/a?access_token=MASQUE&secret=MASQUE");
});
