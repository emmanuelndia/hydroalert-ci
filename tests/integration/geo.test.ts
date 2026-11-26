/**
 * Tests d'integration de la cartographie PostGIS (lot 6), sur la base de test.
 * Les zones et capteurs de test sont places loin de la zone fictive Riviera 9 Kilos,
 * puis supprimes a la fin. A lancer via `pnpm test:integration`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { reassignSensorZones, upsertZone, ZoneGeometryError } from "../../src/services/geo.js";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("geo.test.ts doit etre lance via pnpm test:integration (base de test).");
}

const RIVIERA_ID = "10000000-0000-4000-8000-000000000001";
const prisma = new PrismaClient();
const app = buildApp({ logger: false });
const createdZoneIds: string[] = [];
const createdSensorIds: string[] = [];
const run = randomUUID().slice(0, 6).toUpperCase();

/** Carre de cote `size` degres, coin sud-ouest (lng, lat). */
function square(lng: number, lat: number, size: number) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  };
}

async function insertZone(name: string, geometry: object, isActive = true) {
  const id = randomUUID();
  createdZoneIds.push(id);
  await prisma.$executeRaw`
    INSERT INTO zones (id, name, geometry, is_active, updated_at)
    VALUES (${id}::uuid, ${name}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326)), ${isActive}, now())`;
  return id;
}

async function insertSensor(code: string, zoneId: string, lng: number, lat: number, status = "ACTIF") {
  const id = randomUUID();
  createdSensorIds.push(id);
  await prisma.$executeRaw`
    INSERT INTO sensors (id, code, zone_id, position, type, status, updated_at)
    VALUES (${id}::uuid, ${code}, ${zoneId}::uuid, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
      'NIVEAU_EAU'::sensor_type, ${status}::sensor_status, now())`;
  return id;
}

async function get(url: string) {
  const response = await app.inject({ method: "GET", url });
  return { status: response.statusCode, body: response.json() };
}

before(async () => {
  await app.ready();
});

after(async () => {
  await prisma.alert.deleteMany({ where: { zoneId: { in: createdZoneIds } } });
  await prisma.sensor.deleteMany({ where: { id: { in: createdSensorIds } } });
  await prisma.zone.deleteMany({ where: { id: { in: createdZoneIds } } });
  await app.close();
  await prisma.$disconnect();
});

describe("GeoJSON for the map", () => {
  test("GET /zones/geojson returns active zones with risk, published alert and color", async () => {
    const pendingZone = await insertZone(`Geo ${run} attente`, square(-4.2, 5.2, 0.01));
    await insertZone(`Geo ${run} inactive`, square(-4.3, 5.2, 0.01), false);
    await prisma.alert.create({
      data: { zoneId: pendingZone, level: "DANGER", title: "t", message: "m", status: "EN_ATTENTE_VALIDATION" },
    });

    const { status, body } = await get("/zones/geojson");
    assert.equal(status, 200);
    assert.equal(body.type, "FeatureCollection");

    const riviera = body.features.find((f: { id: string }) => f.id === RIVIERA_ID);
    assert.equal(riviera.type, "Feature");
    assert.equal(riviera.geometry.type, "MultiPolygon");
    assert.equal(riviera.properties.sensorCount, 3);
    assert.equal(riviera.properties.riskLevel, "VIGILANCE");
    assert.equal(riviera.properties.activeAlert.level, "VIGILANCE");
    assert.equal(riviera.properties.displayColor, "orange");

    // Une alerte en attente de validation n'est pas publiee sur la carte.
    const pending = body.features.find((f: { id: string }) => f.id === pendingZone);
    assert.equal(pending.properties.activeAlert, null);
    assert.equal(pending.properties.displayColor, null);

    const names = body.features.map((f: { properties: { name: string } }) => f.properties.name);
    assert.ok(!names.includes(`Geo ${run} inactive`));
  });

  test("GET /sensors/geojson returns points with their latest measurement", async () => {
    const zone = await insertZone(`Geo ${run} capteurs`, square(-4.4, 5.2, 0.01));
    await insertSensor(`GEO-${run}-OFF`, zone, -4.395, 5.205, "DESACTIVE");

    const { status, body } = await get(`/sensors/geojson?zoneId=${RIVIERA_ID}`);
    assert.equal(status, 200);
    assert.equal(body.features.length, 3);
    const first = body.features[0];
    assert.equal(first.properties.code, "CAP-COC-01");
    assert.deepEqual(first.geometry, { type: "Point", coordinates: [-3.955, 5.365] });
    assert.equal(first.properties.lastMeasurement.measuredAt, "2026-11-24T23:00:00.000Z");
    assert.equal(first.properties.lastMeasurement.waterLevelCm, 77.5);

    const disabled = await get(`/sensors/geojson?zoneId=${zone}`);
    assert.equal(disabled.body.features.length, 0);

    assert.equal((await get("/sensors/geojson?zoneId=abc")).status, 400);
  });
});

describe("geographic search", () => {
  test("GET /zones/locate finds the zones covering a point", async () => {
    const inside = await get("/zones/locate?latitude=5.36&longitude=-3.95");
    assert.equal(inside.status, 200);
    assert.ok(inside.body.zones.some((z: { id: string }) => z.id === RIVIERA_ID));

    const outside = await get("/zones/locate?latitude=7.5&longitude=-5.5");
    assert.deepEqual(outside.body.zones, []);

    assert.equal((await get("/zones/locate?latitude=91&longitude=-3.95")).status, 400);
    assert.equal((await get("/zones/locate?latitude=5.36")).status, 400);
  });

  test("GET /sensors/nearby returns sensors within a radius in meters, nearest first", async () => {
    const near = await get("/sensors/nearby?latitude=5.365&longitude=-3.955&radiusM=300");
    assert.equal(near.status, 200);
    assert.deepEqual(
      near.body.sensors.map((s: { code: string; distanceM: number }) => [s.code, s.distanceM]),
      [["CAP-COC-01", 0]],
    );

    const wide = await get("/sensors/nearby?latitude=5.365&longitude=-3.955&radiusM=1000");
    const codes = wide.body.sensors.map((s: { code: string }) => s.code);
    assert.deepEqual(codes, ["CAP-COC-01", "CAP-COC-02", "CAP-COC-03"]);
    const [, second, third] = wide.body.sensors;
    // Environ 783 m et 842 m sur l'ellipsoide.
    assert.ok(second.distanceM > 750 && second.distanceM < 820, `distance ${second.distanceM}`);
    assert.ok(third.distanceM > 810 && third.distanceM < 880, `distance ${third.distanceM}`);

    assert.equal((await get("/sensors/nearby?latitude=5.365&longitude=-3.955&radiusM=10001")).status, 400);
  });
});

describe("zone import and sensor assignment", () => {
  test("invalid geometries are refused with an explicit code", async () => {
    const bowtie = {
      type: "Polygon",
      coordinates: [
        [
          [-4.5, 5.2],
          [-4.49, 5.21],
          [-4.49, 5.2],
          [-4.5, 5.21],
          [-4.5, 5.2],
        ],
      ],
    };
    // Latitude et longitude inversees : [5.2, -4.5] au lieu de [-4.5, 5.2].
    const swapped = {
      type: "Polygon",
      coordinates: [square(-4.5, 5.2, 0.01).coordinates[0]!.map(([lng, lat]) => [lat, lng])],
    };
    const outOfRange = square(-4.5, 95, 0.01);

    const cases: [object, string][] = [
      [bowtie, "INVALID_GEOMETRY"],
      [swapped, "OUTSIDE_COTE_DIVOIRE"],
      [outOfRange, "OUT_OF_RANGE"],
    ];
    for (const [geometry, code] of cases) {
      await assert.rejects(
        upsertZone(prisma, { name: `Geo ${run} refusee`, geometry: geometry as never }),
        (error: unknown) => error instanceof ZoneGeometryError && error.code === code,
        code,
      );
    }
    assert.equal(await prisma.zone.count({ where: { name: `Geo ${run} refusee` } }), 0);
  });

  test("upsertZone creates then replaces a zone, and sensors move to the smallest covering zone", async () => {
    const large = await insertZone(`Geo ${run} large`, square(-4.6, 5.2, 0.04));
    const sensorInside = await insertSensor(`GEO-${run}-IN`, large, -4.585, 5.215);
    const sensorOutside = await insertSensor(`GEO-${run}-OUT`, large, -4.7, 5.5);

    const name = `Geo ${run} petite`;
    const created = await upsertZone(prisma, { name, geometry: square(-4.59, 5.21, 0.01) as never });
    createdZoneIds.push(created.zoneId);
    assert.equal(created.action, "created");
    assert.ok(created.areaM2 > 1_000_000 && created.areaM2 < 1_300_000, `surface ${created.areaM2}`);

    const first = await reassignSensorZones(prisma);
    assert.ok(first.moved.some((m) => m.code === `GEO-${run}-IN` && m.zoneName === name));
    assert.ok(first.outside.includes(`GEO-${run}-OUT`));
    const moved = await prisma.sensor.findUniqueOrThrow({ where: { id: sensorInside } });
    assert.equal(moved.zoneId, created.zoneId);
    const kept = await prisma.sensor.findUniqueOrThrow({ where: { id: sensorOutside } });
    assert.equal(kept.zoneId, large);

    // Nouvelle geometrie qui ne contient plus le capteur : il revient dans la grande zone.
    const updated = await upsertZone(prisma, { name, geometry: square(-4.57, 5.23, 0.005) as never });
    assert.deepEqual([updated.action, updated.zoneId], ["updated", created.zoneId]);
    await reassignSensorZones(prisma);
    const back = await prisma.sensor.findUniqueOrThrow({ where: { id: sensorInside } });
    assert.equal(back.zoneId, large);

    // Les capteurs de la zone fictive Riviera ne bougent pas.
    assert.equal(await prisma.sensor.count({ where: { zoneId: RIVIERA_ID } }), 3);
  });
});
