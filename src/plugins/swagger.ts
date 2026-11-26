import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

/** Documentation OpenAPI generee a partir des schemas Zod ; interface sur /docs. */
const swaggerPluginImplementation: FastifyPluginAsync<{ publicUrl: string }> = async (
  app,
  { publicUrl },
) => {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      servers: [{ url: publicUrl, description: "Adresse configuree par API_PUBLIC_URL" }],
      info: {
        title: "HydrO'Alerte CI - API backend",
        description:
          "API de consultation des zones, capteurs, mesures et alertes. Les donnees de developpement sont fictives.",
        version: "0.1.1",
      },
      tags: [
        { name: "Sante", description: "Disponibilite de l'API et de la base" },
        { name: "Zones" },
        { name: "Capteurs" },
        { name: "Mesures" },
        { name: "Alertes" },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: "/docs" });
};

export const swaggerPlugin = fp(swaggerPluginImplementation, { name: "swagger" });
