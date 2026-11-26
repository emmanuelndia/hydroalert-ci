import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { type AppConfig, loadConfig } from "./config.js";
import { loggerOptions } from "./lib/logger.js";
import { corsPlugin } from "./plugins/cors.js";
import { errorsPlugin } from "./plugins/errors.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { securityPlugin } from "./plugins/security.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { alertRoutes } from "./routes/alerts.js";
import { geoRoutes } from "./routes/geo.js";
import { healthRoutes } from "./routes/health.js";
import { predictionRoutes } from "./routes/predictions.js";
import { sensorRoutes } from "./routes/sensors.js";
import { zoneRoutes } from "./routes/zones.js";

export type BuildAppOptions = {
  logger?: boolean;
  /** Flux de sortie des journaux (tests) ; active la journalisation. */
  logStream?: NodeJS.WritableStream;
  databaseCheck?: () => Promise<void>;
  /** Valeurs de configuration prioritaires sur les variables d'environnement (tests). */
  config?: Partial<AppConfig>;
};

/** Taille maximale d'un corps de requete : 100 Ko suffisent pour les mesures et formulaires. */
export const BODY_LIMIT_BYTES = 100 * 1024;
/** Une requete qui depasse ce delai est interrompue. */
export const REQUEST_TIMEOUT_MS = 30_000;

export function buildApp(options: BuildAppOptions = {}) {
  const config: AppConfig = { ...loadConfig(), ...options.config };
  const logger =
    options.logStream || options.logger !== false ? loggerOptions(options.logStream) : false;
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(errorsPlugin);
  app.register(securityPlugin, { rateLimitMax: config.rateLimitMax });
  app.register(corsPlugin, { origins: config.corsOrigins });
  app.register(swaggerPlugin, { publicUrl: config.publicUrl });
  app.register(
    prismaPlugin,
    options.databaseCheck ? { databaseCheck: options.databaseCheck } : {},
  );

  app.register(healthRoutes);
  app.register(zoneRoutes);
  app.register(sensorRoutes);
  app.register(alertRoutes);
  app.register(predictionRoutes);
  app.register(geoRoutes);

  return app;
}
