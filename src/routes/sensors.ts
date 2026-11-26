import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, idParamsSchema, paginatedSchema } from "../schemas/common.js";
import {
  listMeasurementsQuerySchema,
  listSensorsQuerySchema,
  measurementSchema,
  sensorSchema,
} from "../schemas/domain.js";
import { getSensor, listSensorMeasurements, listSensors } from "../services/sensors.js";

export const sensorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/sensors",
    {
      schema: {
        tags: ["Capteurs"],
        summary: "Lister les capteurs",
        querystring: listSensorsQuerySchema,
        response: { 200: paginatedSchema(sensorSchema), 400: errorResponseSchema },
      },
    },
    async (request) => listSensors(app.prisma, request.query),
  );

  app.get(
    "/sensors/:id",
    {
      schema: {
        tags: ["Capteurs"],
        summary: "Detail d'un capteur",
        params: idParamsSchema,
        response: { 200: sensorSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => getSensor(app.prisma, request.params.id),
  );

  app.get(
    "/sensors/:id/measurements",
    {
      schema: {
        tags: ["Mesures"],
        summary: "Historique des mesures d'un capteur (plus recentes d'abord)",
        params: idParamsSchema,
        querystring: listMeasurementsQuerySchema,
        response: {
          200: paginatedSchema(measurementSchema),
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => listSensorMeasurements(app.prisma, request.params.id, request.query),
  );
};
