import type { PrismaClient, RiskLevel } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { type AlertAction, applyPrediction } from "./alerting.js";
import { type IngestionResult, ingestMeasurement } from "./ingestion.js";
import { ProvisionalRuleEvaluator, type RiskEvaluator } from "./risk-evaluation.js";

/**
 * Point d'entree unique de la chaine : mesure -> enregistrement -> evaluation du risque -> alerte.
 * Utilise par le simulateur, puis par l'abonne MQTT quand le contrat IoT sera defini.
 */

export type PipelineConfig = Pick<
  AppConfig,
  "riskEvaluator" | "ruleCriticalWaterLevelCm" | "alertValidationLevels"
>;

export type PipelineResult = {
  ingestion: IngestionResult;
  /** Raison pour laquelle aucune prediction n'a ete produite. */
  skipped: "duplicate" | "zone-inactive" | "evaluator-disabled" | "no-data" | null;
  prediction: { id: string; score: number; riskLevel: RiskLevel; origin: string } | null;
  alert: AlertAction | null;
};

export async function processMeasurement(
  prisma: PrismaClient,
  rawInput: unknown,
  deps: { config: PipelineConfig; evaluator?: RiskEvaluator; now?: Date },
): Promise<PipelineResult> {
  const now = deps.now ?? new Date();
  const ingestion = await ingestMeasurement(prisma, rawInput, { receivedAt: now });
  const result = (skipped: PipelineResult["skipped"]): PipelineResult => ({
    ingestion,
    skipped,
    prediction: null,
    alert: null,
  });

  if (ingestion.status === "duplicate") return result("duplicate");

  const zone = await prisma.zone.findUnique({
    where: { id: ingestion.sensor.zoneId },
    select: { isActive: true },
  });
  // Une zone inactive reste dans l'historique mais n'alimente plus de prediction automatique.
  if (!zone?.isActive) return result("zone-inactive");

  const evaluator =
    deps.evaluator ??
    (deps.config.riskEvaluator === "rule"
      ? new ProvisionalRuleEvaluator(deps.config.ruleCriticalWaterLevelCm)
      : null);
  if (!evaluator) return result("evaluator-disabled");

  const evaluation = await evaluator.evaluate(prisma, ingestion.sensor.zoneId, now);
  if (!evaluation) return result("no-data");

  const prediction = await prisma.prediction.create({
    data: {
      zoneId: ingestion.sensor.zoneId,
      riskScore: evaluation.score,
      riskLevel: evaluation.riskLevel,
      origin: evaluation.origin,
      modelVersion: evaluation.modelVersion,
      inputSummary: evaluation.inputSummary,
      predictedAt: now,
    },
    select: { id: true, zoneId: true, riskScore: true, riskLevel: true, origin: true },
  });

  const alert = await applyPrediction(prisma, prediction, {
    validationLevels: deps.config.alertValidationLevels,
    now,
  });

  return {
    ingestion,
    skipped: null,
    prediction: {
      id: prediction.id,
      score: prediction.riskScore,
      riskLevel: prediction.riskLevel,
      origin: prediction.origin,
    },
    alert,
  };
}
