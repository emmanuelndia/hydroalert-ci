import { z } from "zod";

/**
 * Contrat PROVISOIRE d'une mesure de capteur, fonde sur les champs proposes dans les documents
 * (identifiant du capteur, horodatage, niveau d'eau en cm, batterie). Il sera ajuste au contrat
 * MQTT definitif fourni par le responsable IoT ; le reste de la chaine n'en depend pas.
 */
export const MEASUREMENT_LIMITS = {
  waterLevelCm: { min: 0, max: 1000 },
  rainMm: { min: 0, max: 500 },
  flowRate: { min: 0, max: 1_000_000 },
  batteryPct: { min: 0, max: 100 },
  /** Tolerance sur une horloge de capteur en avance. */
  maxFutureSkewMs: 5 * 60 * 1000,
} as const;

const bounded = (limits: { min: number; max: number }) =>
  z.number().finite().min(limits.min).max(limits.max);

export const measurementInputSchema = z
  .object({
    sensorCode: z.string().trim().min(1).max(64),
    measuredAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    waterLevelCm: bounded(MEASUREMENT_LIMITS.waterLevelCm).optional(),
    rainMm: bounded(MEASUREMENT_LIMITS.rainMm).optional(),
    flowRate: bounded(MEASUREMENT_LIMITS.flowRate).optional(),
    batteryPct: z.number().int().min(0).max(100).optional(),
  })
  .refine(
    (m) => m.waterLevelCm !== undefined || m.rainMm !== undefined || m.flowRate !== undefined,
    { message: "Au moins une valeur mesuree est requise (waterLevelCm, rainMm ou flowRate)" },
  );

export type MeasurementInput = z.infer<typeof measurementInputSchema>;
