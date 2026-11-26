import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, idParamsSchema, paginatedSchema } from "../schemas/common.js";
import { alertSchema, listAlertsQuerySchema } from "../schemas/domain.js";
import { getAlert, listAlerts } from "../services/alerts.js";

export const alertRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/alerts",
    {
      schema: {
        tags: ["Alertes"],
        summary: "Lister les alertes (plus recentes d'abord)",
        querystring: listAlertsQuerySchema,
        response: { 200: paginatedSchema(alertSchema), 400: errorResponseSchema },
      },
    },
    async (request) => listAlerts(app.prisma, request.query),
  );

  app.get(
    "/alerts/:id",
    {
      schema: {
        tags: ["Alertes"],
        summary: "Detail d'une alerte",
        params: idParamsSchema,
        response: { 200: alertSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => getAlert(app.prisma, request.params.id),
  );
};
