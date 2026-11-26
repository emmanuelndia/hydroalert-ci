import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, idParamsSchema, paginatedSchema } from "../schemas/common.js";
import { listZonesQuerySchema, zoneDetailSchema, zoneSummarySchema } from "../schemas/domain.js";
import { getZone, listZones } from "../services/zones.js";

export const zoneRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/zones",
    {
      schema: {
        tags: ["Zones"],
        summary: "Lister les zones (sans geometrie)",
        querystring: listZonesQuerySchema,
        response: { 200: paginatedSchema(zoneSummarySchema), 400: errorResponseSchema },
      },
    },
    async (request) => listZones(app.prisma, request.query),
  );

  app.get(
    "/zones/:id",
    {
      schema: {
        tags: ["Zones"],
        summary: "Detail d'une zone avec sa geometrie GeoJSON",
        params: idParamsSchema,
        response: { 200: zoneDetailSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => getZone(app.prisma, request.params.id),
  );
};
