import "dotenv/config";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const app = buildApp({ config });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { publicUrl: config.publicUrl, docs: `${config.publicUrl}/docs`, cors: config.corsOrigins },
    "API HydrO'Alerte CI prete",
  );
} catch (error) {
  app.log.error(error, "Failed to start the API server");
  process.exitCode = 1;
}
