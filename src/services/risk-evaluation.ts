import type { PredictionOrigin, Prisma, PrismaClient, RiskLevel } from "@prisma/client";
import { riskLevelFromScore } from "../domain/risk.js";

/**
 * Evaluation du risque d'une zone. L'interface permettra de brancher le service IA externe
 * (origine IA) quand son contrat sera defini, sans modifier la chaine de traitement.
 */
export type RiskEvaluation = {
  score: number;
  riskLevel: RiskLevel;
  origin: PredictionOrigin;
  modelVersion: string | null;
  inputSummary: Prisma.InputJsonObject;
};

export interface RiskEvaluator {
  readonly origin: PredictionOrigin;
  /** Renvoie null quand aucune donnee exploitable ne permet de conclure. */
  evaluate(prisma: PrismaClient, zoneId: string, now: Date): Promise<RiskEvaluation | null>;
}

export const RULE_VERSION = "regle-provisoire-v1";
export const RULE_WINDOW_MINUTES = 60;
export const RULE_MAX_RAIN_BONUS = 15;

/**
 * Regle PROVISOIRE (a valider par l'equipe) :
 * score = min(100, round(niveau d'eau max / niveau critique x 100) + min(15, pluie cumulee sur 1 h en mm)).
 */
export function computeRuleScore(
  input: { maxWaterLevelCm: number | null; rainLastHourMm: number | null },
  criticalWaterLevelCm: number,
): number {
  const waterScore =
    input.maxWaterLevelCm === null
      ? 0
      : Math.round((Math.max(0, input.maxWaterLevelCm) / criticalWaterLevelCm) * 100);
  const rainBonus = Math.min(RULE_MAX_RAIN_BONUS, Math.max(0, input.rainLastHourMm ?? 0));
  return Math.min(100, Math.round(waterScore + rainBonus));
}

export class ProvisionalRuleEvaluator implements RiskEvaluator {
  readonly origin = "REGLE" as const;

  constructor(private readonly criticalWaterLevelCm: number) {}

  async evaluate(prisma: PrismaClient, zoneId: string, now: Date): Promise<RiskEvaluation | null> {
    const since = new Date(now.getTime() - RULE_WINDOW_MINUTES * 60_000);
    const sensors = await prisma.sensor.findMany({
      where: { zoneId, status: "ACTIF" },
      select: {
        code: true,
        measurements: {
          where: { measuredAt: { gte: since, lte: new Date(now.getTime() + 5 * 60_000) } },
          orderBy: { measuredAt: "desc" },
          select: { measuredAt: true, waterLevelCm: true, rainMm: true },
        },
      },
    });

    const waterReadings: { sensor: string; waterLevelCm: number; measuredAt: string }[] = [];
    const rainTotals: { sensor: string; rainMm: number }[] = [];
    for (const sensor of sensors) {
      const latestWater = sensor.measurements.find((m) => m.waterLevelCm !== null);
      if (latestWater?.waterLevelCm) {
        waterReadings.push({
          sensor: sensor.code,
          waterLevelCm: latestWater.waterLevelCm.toNumber(),
          measuredAt: latestWater.measuredAt.toISOString(),
        });
      }
      const rain = sensor.measurements.filter((m) => m.rainMm !== null);
      if (rain.length > 0) {
        rainTotals.push({
          sensor: sensor.code,
          rainMm: rain.reduce((sum, m) => sum + (m.rainMm?.toNumber() ?? 0), 0),
        });
      }
    }

    if (waterReadings.length === 0 && rainTotals.length === 0) return null;

    const maxWaterLevelCm = waterReadings.length
      ? Math.max(...waterReadings.map((r) => r.waterLevelCm))
      : null;
    // Plusieurs pluviometres mesurent la meme pluie : on retient le cumul le plus eleve.
    const rainLastHourMm = rainTotals.length ? Math.max(...rainTotals.map((r) => r.rainMm)) : null;
    const score = computeRuleScore({ maxWaterLevelCm, rainLastHourMm }, this.criticalWaterLevelCm);

    return {
      score,
      riskLevel: riskLevelFromScore(score),
      origin: this.origin,
      modelVersion: RULE_VERSION,
      inputSummary: {
        note: "Regle provisoire, a valider par l'equipe",
        formula: `min(100, round(eauMax / ${this.criticalWaterLevelCm} x 100) + min(${RULE_MAX_RAIN_BONUS}, pluie 1 h))`,
        windowMinutes: RULE_WINDOW_MINUTES,
        maxWaterLevelCm,
        rainLastHourMm,
        waterReadings,
        rainTotals,
      },
    };
  }
}
