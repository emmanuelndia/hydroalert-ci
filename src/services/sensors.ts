import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { notFound } from "../lib/http-errors.js";
import { paginationMeta, toSkipTake } from "../schemas/common.js";
import type { listMeasurementsQuerySchema, listSensorsQuerySchema } from "../schemas/domain.js";

// accessKeyHash n'est jamais selectionne : il ne doit pas sortir de la base.
const sensorSelect = {
  id: true,
  code: true,
  name: true,
  zoneId: true,
  type: true,
  status: true,
  batteryPct: true,
  lastCommunication: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SensorSelect;

type SensorRow = Prisma.SensorGetPayload<{ select: typeof sensorSelect }>;
type Coordinates = { id: string; latitude: number; longitude: number };

async function loadCoordinates(prisma: PrismaClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, Coordinates>();
  const rows = await prisma.$queryRaw<Coordinates[]>`
    SELECT id::text AS id, ST_Y(position) AS latitude, ST_X(position) AS longitude
    FROM sensors WHERE id = ANY(${ids}::uuid[])`;
  return new Map(rows.map((row) => [row.id, row]));
}

function toSensor(sensor: SensorRow, coordinates: Coordinates | undefined) {
  if (!coordinates) throw new Error(`Missing position for sensor ${sensor.id}`);
  return {
    ...sensor,
    lastCommunication: sensor.lastCommunication?.toISOString() ?? null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    createdAt: sensor.createdAt.toISOString(),
    updatedAt: sensor.updatedAt.toISOString(),
  };
}

export async function listSensors(
  prisma: PrismaClient,
  query: z.infer<typeof listSensorsQuerySchema>,
) {
  const where: Prisma.SensorWhereInput = {
    ...(query.zoneId && { zoneId: query.zoneId }),
    ...(query.status && { status: query.status }),
    ...(query.type && { type: query.type }),
  };
  const [sensors, total] = await prisma.$transaction([
    prisma.sensor.findMany({
      where,
      select: sensorSelect,
      orderBy: { code: "asc" },
      ...toSkipTake(query),
    }),
    prisma.sensor.count({ where }),
  ]);
  const coordinates = await loadCoordinates(prisma, sensors.map((s) => s.id));

  return {
    data: sensors.map((s) => toSensor(s, coordinates.get(s.id))),
    pagination: paginationMeta(query, total),
  };
}

export async function getSensor(prisma: PrismaClient, id: string) {
  const sensor = await prisma.sensor.findUnique({ where: { id }, select: sensorSelect });
  if (!sensor) throw notFound("Capteur");
  const coordinates = await loadCoordinates(prisma, [id]);
  return toSensor(sensor, coordinates.get(id));
}

export async function listSensorMeasurements(
  prisma: PrismaClient,
  sensorId: string,
  query: z.infer<typeof listMeasurementsQuerySchema>,
) {
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorId }, select: { id: true } });
  if (!sensor) throw notFound("Capteur");

  const where: Prisma.MeasurementWhereInput = {
    sensorId,
    ...((query.from || query.to) && {
      measuredAt: {
        ...(query.from && { gte: query.from }),
        ...(query.to && { lte: query.to }),
      },
    }),
  };
  const [measurements, total] = await prisma.$transaction([
    prisma.measurement.findMany({
      where,
      orderBy: { measuredAt: "desc" },
      ...toSkipTake(query),
    }),
    prisma.measurement.count({ where }),
  ]);

  return {
    data: measurements.map((m) => ({
      id: m.id,
      sensorId: m.sensorId,
      measuredAt: m.measuredAt.toISOString(),
      receivedAt: m.receivedAt.toISOString(),
      waterLevelCm: m.waterLevelCm?.toNumber() ?? null,
      rainMm: m.rainMm?.toNumber() ?? null,
      flowRate: m.flowRate?.toNumber() ?? null,
      batteryPct: m.batteryPct,
    })),
    pagination: paginationMeta(query, total),
  };
}
