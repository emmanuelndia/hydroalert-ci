import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { type AppConfig, loadConfig } from "./config.js";
import { corsPlugin } from "./plugins/cors.js";
import { errorsPlugin } from "./plugins/errors.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { alertRoutes } from "./routes/alerts.js";
import { healthRoutes } from "./routes/health.js";
import { sensorRoutes } from "./routes/sensors.js";
import { zoneRoutes } from "./routes/zones.js";

export type BuildAppOptions = {
  logger?: boolean;
  databaseCheck?: () => Promise<void>;
  /** Valeurs de configuration prioritaires sur les variables d'environnement (tests). */
  config?: Partial<AppConfig>;
};

export function buildApp(options: BuildAppOptions = {}) {
  const config: AppConfig = { ...loadConfig(), ...options.config };
  const app = Fastify({ logger: options.logger ?? true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(errorsPlugin);
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

  return app;
}
