import {
  AlertLevel,
  AlertStatus,
  PredictionOrigin,
  RiskLevel,
  SensorStatus,
  SensorType,
} from "@prisma/client";
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

/* ---------- Predictions ---------- */

export const predictionSchema = z.object({
  id: z.uuid(),
  zoneId: z.uuid(),
  riskScore: z.number().int().describe("Score de risque de 0 a 100"),
  riskLevel: z.enum(RiskLevel),
  displayColor: z.enum(["vert", "orange", "rouge"]).describe("Couleur d'affichage proposee"),
  probability: z.number().nullable(),
  horizonHours: z.number().nullable(),
  origin: z.enum(PredictionOrigin),
  modelVersion: z.string().nullable(),
  predictedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const listPredictionsQuerySchema = paginationQuerySchema.extend({
  zoneId: z.uuid().optional(),
  riskLevel: z.enum(RiskLevel).optional(),
});

/* ---------- Cartographie (GeoJSON) ---------- */

export const latitudeSchema = z.coerce.number().min(-90).max(90).describe("Latitude WGS 84 en degres decimaux");
export const longitudeSchema = z.coerce
  .number()
  .min(-180)
  .max(180)
  .describe("Longitude WGS 84 en degres decimaux");

const nullableDateTime = isoDateTimeSchema.nullable();
const colorSchema = z.enum(["vert", "orange", "rouge"]);

function featureCollectionSchema<P extends z.ZodType>(properties: P) {
  return z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        id: z.uuid(),
        geometry: geoJsonGeometrySchema,
        properties,
      }),
    ),
  });
}

export const zoneFeatureCollectionSchema = featureCollectionSchema(
  z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    sensorCount: z.number().int(),
    riskLevel: z.enum(RiskLevel).nullable().describe("Dernier niveau de risque calcule, sinon null"),
    riskScore: z.number().int().nullable(),
    predictedAt: nullableDateTime,
    activeAlert: z
      .object({
        id: z.uuid(),
        number: z.string().nullable(),
        level: z.enum(AlertLevel),
        startsAt: isoDateTimeSchema,
      })
      .nullable()
      .describe("Alerte publiee (ACTIVE) de la zone, sinon null"),
    displayColor: colorSchema
      .nullable()
      .describe("Couleur de l'alerte publiee, sinon du dernier niveau de risque, sinon null"),
  }),
);

export const sensorFeatureCollectionSchema = featureCollectionSchema(
  z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string().nullable(),
    zoneId: z.uuid(),
    type: z.enum(SensorType),
    status: z.enum(SensorStatus),
    batteryPct: z.number().int().nullable(),
    lastCommunication: nullableDateTime,
    lastMeasurement: z
      .object({
        measuredAt: isoDateTimeSchema,
        waterLevelCm: z.number().nullable(),
        rainMm: z.number().nullable(),
        flowRate: z.number().nullable(),
      })
      .nullable(),
  }),
);

export const sensorsGeoJsonQuerySchema = z.object({ zoneId: z.uuid().optional() });

export const locateQuerySchema = z.object({ latitude: latitudeSchema, longitude: longitudeSchema });

export const locateResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  zones: z.array(z.object({ id: z.uuid(), name: z.string() })).describe("Zones actives contenant le point"),
});

export const nearbyQuerySchema = locateQuerySchema.extend({
  radiusM: z.coerce.number().int().min(1).max(10_000).default(500).describe("Rayon de recherche en metres"),
});

export const nearbyResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  radiusM: z.number().int(),
  sensors: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string().nullable(),
      zoneId: z.uuid(),
      type: z.enum(SensorType),
      status: z.enum(SensorStatus),
      latitude: z.number(),
      longitude: z.number(),
      distanceM: z.number().int().describe("Distance en metres"),
    }),
  ),
});
