import { Prisma, type PrismaClient } from "@prisma/client";
import type { AlertLevel, RiskLevel, SensorStatus, SensorType } from "@prisma/client";
import { displayColor } from "../domain/risk.js";

/**
 * Requetes geographiques PostGIS (lot 6). Les geometries sont en WGS 84 (SRID 4326) ;
 * les distances sont calculees en metres sur l'ellipsoide (type geography).
 */

/** Emprise approximative de la Cote d'Ivoire, pour detecter une inversion latitude / longitude. */
export const COTE_DIVOIRE_BBOX = { minLng: -8.7, maxLng: -2.4, minLat: 4.2, maxLat: 10.8 } as const;
export const MAX_NEARBY_RADIUS_M = 10_000;
const COORDINATE_DECIMALS = 6;

type GeoJsonGeometry = { type: string; coordinates: unknown[] };

/* ---------- Cartographie ---------- */

type ZoneMapRow = {
  id: string;
  name: string;
  description: string | null;
  geometry: string;
  sensorCount: number;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  predictedAt: Date | null;
  alertId: string | null;
  alertNumber: string | null;
  alertLevel: AlertLevel | null;
  alertStartsAt: Date | null;
};

/**
 * Zones actives en GeoJSON, avec le dernier niveau de risque et l'alerte publiee (ACTIVE) eventuelle.
 * Une alerte en attente de validation n'est pas exposee sur la carte publique.
 */
export async function zonesFeatureCollection(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<ZoneMapRow[]>`
    SELECT z.id::text AS id, z.name, z.description,
      ST_AsGeoJSON(z.geometry, ${COORDINATE_DECIMALS}::int)::text AS geometry,
      (SELECT count(*)::int FROM sensors s WHERE s.zone_id = z.id) AS "sensorCount",
      p.risk_level::text AS "riskLevel", p.risk_score::int AS "riskScore", p.predicted_at AS "predictedAt",
      a.id::text AS "alertId", a.number AS "alertNumber", a.level::text AS "alertLevel", a.starts_at AS "alertStartsAt"
    FROM zones z
    LEFT JOIN LATERAL (
      SELECT risk_level, risk_score, predicted_at FROM predictions
      WHERE zone_id = z.id ORDER BY predicted_at DESC LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT id, number, level, starts_at FROM alerts
      WHERE zone_id = z.id AND status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1
    ) a ON true
    WHERE z.is_active
    ORDER BY z.name`;

  return {
    type: "FeatureCollection" as const,
    features: rows.map((row) => {
      const level = row.alertLevel ?? row.riskLevel;
      return {
        type: "Feature" as const,
        id: row.id,
        geometry: JSON.parse(row.geometry) as GeoJsonGeometry,
        properties: {
          id: row.id,
          name: row.name,
          description: row.description,
          sensorCount: row.sensorCount,
          riskLevel: row.riskLevel,
          riskScore: row.riskScore,
          predictedAt: row.predictedAt?.toISOString() ?? null,
          activeAlert:
            row.alertId && row.alertLevel && row.alertStartsAt
              ? {
                  id: row.alertId,
                  number: row.alertNumber,
                  level: row.alertLevel,
                  startsAt: row.alertStartsAt.toISOString(),
                }
              : null,
          // Couleur de l'alerte publiee si elle existe, sinon celle du dernier niveau de risque.
          displayColor: level ? displayColor(level) : null,
        },
      };
    }),
  };
}

type SensorMapRow = {
  id: string;
  code: string;
  name: string | null;
  zoneId: string;
  type: SensorType;
  status: SensorStatus;
  batteryPct: number | null;
  lastCommunication: Date | null;
  geometry: string;
  measuredAt: Date | null;
  waterLevelCm: number | null;
  rainMm: number | null;
  flowRate: number | null;
};

/** Capteurs (hors capteurs desactives) en GeoJSON, avec leur derniere mesure. */
export async function sensorsFeatureCollection(prisma: PrismaClient, filter: { zoneId?: string } = {}) {
  const zoneFilter = filter.zoneId ? Prisma.sql`AND s.zone_id = ${filter.zoneId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<SensorMapRow[]>`
    SELECT s.id::text AS id, s.code, s.name, s.zone_id::text AS "zoneId", s.type::text AS type,
      s.status::text AS status, s.battery_pct::int AS "batteryPct", s.last_communication AS "lastCommunication",
      ST_AsGeoJSON(s.position, ${COORDINATE_DECIMALS}::int)::text AS geometry,
      m.measured_at AS "measuredAt", m.water_level_cm::float8 AS "waterLevelCm",
      m.rain_mm::float8 AS "rainMm", m.flow_rate::float8 AS "flowRate"
    FROM sensors s
    LEFT JOIN LATERAL (
      SELECT measured_at, water_level_cm, rain_mm, flow_rate FROM measurements
      WHERE sensor_id = s.id ORDER BY measured_at DESC LIMIT 1
    ) m ON true
    WHERE s.status <> 'DESACTIVE' ${zoneFilter}
    ORDER BY s.code`;

  return {
    type: "FeatureCollection" as const,
    features: rows.map((row) => ({
      type: "Feature" as const,
      id: row.id,
      geometry: JSON.parse(row.geometry) as GeoJsonGeometry,
      properties: {
        id: row.id,
        code: row.code,
        name: row.name,
        zoneId: row.zoneId,
        type: row.type,
        status: row.status,
        batteryPct: row.batteryPct,
        lastCommunication: row.lastCommunication?.toISOString() ?? null,
        lastMeasurement: row.measuredAt
          ? {
              measuredAt: row.measuredAt.toISOString(),
              waterLevelCm: row.waterLevelCm,
              rainMm: row.rainMm,
              flowRate: row.flowRate,
            }
          : null,
      },
    })),
  };
}

/* ---------- Recherches ---------- */

/** Zones actives qui contiennent le point (bordure incluse). */
export async function locateZones(prisma: PrismaClient, point: { latitude: number; longitude: number }) {
  const zones = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id::text AS id, name FROM zones
    WHERE is_active AND ST_Covers(geometry, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))
    ORDER BY ST_Area(geometry) ASC, name`;
  return { ...point, zones };
}

type NearbyRow = {
  id: string;
  code: string;
  name: string | null;
  zoneId: string;
  type: SensorType;
  status: SensorStatus;
  latitude: number;
  longitude: number;
  distanceM: number;
};

/** Capteurs (hors desactives) a moins de radiusM metres du point, du plus proche au plus eloigne. */
export async function nearbySensors(
  prisma: PrismaClient,
  query: { latitude: number; longitude: number; radiusM: number },
) {
  const rows = await prisma.$queryRaw<NearbyRow[]>`
    WITH origin AS (
      SELECT ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography AS point
    )
    SELECT s.id::text AS id, s.code, s.name, s.zone_id::text AS "zoneId", s.type::text AS type,
      s.status::text AS status, ST_Y(s.position) AS latitude, ST_X(s.position) AS longitude,
      ST_Distance(s.position::geography, origin.point) AS "distanceM"
    FROM sensors s, origin
    WHERE s.status <> 'DESACTIVE' AND ST_DWithin(s.position::geography, origin.point, ${query.radiusM})
    ORDER BY "distanceM", s.code
    LIMIT 100`;

  return {
    latitude: query.latitude,
    longitude: query.longitude,
    radiusM: query.radiusM,
    sensors: rows.map((row) => ({ ...row, distanceM: Math.round(row.distanceM) })),
  };
}

/* ---------- Enregistrement des zones (outil d'administration, pas de route publique) ---------- */

export type ZoneGeometryErrorCode =
  | "INVALID_GEOJSON"
  | "INVALID_TYPE"
  | "INVALID_GEOMETRY"
  | "OUT_OF_RANGE"
  | "OUTSIDE_COTE_DIVOIRE";

export class ZoneGeometryError extends Error {
  constructor(public readonly code: ZoneGeometryErrorCode, message: string) {
    super(message);
    this.name = "ZoneGeometryError";
  }
}

/**
 * Extrait un Polygon ou MultiPolygon d'un document GeoJSON (geometrie, Feature ou FeatureCollection).
 * Plusieurs polygones d'une FeatureCollection sont regroupes en un MultiPolygon.
 */
export function extractZoneGeometry(document: unknown): GeoJsonGeometry {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
  if (!isObject(document) || typeof document.type !== "string") {
    throw new ZoneGeometryError("INVALID_GEOJSON", "Document GeoJSON invalide (propriete type absente)");
  }

  const polygons: unknown[][] = [];
  const collect = (geometry: unknown) => {
    if (!isObject(geometry) || !Array.isArray(geometry.coordinates)) {
      throw new ZoneGeometryError("INVALID_GEOJSON", "Geometrie GeoJSON sans coordonnees");
    }
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
    else if (geometry.type === "MultiPolygon") polygons.push(...(geometry.coordinates as unknown[][]));
    else {
      throw new ZoneGeometryError(
        "INVALID_TYPE",
        `Type ${String(geometry.type)} refuse : une zone doit etre un Polygon ou un MultiPolygon`,
      );
    }
  };

  if (document.type === "FeatureCollection") {
    if (!Array.isArray(document.features) || document.features.length === 0) {
      throw new ZoneGeometryError("INVALID_GEOJSON", "FeatureCollection vide");
    }
    for (const feature of document.features) collect(isObject(feature) ? feature.geometry : null);
  } else if (document.type === "Feature") {
    collect(document.geometry);
  } else {
    collect(document);
  }

  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0]! }
    : { type: "MultiPolygon", coordinates: polygons };
}

type GeometryCheck = {
  valid: boolean;
  reason: string;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  areaM2: number;
};

/** Verifie la geometrie avec PostGIS : validite, plage des coordonnees et emprise ivoirienne. */
export async function validateZoneGeometry(
  prisma: PrismaClient,
  geometry: GeoJsonGeometry,
  options: { allowOutsideCountry?: boolean } = {},
) {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw new ZoneGeometryError("INVALID_TYPE", "Une zone doit etre un Polygon ou un MultiPolygon");
  }

  let check: GeometryCheck | undefined;
  try {
    [check] = await prisma.$queryRaw<GeometryCheck[]>`
      WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326) AS geom)
      SELECT ST_IsValid(geom) AS valid, ST_IsValidReason(geom) AS reason,
        ST_XMin(geom) AS xmin, ST_XMax(geom) AS xmax, ST_YMin(geom) AS ymin, ST_YMax(geom) AS ymax,
        ST_Area(geom::geography) AS "areaM2"
      FROM g`;
  } catch {
    throw new ZoneGeometryError("INVALID_GEOJSON", "PostGIS ne peut pas lire cette geometrie GeoJSON");
  }
  if (!check) throw new ZoneGeometryError("INVALID_GEOJSON", "Geometrie illisible");

  if (check.xmin < -180 || check.xmax > 180 || check.ymin < -90 || check.ymax > 90) {
    throw new ZoneGeometryError(
      "OUT_OF_RANGE",
      "Coordonnees hors plage : GeoJSON attend [longitude, latitude] en degres decimaux",
    );
  }
  if (!check.valid) {
    throw new ZoneGeometryError("INVALID_GEOMETRY", `Geometrie invalide : ${check.reason}`);
  }
  if (check.areaM2 <= 0) {
    throw new ZoneGeometryError("INVALID_GEOMETRY", "Geometrie de surface nulle");
  }
  const box = COTE_DIVOIRE_BBOX;
  const inCountry =
    check.xmin >= box.minLng && check.xmax <= box.maxLng && check.ymin >= box.minLat && check.ymax <= box.maxLat;
  if (!inCountry && !options.allowOutsideCountry) {
    throw new ZoneGeometryError(
      "OUTSIDE_COTE_DIVOIRE",
      "La zone sort de l'emprise de la Cote d'Ivoire : latitude et longitude sont peut-etre inversees " +
        "(GeoJSON attend [longitude, latitude], par exemple [-3.95, 5.36] pour Abidjan)",
    );
  }

  return { areaM2: check.areaM2 };
}

/** Cree la zone, ou remplace la geometrie de la zone du meme nom. */
export async function upsertZone(
  prisma: PrismaClient,
  input: { name: string; description?: string; geometry: GeoJsonGeometry; allowOutsideCountry?: boolean },
) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 150) {
    throw new ZoneGeometryError("INVALID_GEOJSON", "Le nom de la zone doit faire de 1 a 150 caracteres");
  }
  const { areaM2 } = await validateZoneGeometry(prisma, input.geometry, {
    allowOutsideCountry: input.allowOutsideCountry ?? false,
  });
  const geojson = JSON.stringify(input.geometry);
  const existing = await prisma.zone.findFirst({ where: { name }, select: { id: true } });

  if (existing) {
    await prisma.$executeRaw`
      UPDATE zones SET geometry = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
        description = COALESCE(${input.description ?? null}, description), updated_at = now()
      WHERE id = ${existing.id}::uuid`;
    return { zoneId: existing.id, action: "updated" as const, areaM2 };
  }

  const [created] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO zones (id, name, description, geometry, is_active, updated_at)
    VALUES (gen_random_uuid(), ${name}, ${input.description ?? null},
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)), true, now())
    RETURNING id::text AS id`;
  return { zoneId: created!.id, action: "created" as const, areaM2 };
}

/**
 * Rattache chaque capteur a la plus petite zone active qui contient sa position.
 * Un capteur situe hors de toute zone active garde son rattachement et est signale.
 */
export async function reassignSensorZones(prisma: PrismaClient) {
  const moved = await prisma.$queryRaw<{ code: string; zoneName: string }[]>`
    WITH target AS (
      SELECT s.id, (
        SELECT z.id FROM zones z
        WHERE z.is_active AND ST_Covers(z.geometry, s.position)
        ORDER BY ST_Area(z.geometry) ASC LIMIT 1
      ) AS zone_id
      FROM sensors s
    )
    UPDATE sensors s SET zone_id = t.zone_id, updated_at = now()
    FROM target t
    WHERE s.id = t.id AND t.zone_id IS NOT NULL AND s.zone_id <> t.zone_id
    RETURNING s.code, (SELECT name FROM zones WHERE id = t.zone_id) AS "zoneName"`;

  const outside = await prisma.$queryRaw<{ code: string }[]>`
    SELECT s.code FROM sensors s
    WHERE NOT EXISTS (
      SELECT 1 FROM zones z WHERE z.is_active AND ST_Covers(z.geometry, s.position)
    )
    ORDER BY s.code`;

  return { moved, outside: outside.map((row) => row.code) };
}
