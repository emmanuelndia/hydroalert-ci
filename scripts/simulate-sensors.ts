/**
 * Simulateur de capteur : envoie une serie de mesures dans la chaine complete
 * (enregistrement -> evaluation du risque -> alerte), comme le fera l'abonne MQTT.
 *
 * Usage :
 *   pnpm simulate --sensor CAP-COC-01 --from 30 --to 110 --steps 8 --interval 2
 *   pnpm simulate --sensor CAP-COC-03 --rain --from 0 --to 20 --steps 5
 *
 * Options :
 *   --sensor    code du capteur (defaut CAP-COC-01)
 *   --from/--to valeur de depart et d'arrivee (niveau d'eau en cm, ou pluie en mm avec --rain)
 *   --steps     nombre de mesures (defaut 8)
 *   --interval  secondes entre deux mesures (defaut 2)
 *   --rain      envoie rainMm au lieu de waterLevelCm
 *   --remote    confirme l'ecriture sur une base qui n'est pas locale (ex. Neon)
 *
 * La base utilisee est celle de DATABASE_URL (base locale par defaut).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { ConfigError, loadConfig } from "../src/config.js";
import { displayColor } from "../src/domain/risk.js";
import { IngestionError } from "../src/services/ingestion.js";
import { processMeasurement } from "../src/services/measurement-pipeline.js";
import { assertWritableTarget } from "./lib/target-database.js";

const { values } = parseArgs({
  options: {
    sensor: { type: "string", default: "CAP-COC-01" },
    from: { type: "string", default: "30" },
    to: { type: "string", default: "110" },
    steps: { type: "string", default: "8" },
    interval: { type: "string", default: "2" },
    rain: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

// Refuse d'ecrire sur une base distante (ex. Neon) sans --remote explicite.
assertWritableTarget({ remote: values.remote });

const from = Number(values.from);
const to = Number(values.to);
const steps = Math.max(1, Math.floor(Number(values.steps)));
const intervalMs = Math.max(0, Number(values.interval)) * 1000;
if ([from, to, steps, intervalMs].some((n) => !Number.isFinite(n))) {
  console.error("Options numeriques invalides (--from, --to, --steps, --interval).");
  process.exit(1);
}

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

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const field = values.rain ? "rainMm" : "waterLevelCm";
const unit = values.rain ? "mm" : "cm";

console.log(
  `Simulation ${values.sensor} : ${field} de ${from} a ${to} ${unit} en ${steps} mesure(s)` +
    ` | evaluation : ${config.riskEvaluator}, niveau critique ${config.ruleCriticalWaterLevelCm} cm` +
    ` | validation requise : ${config.alertValidationLevels.join(", ") || "aucune"}\n`,
);

try {
  for (let i = 0; i < steps; i++) {
    const value = steps === 1 ? to : from + ((to - from) * i) / (steps - 1);
    const rounded = Math.round(value * 10) / 10;
    const payload = {
      sensorCode: values.sensor,
      measuredAt: new Date().toISOString(),
      [field]: rounded,
      batteryPct: 90,
    };

    try {
      const result = await processMeasurement(prisma, payload, { config });
      const prediction = result.prediction
        ? `score ${String(result.prediction.score).padStart(3)} ${result.prediction.riskLevel} (${displayColor(result.prediction.riskLevel)})`
        : `pas de prediction (${result.skipped})`;
      const alert = result.alert
        ? result.alert.action === "none"
          ? "aucune alerte"
          : `alerte ${result.alert.action} : ${result.alert.level} / ${result.alert.status}`
        : "-";
      console.log(`[${i + 1}/${steps}] ${field}=${rounded} ${unit} -> ${prediction} -> ${alert}`);
    } catch (error) {
      if (error instanceof IngestionError) {
        console.log(`[${i + 1}/${steps}] mesure refusee : ${error.code} - ${error.message}`);
      } else {
        throw error;
      }
    }

    if (i < steps - 1) await sleep(intervalMs);
  }
} finally {
  await prisma.$disconnect();
}
