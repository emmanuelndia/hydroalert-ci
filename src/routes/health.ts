import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const livenessSchema = z.object({ status: z.literal("ok").describe("Le processus API repond") });

const readinessSchema = z.object({
  status: z.enum(["ok", "error"]).describe("Etat global"),
  database: z.enum(["ok", "unavailable"]).describe("Etat de la connexion PostgreSQL"),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health/live",
    {
      schema: {
        tags: ["Sante"],
        summary: "Le processus API repond",
        response: { 200: livenessSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/health",
    {
      schema: {
        tags: ["Sante"],
        summary: "L'API et la base de donnees sont disponibles (503 si la base est injoignable)",
        response: { 200: readinessSchema, 503: readinessSchema },
      },
    },
    async (_request, reply) => {
      try {
        await app.databaseCheck();
        return { status: "ok" as const, database: "ok" as const };
      } catch (error) {
        app.log.error({ err: error }, "Database readiness check failed");
        return reply.code(503).send({ status: "error", database: "unavailable" });
      }
    },
  );
};
