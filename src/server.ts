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

// Arret propre (redeploiement Render, Ctrl+C) : les requetes en cours se terminent,
// les nouvelles recoivent 503, puis la connexion a la base est fermee.
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Arret de l'API en cours");
    // Filet de securite : si quelque chose bloque encore apres 10 s, sortie forcee.
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    try {
      await app.close();
      app.log.info("API arretee proprement");
      // Pas de process.exit ici : le processus se termine seul une fois tout ferme.
      process.exitCode = 0;
    } catch (error) {
      app.log.error(error, "Echec de l'arret propre");
      process.exitCode = 1;
    }
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      publicUrl: config.publicUrl,
      docs: `${config.publicUrl}/docs`,
      cors: config.corsOrigins,
      trustProxy: config.trustProxy,
      rateLimitPerMinute: config.rateLimitMax || "desactivee",
      riskEvaluator: config.riskEvaluator,
    },
    "API HydrO'Alerte CI prete",
  );
} catch (error) {
  app.log.error(error, "Failed to start the API server");
  process.exitCode = 1;
}
