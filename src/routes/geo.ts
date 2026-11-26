import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema } from "../schemas/common.js";
import {
  locateQuerySchema,
  locateResponseSchema,
  nearbyQuerySchema,
  nearbyResponseSchema,
  sensorFeatureCollectionSchema,
  sensorsGeoJsonQuerySchema,
  zoneFeatureCollectionSchema,
} from "../schemas/domain.js";
import {
  locateZones,
  nearbySensors,
  sensorsFeatureCollection,
  zonesFeatureCollection,
} from "../services/geo.js";

/** Donnees cartographiques (lot 6) : GeoJSON et recherches geographiques. */
export const geoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/zones/geojson",
    {
      schema: {
        tags: ["Cartographie"],
        summary: "Zones actives en GeoJSON, avec niveau de risque, alerte publiee et couleur",
        response: { 200: zoneFeatureCollectionSchema },
      },
    },
    async () => zonesFeatureCollection(app.prisma),
  );

  app.get(
    "/zones/locate",
    {
      schema: {
        tags: ["Cartographie"],
        summary: "Zones actives qui contiennent un point (latitude, longitude)",
        querystring: locateQuerySchema,
        response: { 200: locateResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request) => locateZones(app.prisma, request.query),
  );

  app.get(
    "/sensors/geojson",
    {
      schema: {
        tags: ["Cartographie"],
        summary: "Capteurs (hors desactives) en GeoJSON, avec leur derniere mesure",
        querystring: sensorsGeoJsonQuerySchema,
        response: { 200: sensorFeatureCollectionSchema, 400: errorResponseSchema },
      },
    },
    async (request) =>
      sensorsFeatureCollection(app.prisma, request.query.zoneId ? { zoneId: request.query.zoneId } : {}),
  );

  app.get(
    "/sensors/nearby",
    {
      schema: {
        tags: ["Cartographie"],
        summary: "Capteurs dans un rayon en metres autour d'un point, du plus proche au plus eloigne",
        querystring: nearbyQuerySchema,
        response: { 200: nearbyResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request) => nearbySensors(app.prisma, request.query),
  );
};
