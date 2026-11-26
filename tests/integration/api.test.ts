/**
 * Tests d'integration sur PostgreSQL/PostGIS avec les donnees de prisma/seed.ts.
 * A lancer via `pnpm test:integration` (base TEST_DATABASE_URL).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { buildApp } from "../../src/app.js";

const ZONE_ID = "10000000-0000-4000-8000-000000000001";
const SENSOR_WATER_1 = "20000000-0000-4000-8000-000000000001";
const SENSOR_RAIN = "20000000-0000-4000-8000-000000000003";
const ALERT_ID = "50000000-0000-4000-8000-000000000001";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const app = buildApp({ logger: false });

before(async () => {
  await app.ready();
});
after(async () => {
  await app.close();
});

async function get(url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json(), raw: response.body };
}

describe("health", () => {
  test("GET /health confirms the database is reachable", async () => {
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.deepEqual(body, { status: "ok", database: "ok" });
  });
});

describe("zones", () => {
  test("GET /zones lists the pilot zone without geometry", async () => {
    const { status, body } = await get("/zones");
    assert.equal(status, 200);
    assert.deepEqual(body.pagination, { page: 1, pageSize: 20, total: 1 });
    assert.equal(body.data[0].id, ZONE_ID);
    assert.equal(body.data[0].name, "Riviera 9 Kilos");
    assert.equal("geometry" in body.data[0], false);
  });

  test("GET /zones?isActive=false filters inactive zones", async () => {
    const { status, body } = await get("/zones?isActive=false");
    assert.equal(status, 200);
    assert.equal(body.pagination.total, 0);
    assert.deepEqual(body.data, []);
  });

  test("GET /zones/:id returns the GeoJSON geometry and sensor count", async () => {
    const { status, body } = await get(`/zones/${ZONE_ID}`);
    assert.equal(status, 200);
    assert.equal(body.geometry.type, "MultiPolygon");
    assert.equal(body.sensorCount, 3);
  });

  test("GET /zones/:id returns 404 for an unknown zone", async () => {
    const { status, body } = await get(`/zones/${UNKNOWN_ID}`);
    assert.equal(status, 404);
    assert.deepEqual(body, { error: { code: "NOT_FOUND", message: "Zone introuvable" } });
  });
});

describe("sensors", () => {
  test("GET /sensors paginates, sorts by code and exposes coordinates", async () => {
    const { status, body, raw } = await get("/sensors?pageSize=2");
    assert.equal(status, 200);
    assert.deepEqual(body.pagination, { page: 1, pageSize: 2, total: 3 });
    assert.deepEqual(
      body.data.map((s: { code: string }) => s.code),
      ["CAP-COC-01", "CAP-COC-02"],
    );
    assert.equal(body.data[0].latitude, 5.365);
    assert.equal(body.data[0].longitude, -3.955);
    assert.doesNotMatch(raw, /accessKeyHash|access_key_hash/);

    const page2 = await get("/sensors?pageSize=2&page=2");
    assert.deepEqual(
      page2.body.data.map((s: { code: string }) => s.code),
      ["CAP-COC-03"],
    );
  });

  test("GET /sensors filters by type, status and zone", async () => {
    assert.equal((await get("/sensors?type=PLUIE")).body.pagination.total, 1);
    assert.equal((await get("/sensors?type=NIVEAU_EAU")).body.pagination.total, 2);
    assert.equal((await get("/sensors?status=HORS_LIGNE")).body.pagination.total, 0);
    assert.equal((await get(`/sensors?zoneId=${ZONE_ID}`)).body.pagination.total, 3);
    assert.equal((await get(`/sensors?zoneId=${UNKNOWN_ID}`)).body.pagination.total, 0);
  });

  test("GET /sensors/:id returns the sensor or 404", async () => {
    const found = await get(`/sensors/${SENSOR_RAIN}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.code, "CAP-COC-03");
    assert.equal(found.body.type, "PLUIE");
    assert.doesNotMatch(found.raw, /accessKeyHash|access_key_hash/);

    const missing = await get(`/sensors/${UNKNOWN_ID}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.message, "Capteur introuvable");
  });
});

describe("measurements", () => {
  const base = `/sensors/${SENSOR_WATER_1}/measurements`;

  test("lists measurements newest first with numeric values", async () => {
    const { status, body } = await get(`${base}?pageSize=5`);
    assert.equal(status, 200);
    assert.equal(body.pagination.total, 24);
    assert.equal(body.data.length, 5);
    assert.equal(body.data[0].measuredAt, "2026-11-24T23:00:00.000Z");
    assert.equal(body.data[0].waterLevelCm, 77.5);
    assert.equal(body.data[0].rainMm, null);
    const times = body.data.map((m: { measuredAt: string }) => m.measuredAt);
    assert.deepEqual(times, [...times].sort().reverse());
  });

  test("filters measurements by date range (inclusive bounds)", async () => {
    const { status, body } = await get(
      `${base}?from=2026-11-24T10:00:00Z&to=2026-11-24T12:00:00Z`,
    );
    assert.equal(status, 200);
    assert.equal(body.pagination.total, 3);
    assert.deepEqual(
      body.data.map((m: { measuredAt: string }) => m.measuredAt),
      ["2026-11-24T12:00:00.000Z", "2026-11-24T11:00:00.000Z", "2026-11-24T10:00:00.000Z"],
    );
  });

  test("returns 404 for an unknown sensor", async () => {
    const { status, body } = await get(`/sensors/${UNKNOWN_ID}/measurements`);
    assert.equal(status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
  });
});

describe("alerts", () => {
  test("GET /alerts lists and filters alerts", async () => {
    const all = await get("/alerts");
    assert.equal(all.status, 200);
    assert.equal(all.body.pagination.total, 1);
    assert.equal(all.body.data[0].level, "VIGILANCE");
    assert.equal(all.body.data[0].status, "ACTIVE");

    assert.equal((await get("/alerts?status=RESOLUE")).body.pagination.total, 0);
    assert.equal((await get(`/alerts?zoneId=${ZONE_ID}&level=VIGILANCE`)).body.pagination.total, 1);
  });

  test("GET /alerts/:id returns the alert or 404", async () => {
    const found = await get(`/alerts/${ALERT_ID}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.number, "ALR-SIM-0001");
    assert.equal(found.body.endsAt, null);

    const missing = await get(`/alerts/${UNKNOWN_ID}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.message, "Alerte introuvable");
  });
});
