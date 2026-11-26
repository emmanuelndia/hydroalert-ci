import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { notFound } from "../lib/http-errors.js";
import { paginationMeta, toSkipTake } from "../schemas/common.js";
import type { listZonesQuerySchema } from "../schemas/domain.js";

const zoneSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ZoneRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toZoneSummary(zone: ZoneRow) {
  return {
    ...zone,
    createdAt: zone.createdAt.toISOString(),
    updatedAt: zone.updatedAt.toISOString(),
  };
}

export async function listZones(
  prisma: PrismaClient,
  query: z.infer<typeof listZonesQuerySchema>,
) {
  const where = query.isActive === undefined ? {} : { isActive: query.isActive };
  const [zones, total] = await prisma.$transaction([
    prisma.zone.findMany({
      where,
      select: zoneSelect,
      orderBy: { name: "asc" },
      ...toSkipTake(query),
    }),
    prisma.zone.count({ where }),
  ]);

  return { data: zones.map(toZoneSummary), pagination: paginationMeta(query, total) };
}

export async function getZone(prisma: PrismaClient, id: string) {
  const zone = await prisma.zone.findUnique({
    where: { id },
    select: { ...zoneSelect, _count: { select: { sensors: true } } },
  });
  if (!zone) throw notFound("Zone");

  const [row] = await prisma.$queryRaw<{ geometry: string }[]>`
    SELECT ST_AsGeoJSON(geometry)::text AS geometry FROM zones WHERE id = ${id}::uuid`;
  if (!row) throw notFound("Zone");

  const { _count, ...rest } = zone;
  return {
    ...toZoneSummary(rest),
    geometry: JSON.parse(row.geometry) as { type: string; coordinates: unknown[] },
    sensorCount: _count.sensors,
  };
}
