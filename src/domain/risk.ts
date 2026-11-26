import type { AlertLevel, RiskLevel } from "@prisma/client";

/**
 * Niveaux de risque et seuils de score fixes par le PowerPoint de mi-parcours :
 * NORMAL 0-39, VIGILANCE 40-64, DANGER 65-84, EVACUATION 85-100.
 */
export const RISK_THRESHOLDS = [
  { level: "EVACUATION", min: 85 },
  { level: "DANGER", min: 65 },
  { level: "VIGILANCE", min: 40 },
  { level: "NORMAL", min: 0 },
] as const satisfies readonly { level: RiskLevel; min: number }[];

const RANK: Record<RiskLevel, number> = { NORMAL: 0, VIGILANCE: 1, DANGER: 2, EVACUATION: 3 };

/** Couleur d'affichage proposee ; le niveau reste la valeur metier de reference. */
const COLORS: Record<RiskLevel, "vert" | "orange" | "rouge"> = {
  NORMAL: "vert",
  VIGILANCE: "orange",
  DANGER: "rouge",
  EVACUATION: "rouge",
};

export function riskLevelFromScore(score: number): RiskLevel {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError(`Score de risque invalide : ${score} (entier de 0 a 100 attendu)`);
  }
  const match = RISK_THRESHOLDS.find((threshold) => score >= threshold.min);
  // Toujours defini : le dernier seuil vaut 0.
  return match!.level;
}

/** NORMAL ne genere pas d'alerte ; les autres niveaux ont un niveau d'alerte du meme nom. */
export function alertLevelFor(level: RiskLevel): AlertLevel | null {
  return level === "NORMAL" ? null : level;
}

export function levelRank(level: RiskLevel | AlertLevel): number {
  return RANK[level];
}

export function displayColor(level: RiskLevel | AlertLevel) {
  return COLORS[level];
}
