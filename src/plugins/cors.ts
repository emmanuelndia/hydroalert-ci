import cors from "@fastify/cors";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppConfig } from "../config.js";

/**
 * Autorise les applications web (navigateur) a appeler l'API depuis une autre origine.
 * Les applications mobiles et les services serveur (IA, IoT) ne sont pas concernes par CORS.
 * La liste des origines sera resserree au lot 11 avec les responsables clients.
 */
const corsPluginImplementation: FastifyPluginAsync<{ origins: AppConfig["corsOrigins"] }> = async (
  app,
  { origins },
) => {
  await app.register(cors, {
    origin: origins === "*" ? true : origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: false,
  });
};

export const corsPlugin = fp(corsPluginImplementation, { name: "cors" });
