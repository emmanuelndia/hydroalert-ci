import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { AppConfig } from "../config.js";
import { HttpError } from "../lib/http-errors.js";

/**
 * Protections des endpoints publics (lot 11) :
 * - en-tetes de securite HTTP (helmet) ;
 * - limite de requetes par adresse IP et par minute (hors routes de sante, appelees par Render).
 */
const securityPluginImplementation: FastifyPluginAsync<{ rateLimitMax: AppConfig["rateLimitMax"] }> = async (
  app,
  { rateLimitMax },
) => {
  await app.register(helmet, {
    // L'API renvoie du JSON ; une CSP stricte casserait l'interface Swagger sur /docs.
    contentSecurityPolicy: false,
    // Les applications web et mobiles d'autres origines doivent pouvoir lire les reponses.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  if (rateLimitMax > 0) {
    await app.register(rateLimit, {
      max: rateLimitMax,
      timeWindow: "1 minute",
      allowList: (request) => request.url.startsWith("/health"),
      errorResponseBuilder: (_request, context) =>
        new HttpError(
          429,
          "RATE_LIMITED",
          `Trop de requetes : limite de ${context.max} par minute. Reessayer dans ${context.after}.`,
        ),
    });
  }
};

export const securityPlugin = fp(securityPluginImplementation, { name: "security" });
