import type { Prediction, Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { displayColor } from "../domain/risk.js";
import { paginationMeta, toSkipTake } from "../schemas/common.js";
import type { listPredictionsQuerySchema } from "../schemas/domain.js";

function toPrediction(prediction: Prediction) {
  return {
    id: prediction.id,
    zoneId: prediction.zoneId,
    riskScore: prediction.riskScore,
    riskLevel: prediction.riskLevel,
    displayColor: displayColor(prediction.riskLevel),
    probability: prediction.probability?.toNumber() ?? null,
    horizonHours: prediction.horizonHours?.toNumber() ?? null,
    origin: prediction.origin,
    modelVersion: prediction.modelVersion,
    predictedAt: prediction.predictedAt.toISOString(),
    createdAt: prediction.createdAt.toISOString(),
  };
}

export async function listPredictions(
  prisma: PrismaClient,
  query: z.infer<typeof listPredictionsQuerySchema>,
) {
  const where: Prisma.PredictionWhereInput = {
    ...(query.zoneId && { zoneId: query.zoneId }),
    ...(query.riskLevel && { riskLevel: query.riskLevel }),
  };
  const [predictions, total] = await prisma.$transaction([
    prisma.prediction.findMany({ where, orderBy: { predictedAt: "desc" }, ...toSkipTake(query) }),
    prisma.prediction.count({ where }),
  ]);

  return { data: predictions.map(toPrediction), pagination: paginationMeta(query, total) };
}
