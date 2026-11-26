/**
 * Tests d'integration de la chaine mesure -> prediction -> alerte, sur la base de test.
 * Chaque test cree sa propre zone et ses capteurs, puis tout est supprime a la fin.
 * A lancer via `pnpm test:integration`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { PrismaClient, type SensorStatus, type SensorType } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { IngestionError, ingestMeasurement } from "../../src/services/ingestion.js";
import { type PipelineConfig, processMeasurement } from "../../src/services/measurement-pipeline.js";

// Securite : ces tests creent et suppriment des donnees, uniquement sur la base de test.
if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("pipeline.test.ts doit etre lance via pnpm test:integration (base de test).");
}

const prisma = new PrismaClient();
const createdZones: string[] = [];
const config: PipelineConfig = {
  riskEvaluator: "rule",
  ruleCriticalWaterLevelCm: 100,
  alertValidationLevels: [],
};

type Fixture = { zoneId: string; codes: Record<string, string> };

async function createFixture(
  sensors: { key: string; type: SensorType; status?: SensorStatus }[],
  zoneActive = true,
): Promise<Fixture> {
  const zoneId = randomUUID();
  const tag = zoneId.slice(0, 8).toUpperCase();
  createdZones.push(zoneId);
  await prisma.$executeRaw`
    INSERT INTO zones (id, name, geometry, is_active, updated_at)
    VALUES (${zoneId}::uuid, ${`Zone test ${tag}`},
      ST_Multi(ST_GeomFromText('POLYGON((-4 5, -3.9 5, -3.9 5.1, -4 5.1, -4 5))', 4326)),
      ${zoneActive}, now())`;
  const codes: Record<string, string> = {};
  for (const sensor of sensors) {
    const code = `TST-${tag}-${sensor.key}`;
    codes[sensor.key] = code;
    await prisma.$executeRaw`
      INSERT INTO sensors (id, code, zone_id, position, type, status, updated_at)
      VALUES (${randomUUID()}::uuid, ${code}, ${zoneId}::uuid,
        ST_SetSRID(ST_MakePoint(-3.95, 5.05), 4326),
        ${sensor.type}::sensor_type, ${sensor.status ?? "ACTIF"}::sensor_status, now())`;
  }
  return { zoneId, codes };
}

let clock = Date.parse("2026-11-26T08:00:00.000Z");
/** Horloge de test : chaque mesure est une minute apres la precedente. */
function tick() {
  clock += 60_000;
  return new Date(clock);
}

function water(code: string, waterLevelCm: number, at: Date, extra: object = {}) {
  return { sensorCode: code, measuredAt: at.toISOString(), waterLevelCm, ...extra };
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  for (const zoneId of createdZones) {
    await prisma.alert.deleteMany({ where: { zoneId } });
    await prisma.prediction.deleteMany({ where: { zoneId } });
    await prisma.measurement.deleteMany({ where: { sensor: { zoneId } } });
    await prisma.sensor.deleteMany({ where: { zoneId } });
    await prisma.zone.deleteMany({ where: { id: zoneId } });
  }
  await prisma.$disconnect();
});

describe("ingestion", () => {
  test("an accepted measurement is stored and updates the sensor", async () => {
    const { codes } = await createFixture([{ key: "EAU", type: "NIVEAU_EAU", status: "HORS_LIGNE" }]);
    const at = tick();
    const receivedAt = new Date(at.getTime() + 1500);

    const result = await ingestMeasurement(prisma, water(codes.EAU!, 42.5, at, { batteryPct: 77 }), {
      receivedAt,
    });
    assert.equal(result.status, "accepted");

    const stored = await prisma.measurement.findUniqueOrThrow({ where: { id: result.measurementId } });
    assert.equal(stored.waterLevelCm?.toNumber(), 42.5);
    assert.equal(stored.receivedAt.toISOString(), receivedAt.toISOString());
    assert.deepEqual(stored.rawPayload, water(codes.EAU!, 42.5, at, { batteryPct: 77 }));

    const sensor = await prisma.sensor.findUniqueOrThrow({ where: { code: codes.EAU! } });
    assert.equal(sensor.status, "ACTIF");
    assert.equal(sensor.batteryPct, 77);
    assert.equal(sensor.lastCommunication?.toISOString(), receivedAt.toISOString());
  });

  test("a retransmitted measurement is reported as duplicate without a new row", async () => {
    const { codes } = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }]);
    const at = tick();
    const first = await ingestMeasurement(prisma, water(codes.EAU!, 30, at), { receivedAt: at });
    const second = await ingestMeasurement(prisma, water(codes.EAU!, 30, at), { receivedAt: at });

    assert.equal(second.status, "duplicate");
    assert.equal(second.measurementId, first.measurementId);
    const sensor = await prisma.sensor.findUniqueOrThrow({ where: { code: codes.EAU! } });
    assert.equal(await prisma.measurement.count({ where: { sensorId: sensor.id } }), 1);
  });

  test("unknown, unavailable and inconsistent measurements are rejected without touching the sensor", async () => {
    const { codes } = await createFixture([
      { key: "EAU", type: "NIVEAU_EAU" },
      { key: "MAINT", type: "NIVEAU_EAU", status: "EN_MAINTENANCE" },
    ]);
    const at = tick();

    await assert.rejects(
      ingestMeasurement(prisma, water("TST-INCONNU", 10, at), { receivedAt: at }),
      (error: unknown) => error instanceof IngestionError && error.code === "UNKNOWN_SENSOR",
    );
    await assert.rejects(
      ingestMeasurement(prisma, water(codes.MAINT!, 10, at), { receivedAt: at }),
      (error: unknown) => error instanceof IngestionError && error.code === "SENSOR_UNAVAILABLE",
    );
    // Un capteur de niveau d'eau qui n'envoie que de la pluie.
    await assert.rejects(
      ingestMeasurement(prisma, { sensorCode: codes.EAU!, measuredAt: at.toISOString(), rainMm: 3 }, { receivedAt: at }),
      (error: unknown) => error instanceof IngestionError && error.code === "INVALID_MEASUREMENT",
    );
    // Valeur hors limites.
    await assert.rejects(
      ingestMeasurement(prisma, water(codes.EAU!, -5, at), { receivedAt: at }),
      (error: unknown) => error instanceof IngestionError && error.code === "INVALID_MEASUREMENT",
    );
    // Date trop loin dans le futur.
    await assert.rejects(
      ingestMeasurement(prisma, water(codes.EAU!, 10, new Date(at.getTime() + 3_600_000)), { receivedAt: at }),
      (error: unknown) => error instanceof IngestionError && error.code === "INVALID_MEASUREMENT",
    );

    for (const code of [codes.EAU!, codes.MAINT!]) {
      const sensor = await prisma.sensor.findUniqueOrThrow({ where: { code } });
      assert.equal(sensor.lastCommunication, null, code);
      assert.equal(await prisma.measurement.count({ where: { sensorId: sensor.id } }), 0, code);
    }
    const maintenance = await prisma.sensor.findUniqueOrThrow({ where: { code: codes.MAINT! } });
    assert.equal(maintenance.status, "EN_MAINTENANCE");
  });
});

describe("measurement -> prediction -> alert", () => {
  test("rising water creates one alert, then escalates it without duplicates", async () => {
    const { zoneId, codes } = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }]);
    const send = async (level: number) => {
      const now = tick();
      return processMeasurement(prisma, water(codes.EAU!, level, now), { config, now });
    };

    const low = await send(20);
    assert.equal(low.prediction?.riskLevel, "NORMAL");
    assert.equal(low.prediction?.origin, "REGLE");
    assert.deepEqual(low.alert, { action: "none" });

    const vigilance = await send(50);
    assert.equal(vigilance.prediction?.riskLevel, "VIGILANCE");
    assert.equal(vigilance.alert?.action, "created");
    assert.ok(vigilance.alert && "alertId" in vigilance.alert);
    const alertId = vigilance.alert.alertId;

    const sameLevel = await send(55);
    assert.equal(sameLevel.alert?.action, "unchanged");

    const danger = await send(70);
    assert.equal(danger.prediction?.riskLevel, "DANGER");
    assert.deepEqual(
      { action: danger.alert?.action, id: danger.alert && "alertId" in danger.alert ? danger.alert.alertId : null },
      { action: "escalated", id: alertId },
    );

    const lower = await send(45);
    assert.equal(lower.prediction?.riskLevel, "VIGILANCE");
    assert.equal(lower.alert?.action, "unchanged");

    const alerts = await prisma.alert.findMany({ where: { zoneId } });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.level, "DANGER");
    assert.equal(alerts[0]!.status, "ACTIVE");
    assert.equal(alerts[0]!.predictionId, danger.prediction?.id);
    assert.match(alerts[0]!.title, /^Danger inondation - Zone test /);
    assert.match(alerts[0]!.number ?? "", /^ALR-\d{8}-[0-9A-F]{6}$/);

    // L'historique des predictions est conserve.
    assert.equal(await prisma.prediction.count({ where: { zoneId } }), 5);
  });

  test("levels listed in ALERT_VALIDATION_LEVELS wait for validation", async () => {
    const { zoneId, codes } = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }]);
    const now = tick();
    const result = await processMeasurement(prisma, water(codes.EAU!, 90, now), {
      config: { ...config, alertValidationLevels: ["EVACUATION"] },
      now,
    });
    assert.equal(result.prediction?.riskLevel, "EVACUATION");
    assert.equal(result.alert?.action, "created");
    const alert = await prisma.alert.findFirstOrThrow({ where: { zoneId } });
    assert.equal(alert.status, "EN_ATTENTE_VALIDATION");
    assert.equal(alert.requiresValidation, true);
  });

  test("rain adds a capped bonus to the water score", async () => {
    const { codes } = await createFixture([
      { key: "EAU", type: "NIVEAU_EAU" },
      { key: "PLUIE", type: "PLUIE" },
    ]);
    const rainAt = tick();
    await processMeasurement(prisma, { sensorCode: codes.PLUIE!, measuredAt: rainAt.toISOString(), rainMm: 30 }, { config, now: rainAt });
    const now = tick();
    const result = await processMeasurement(prisma, water(codes.EAU!, 50, now), { config, now });
    // 50 (eau) + min(15, 30 mm) = 65 -> DANGER.
    assert.equal(result.prediction?.score, 65);
    assert.equal(result.prediction?.riskLevel, "DANGER");
  });

  test("no prediction for an inactive zone, a disabled evaluator or a duplicate", async () => {
    const inactive = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }], false);
    let now = tick();
    const fromInactive = await processMeasurement(prisma, water(inactive.codes.EAU!, 90, now), { config, now });
    assert.equal(fromInactive.ingestion.status, "accepted");
    assert.equal(fromInactive.skipped, "zone-inactive");
    assert.equal(await prisma.prediction.count({ where: { zoneId: inactive.zoneId } }), 0);

    const active = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }]);
    now = tick();
    const disabled = await processMeasurement(prisma, water(active.codes.EAU!, 90, now), {
      config: { ...config, riskEvaluator: "none" },
      now,
    });
    assert.equal(disabled.skipped, "evaluator-disabled");

    const duplicate = await processMeasurement(prisma, water(active.codes.EAU!, 90, now), { config, now });
    assert.equal(duplicate.skipped, "duplicate");
    assert.equal(await prisma.prediction.count({ where: { zoneId: active.zoneId } }), 0);
    assert.equal(await prisma.alert.count({ where: { zoneId: active.zoneId } }), 0);
  });
});

describe("GET /predictions", () => {
  const app = buildApp({ logger: false });
  after(() => app.close());

  test("lists predictions of a zone, newest first, with display colors", async () => {
    const { zoneId, codes } = await createFixture([{ key: "EAU", type: "NIVEAU_EAU" }]);
    for (const level of [10, 45, 80]) {
      const now = tick();
      await processMeasurement(prisma, water(codes.EAU!, level, now), { config, now });
    }

    const response = await app.inject({ method: "GET", url: `/predictions?zoneId=${zoneId}` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.pagination.total, 3);
    assert.deepEqual(
      body.data.map((p: { riskLevel: string; displayColor: string }) => [p.riskLevel, p.displayColor]),
      [
        ["DANGER", "rouge"],
        ["VIGILANCE", "orange"],
        ["NORMAL", "vert"],
      ],
    );

    const filtered = await app.inject({ method: "GET", url: `/predictions?zoneId=${zoneId}&riskLevel=VIGILANCE` });
    assert.equal(filtered.json().pagination.total, 1);

    const invalid = await app.inject({ method: "GET", url: "/predictions?riskLevel=ROUGE" });
    assert.equal(invalid.statusCode, 400);
  });
});
