import type { Alert, Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { notFound } from "../lib/http-errors.js";
import { paginationMeta, toSkipTake } from "../schemas/common.js";
import type { listAlertsQuerySchema } from "../schemas/domain.js";

function toAlert(alert: Alert) {
  return {
    id: alert.id,
    number: alert.number,
    zoneId: alert.zoneId,
    predictionId: alert.predictionId,
    level: alert.level,
    title: alert.title,
    message: alert.message,
    status: alert.status,
    requiresValidation: alert.requiresValidation,
    validatedAt: alert.validatedAt?.toISOString() ?? null,
    startsAt: alert.startsAt.toISOString(),
    endsAt: alert.endsAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  };
}

export async function listAlerts(
  prisma: PrismaClient,
  query: z.infer<typeof listAlertsQuerySchema>,
) {
  const where: Prisma.AlertWhereInput = {
    ...(query.zoneId && { zoneId: query.zoneId }),
    ...(query.status && { status: query.status }),
    ...(query.level && { level: query.level }),
  };
  const [alerts, total] = await prisma.$transaction([
    prisma.alert.findMany({ where, orderBy: { startsAt: "desc" }, ...toSkipTake(query) }),
    prisma.alert.count({ where }),
  ]);

  return { data: alerts.map(toAlert), pagination: paginationMeta(query, total) };
}

export async function getAlert(prisma: PrismaClient, id: string) {
  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) throw notFound("Alerte");
  return toAlert(alert);
}
