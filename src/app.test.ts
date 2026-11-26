import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "./app.js";
import { type AppConfig, ConfigError, loadConfig } from "./config.js";

test("GET /health reports that the API and database are available", async (t) => {
  const app = buildApp({ logger: false, databaseCheck: async () => {} });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", database: "ok" });
});

test("GET /health reports database unavailability while liveness stays healthy", async (t) => {
  const app = buildApp({
    logger: false,
    databaseCheck: async () => {
      throw new Error("database is offline");
    },
  });
  t.after(() => app.close());

  const readiness = await app.inject({ method: "GET", url: "/health" });
  const liveness = await app.inject({ method: "GET", url: "/health/live" });

  assert.equal(readiness.statusCode, 503);
  assert.deepEqual(readiness.json(), { status: "error", database: "unavailable" });
  assert.equal(liveness.statusCode, 200);
  assert.deepEqual(liveness.json(), { status: "ok" });
});

// Les cas suivants sont rejetes avant tout acces a la base : aucune connexion n'est necessaire.

function buildOfflineApp(t: { after: (fn: () => unknown) => void }) {
  const app = buildApp({ logger: false, databaseCheck: async () => {} });
  t.after(() => app.close());
  return app;
}

test("unknown routes return the standard NOT_FOUND error", async (t) => {
  const app = buildOfflineApp(t);
  const response = await app.inject({ method: "GET", url: "/does-not-exist?x=1" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: { code: "NOT_FOUND", message: "Route GET /does-not-exist introuvable" },
  });
});

test("an invalid UUID is rejected with VALIDATION_ERROR", async (t) => {
  const app = buildOfflineApp(t);

  for (const url of ["/zones/abc", "/sensors/123", "/sensors/abc/measurements", "/alerts/xyz"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 400, url);
    const body = response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR", url);
    assert.equal(body.error.details[0].location, "params", url);
  }
});

test("out-of-range pagination and invalid filters are rejected", async (t) => {
  const app = buildOfflineApp(t);
  const invalidUrls = [
    "/zones?page=0",
    "/zones?pageSize=101",
    "/zones?isActive=yes",
    "/sensors?status=INCONNU",
    "/sensors?zoneId=not-a-uuid",
    "/alerts?level=NORMAL",
  ];

  for (const url of invalidUrls) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, "VALIDATION_ERROR", url);
  }
});

test("measurement date filters must be ISO dates in chronological order", async (t) => {
  const app = buildOfflineApp(t);
  const base = "/sensors/20000000-0000-4000-8000-000000000001/measurements";

  const invalidDate = await app.inject({ method: "GET", url: `${base}?from=hier` });
  assert.equal(invalidDate.statusCode, 400);

  const reversed = await app.inject({
    method: "GET",
    url: `${base}?from=2026-11-25T00:00:00Z&to=2026-11-24T00:00:00Z`,
  });
  assert.equal(reversed.statusCode, 400);
  assert.match(JSON.stringify(reversed.json().error.details), /from doit etre anterieur/);
});

test("the OpenAPI document lists the consultation routes", async (t) => {
  const app = buildOfflineApp(t);
  const response = await app.inject({ method: "GET", url: "/docs/json" });

  assert.equal(response.statusCode, 200);
  const paths = Object.keys(response.json().paths);
  for (const path of [
    "/health",
    "/zones",
    "/zones/{id}",
    "/sensors",
    "/sensors/{id}",
    "/sensors/{id}/measurements",
    "/alerts",
    "/alerts/{id}",
    "/predictions",
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

// ---------- Configuration ----------

test("loadConfig applies defaults when variables are absent or empty", () => {
  const config = loadConfig({ PORT: "", API_PUBLIC_URL: " " });
  assert.deepEqual(config, {
    nodeEnv: "development",
    port: 3000,
    host: "0.0.0.0",
    publicUrl: "http://127.0.0.1:3000",
    corsOrigins: "*",
    riskEvaluator: "rule",
    ruleCriticalWaterLevelCm: 100,
    alertValidationLevels: [],
  });
});

test("loadConfig keeps the provisional risk rule off in production unless enabled", () => {
  const production = { NODE_ENV: "production", CORS_ORIGINS: "https://web.example.org" };
  assert.equal(loadConfig(production).riskEvaluator, "none");
  assert.equal(loadConfig({ ...production, RISK_EVALUATOR: "rule" }).riskEvaluator, "rule");
  assert.equal(loadConfig({ RISK_EVALUATOR: "none" }).riskEvaluator, "none");
  assert.throws(() => loadConfig({ RISK_EVALUATOR: "ia" }), ConfigError);
});

test("loadConfig parses alert validation levels and the critical water level", () => {
  const config = loadConfig({
    ALERT_VALIDATION_LEVELS: "danger, EVACUATION,DANGER",
    RULE_CRITICAL_WATER_LEVEL_CM: "80",
  });
  assert.deepEqual(config.alertValidationLevels, ["DANGER", "EVACUATION"]);
  assert.equal(config.ruleCriticalWaterLevelCm, 80);
  assert.throws(() => loadConfig({ ALERT_VALIDATION_LEVELS: "NORMAL" }), ConfigError);
  assert.throws(() => loadConfig({ RULE_CRITICAL_WATER_LEVEL_CM: "0" }), ConfigError);
});

test("loadConfig derives the public URL from PORT and trims trailing slashes", () => {
  assert.equal(loadConfig({ PORT: "4000" }).publicUrl, "http://127.0.0.1:4000");
  assert.equal(
    loadConfig({ API_PUBLIC_URL: "https://api.example.org/" }).publicUrl,
    "https://api.example.org",
  );
});

test("loadConfig splits CORS origins", () => {
  const config = loadConfig({ CORS_ORIGINS: "http://localhost:5173, https://web.example.org/ ," });
  assert.deepEqual(config.corsOrigins, ["http://localhost:5173", "https://web.example.org"]);
});

test("loadConfig rejects invalid values without echoing them", () => {
  assert.throws(
    () => loadConfig({ PORT: "99999", API_PUBLIC_URL: "ftp://secret-host" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.variables.sort(), ["API_PUBLIC_URL", "PORT"]);
      assert.doesNotMatch(error.message, /secret-host|99999/);
      return true;
    },
  );
});

test("loadConfig requires CORS_ORIGINS in production", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /CORS_ORIGINS/);
  assert.deepEqual(
    loadConfig({ NODE_ENV: "production", CORS_ORIGINS: "https://web.example.org" }).corsOrigins,
    ["https://web.example.org"],
  );
});

// ---------- CORS et adresse publique ----------

function buildConfiguredApp(
  t: { after: (fn: () => unknown) => void },
  config: Partial<AppConfig>,
) {
  const app = buildApp({ logger: false, databaseCheck: async () => {}, config });
  t.after(() => app.close());
  return app;
}

function preflight(origin: string) {
  return {
    method: "OPTIONS" as const,
    url: "/health/live",
    headers: { origin, "access-control-request-method": "GET" },
  };
}

test("CORS allows only the configured origins", async (t) => {
  const app = buildConfiguredApp(t, { corsOrigins: ["http://localhost:5173"] });

  const allowed = await app.inject(preflight("http://localhost:5173"));
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");

  const refused = await app.inject(preflight("https://evil.example.org"));
  assert.equal(refused.headers["access-control-allow-origin"], undefined);

  const simple = await app.inject({
    method: "GET",
    url: "/health/live",
    headers: { origin: "http://localhost:5173" },
  });
  assert.equal(simple.headers["access-control-allow-origin"], "http://localhost:5173");
});

test("CORS accepts any origin when configured with *", async (t) => {
  const app = buildConfiguredApp(t, { corsOrigins: "*" });
  const response = await app.inject(preflight("https://any.example.org"));
  assert.ok(response.headers["access-control-allow-origin"]);
});

test("the OpenAPI document declares the configured public URL", async (t) => {
  const app = buildConfiguredApp(t, { publicUrl: "https://api.example.org" });
  const response = await app.inject({ method: "GET", url: "/docs/json" });
  assert.equal(response.json().servers[0].url, "https://api.example.org");
});
