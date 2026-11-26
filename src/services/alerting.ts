import { randomUUID } from "node:crypto";
import type { AlertLevel, AlertStatus, PrismaClient, RiskLevel } from "@prisma/client";
import { alertLevelFor, levelRank } from "../domain/risk.js";

/**
 * Cycle de vie automatique des alertes (politique PROVISOIRE, a valider par l'equipe) :
 * - une seule alerte ouverte (en attente de validation ou active) par zone ;
 * - meme niveau : rien (anti-doublon) ;
 * - niveau superieur : l'alerte ouverte est escaladee (niveau, prediction et message mis a jour) ;
 * - niveau inferieur ou NORMAL : rien ; la desescalade et la resolution restent humaines (lot 4).
 */

export const OPEN_ALERT_STATUSES: AlertStatus[] = ["EN_ATTENTE_VALIDATION", "ACTIVE"];

export type AlertAction =
  | { action: "none" }
  | { action: "unchanged"; alertId: string; level: AlertLevel; status: AlertStatus }
  | { action: "created" | "escalated"; alertId: string; level: AlertLevel; status: AlertStatus };

const TEMPLATES: Record<AlertLevel, { title: string; message: string }> = {
  VIGILANCE: {
    title: "Vigilance inondation - {zone}",
    message:
      "Le niveau d'eau monte dans la zone {zone}. Restez attentifs aux consignes et evitez les zones basses et les caniveaux.",
  },
  DANGER: {
    title: "Danger inondation - {zone}",
    message:
      "Risque d'inondation eleve dans la zone {zone}. Evitez les deplacements non necessaires et eloignez-vous des cours d'eau et des zones basses.",
  },
  EVACUATION: {
    title: "Evacuation - {zone}",
    message:
      "Risque d'inondation tres eleve dans la zone {zone}. Preparez-vous a evacuer et suivez les consignes des autorites.",
  },
};

export function alertContent(level: AlertLevel, zoneName: string) {
  const template = TEMPLATES[level];
  return {
    title: template.title.replaceAll("{zone}", zoneName),
    message: template.message.replaceAll("{zone}", zoneName),
  };
}

function alertNumber(now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `ALR-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function applyPrediction(
  prisma: PrismaClient,
  prediction: { id: string; zoneId: string; riskLevel: RiskLevel },
  options: { validationLevels: AlertLevel[]; now?: Date },
): Promise<AlertAction> {
  const now = options.now ?? new Date();
  const level = alertLevelFor(prediction.riskLevel);

  return prisma.$transaction(async (tx) => {
    // Verrou sur la zone : deux mesures simultanees ne peuvent pas creer deux alertes.
    const [zone] = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM zones WHERE id = ${prediction.zoneId}::uuid FOR UPDATE`;
    if (!zone) throw new Error(`Zone ${prediction.zoneId} introuvable`);

    const open = await tx.alert.findFirst({
      where: { zoneId: prediction.zoneId, status: { in: OPEN_ALERT_STATUSES } },
      orderBy: { startsAt: "desc" },
    });

    if (!open) {
      if (!level) return { action: "none" };
      const requiresValidation = options.validationLevels.includes(level);
      const created = await tx.alert.create({
        data: {
          number: alertNumber(now),
          zoneId: prediction.zoneId,
          predictionId: prediction.id,
          level,
          ...alertContent(level, zone.name),
          status: requiresValidation ? "EN_ATTENTE_VALIDATION" : "ACTIVE",
          requiresValidation,
          startsAt: now,
        },
        select: { id: true, level: true, status: true },
      });
      return { action: "created", alertId: created.id, level: created.level, status: created.status };
    }

    if (!level || levelRank(level) <= levelRank(open.level)) {
      return { action: "unchanged", alertId: open.id, level: open.level, status: open.status };
    }

    const escalated = await tx.alert.update({
      where: { id: open.id },
      data: { level, predictionId: prediction.id, ...alertContent(level, zone.name) },
      select: { id: true, level: true, status: true },
    });
    return { action: "escalated", alertId: escalated.id, level: escalated.level, status: escalated.status };
  });
}
