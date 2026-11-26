import { AlertLevel, AlertStatus, SensorStatus, SensorType } from "@prisma/client";
import { z } from "zod";
import {
  booleanQuerySchema,
  isoDateQuerySchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from "./common.js";

/* ---------- Zones ---------- */

export const zoneSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const geoJsonGeometrySchema = z.object({
  type: z.string(),
  coordinates: z.array(z.unknown()),
});

export const zoneDetailSchema = zoneSummarySchema.extend({
  geometry: geoJsonGeometrySchema.describe("Geometrie GeoJSON (MultiPolygon, WGS 84)"),
  sensorCount: z.number().int(),
});

export const listZonesQuerySchema = paginationQuerySchema.extend({
  isActive: booleanQuerySchema.optional(),
});

/* ---------- Capteurs ---------- */

export const sensorSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string().nullable(),
  zoneId: z.uuid(),
  type: z.enum(SensorType),
  status: z.enum(SensorStatus),
  batteryPct: z.number().int().nullable(),
  lastCommunication: isoDateTimeSchema.nullable(),
  latitude: z.number(),
  longitude: z.number(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const listSensorsQuerySchema = paginationQuerySchema.extend({
  zoneId: z.uuid().optional(),
  status: z.enum(SensorStatus).optional(),
  type: z.enum(SensorType).optional(),
});

/* ---------- Mesures ---------- */

export const measurementSchema = z.object({
  id: z.uuid(),
  sensorId: z.uuid(),
  measuredAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema,
  waterLevelCm: z.number().nullable(),
  rainMm: z.number().nullable(),
  flowRate: z.number().nullable(),
  batteryPct: z.number().int().nullable(),
});

export const listMeasurementsQuerySchema = paginationQuerySchema
  .extend({
    from: isoDateQuerySchema.optional(),
    to: isoDateQuerySchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from doit etre anterieur ou egal a to",
    path: ["from"],
  });

/* ---------- Alertes ---------- */

export const alertSchema = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  zoneId: z.uuid(),
  predictionId: z.uuid().nullable(),
  level: z.enum(AlertLevel),
  title: z.string(),
  message: z.string(),
  status: z.enum(AlertStatus),
  requiresValidation: z.boolean(),
  validatedAt: isoDateTimeSchema.nullable(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const listAlertsQuerySchema = paginationQuerySchema.extend({
  zoneId: z.uuid().optional(),
  status: z.enum(AlertStatus).optional(),
  level: z.enum(AlertLevel).optional(),
});
