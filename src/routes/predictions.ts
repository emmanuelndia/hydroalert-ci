import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, paginatedSchema } from "../schemas/common.js";
import { listPredictionsQuerySchema, predictionSchema } from "../schemas/domain.js";
import { listPredictions } from "../services/predictions.js";

export const predictionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/predictions",
    {
      schema: {
        tags: ["Predictions"],
        summary: "Historique des evaluations du risque (plus recentes d'abord)",
        querystring: listPredictionsQuerySchema,
        response: { 200: paginatedSchema(predictionSchema), 400: errorResponseSchema },
      },
    },
    async (request) => listPredictions(app.prisma, request.query),
  );
};
