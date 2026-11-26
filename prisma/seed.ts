/**
 * Donnees fictives pour le developpement et les tests locaux.
 *
 * - Le polygone de Riviera 9 Kilos est APPROXIMATIF et FICTIF : il sera remplace
 *   par le polygone officiel des qu'il sera fourni.
 * - Aucune cle de capteur n'est creee (access_key_hash reste NULL).
 * - Le script est idempotent : identifiants fixes et insertions sans doublon.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_IDS = {
  zone: "10000000-0000-4000-8000-000000000001",
  sensors: {
    water1: "20000000-0000-4000-8000-000000000001",
    water2: "20000000-0000-4000-8000-000000000002",
    rain: "20000000-0000-4000-8000-000000000003",
  },
  predictions: {
    normal: "40000000-0000-4000-8000-000000000001",
    vigilance: "40000000-0000-4000-8000-000000000002",
  },
  alert: "50000000-0000-4000-8000-000000000001",
} as const;

/** Debut fixe de la serie de mesures (UTC) : 24 mesures horaires a partir de cette date. */
const SEED_MEASUREMENTS_START = new Date("2026-11-24T00:00:00.000Z");
const SEED_MEASUREMENTS_PER_SENSOR = 24;

const zonePolygon = {
  type: "Polygon",
  coordinates: [
    [
      [-3.962, 5.355],
      [-3.945, 5.355],
      [-3.945, 5.37],
      [-3.962, 5.37],
      [-3.962, 5.355],
    ],
  ],
};

const sensors = [
  { id: SEED_IDS.sensors.water1, code: "CAP-COC-01", name: "Niveau d'eau - talweg nord", type: "NIVEAU_EAU", lng: -3.955, lat: 5.365 },
  { id: SEED_IDS.sensors.water2, code: "CAP-COC-02", name: "Niveau d'eau - caniveau principal", type: "NIVEAU_EAU", lng: -3.95, lat: 5.36 },
  { id: SEED_IDS.sensors.rain, code: "CAP-COC-03", name: "Pluviometre", type: "PLUIE", lng: -3.958, lat: 5.358 },
] as const;

function measurementId(sensorIndex: number, hour: number) {
  const n = sensorIndex * 100 + hour + 1;
  return `30000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

async function main() {
  await prisma.$executeRaw`
    INSERT INTO zones (id, name, description, geometry, is_active, updated_at)
    VALUES (
      ${SEED_IDS.zone}::uuid,
      'Riviera 9 Kilos',
      'Zone pilote (Cocody). Polygone APPROXIMATIF ET FICTIF en attente du polygone officiel.',
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zonePolygon)}), 4326)),
      true,
      now()
    )
    ON CONFLICT (id) DO NOTHING`;

  for (const s of sensors) {
    await prisma.$executeRaw`
      INSERT INTO sensors (id, code, name, zone_id, position, type, status, battery_pct, updated_at)
      VALUES (
        ${s.id}::uuid, ${s.code}, ${s.name}, ${SEED_IDS.zone}::uuid,
        ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326),
        ${s.type}::sensor_type, 'ACTIF'::sensor_status, 90, now()
      )
      ON CONFLICT (id) DO NOTHING`;
  }

  const measurements = sensors.flatMap((s, sensorIndex) =>
    Array.from({ length: SEED_MEASUREMENTS_PER_SENSOR }, (_, hour) => {
      const measuredAt = new Date(SEED_MEASUREMENTS_START.getTime() + hour * 3_600_000);
      const isRain = s.type === "PLUIE";
      return {
        id: measurementId(sensorIndex, hour),
        sensorId: s.id,
        measuredAt,
        receivedAt: new Date(measuredAt.getTime() + 2_000),
        waterLevelCm: isRain ? null : 20 + hour * 2.5 + sensorIndex * 5,
        rainMm: isRain ? Math.round(Math.max(0, Math.sin(hour / 4) * 12) * 10) / 10 : null,
        batteryPct: 90 - Math.floor(hour / 6),
      };
    }),
  );
  await prisma.measurement.createMany({ data: measurements, skipDuplicates: true });

  const lastMeasurement = new Date(
    SEED_MEASUREMENTS_START.getTime() + (SEED_MEASUREMENTS_PER_SENSOR - 1) * 3_600_000,
  );
  await prisma.$executeRaw`
    UPDATE sensors SET last_communication = ${lastMeasurement}, battery_pct = 87
    WHERE zone_id = ${SEED_IDS.zone}::uuid AND last_communication IS NULL`;

  await prisma.prediction.createMany({
    skipDuplicates: true,
    data: [
      {
        id: SEED_IDS.predictions.normal,
        zoneId: SEED_IDS.zone,
        riskScore: 22,
        riskLevel: "NORMAL",
        origin: "SIMULATION",
        inputSummary: { note: "Donnee fictive", maxWaterLevelCm: 35 },
        predictedAt: new Date("2026-11-24T06:00:00.000Z"),
      },
      {
        id: SEED_IDS.predictions.vigilance,
        zoneId: SEED_IDS.zone,
        riskScore: 52,
        riskLevel: "VIGILANCE",
        probability: 0.6,
        horizonHours: 3,
        origin: "SIMULATION",
        inputSummary: { note: "Donnee fictive", maxWaterLevelCm: 82.5 },
        predictedAt: new Date("2026-11-24T23:00:00.000Z"),
      },
    ],
  });

  await prisma.alert.createMany({
    skipDuplicates: true,
    data: [
      {
        id: SEED_IDS.alert,
        number: "ALR-SIM-0001",
        zoneId: SEED_IDS.zone,
        predictionId: SEED_IDS.predictions.vigilance,
        level: "VIGILANCE",
        title: "Vigilance inondation - Riviera 9 Kilos (simulation)",
        message: "Alerte fictive de demonstration : montee du niveau d'eau observee.",
        status: "ACTIVE",
        startsAt: new Date("2026-11-24T23:05:00.000Z"),
      },
    ],
  });

  const counts = {
    zones: await prisma.zone.count(),
    sensors: await prisma.sensor.count(),
    measurements: await prisma.measurement.count(),
    predictions: await prisma.prediction.count(),
    alerts: await prisma.alert.count(),
  };
  console.log("Seed termine :", counts);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
