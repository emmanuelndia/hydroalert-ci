import { Prisma, type PrismaClient, type SensorType } from "@prisma/client";
import {
  MEASUREMENT_LIMITS,
  type MeasurementInput,
  measurementInputSchema,
} from "../schemas/measurement-input.js";

/**
 * Reception d'une mesure de capteur, independante du transport (MQTT, simulateur, ...).
 * Regles : docs/Regles_Metier_HydrOAlerte_CI.txt, sections 1 et 2.
 */

export type IngestionErrorCode =
  | "INVALID_MEASUREMENT"
  | "UNKNOWN_SENSOR"
  | "SENSOR_UNAVAILABLE";

export class IngestionError extends Error {
  constructor(
    public readonly code: IngestionErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

export type IngestionResult = {
  status: "accepted" | "duplicate";
  measurementId: string;
  sensor: { id: string; code: string; zoneId: string; type: SensorType };
  measuredAt: Date;
};

/** Valeur obligatoire selon le type de capteur ; AUTRE accepte n'importe quelle valeur. */
const REQUIRED_VALUE: Record<SensorType, keyof MeasurementInput | null> = {
  NIVEAU_EAU: "waterLevelCm",
  PLUIE: "rainMm",
  DEBIT: "flowRate",
  AUTRE: null,
};

function parseInput(rawInput: unknown): MeasurementInput {
  const result = measurementInputSchema.safeParse(rawInput);
  if (!result.success) {
    throw new IngestionError(
      "INVALID_MEASUREMENT",
      "Mesure invalide",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

export async function ingestMeasurement(
  prisma: PrismaClient,
  rawInput: unknown,
  options: { receivedAt?: Date } = {},
): Promise<IngestionResult> {
  const receivedAt = options.receivedAt ?? new Date();
  const input = parseInput(rawInput);

  if (input.measuredAt.getTime() > receivedAt.getTime() + MEASUREMENT_LIMITS.maxFutureSkewMs) {
    throw new IngestionError("INVALID_MEASUREMENT", "La date de mesure est dans le futur", [
      { path: "measuredAt", message: "Plus de 5 minutes apres l'heure de reception" },
    ]);
  }

  const sensor = await prisma.sensor.findUnique({
    where: { code: input.sensorCode },
    select: { id: true, code: true, zoneId: true, type: true, status: true },
  });
  if (!sensor) {
    throw new IngestionError("UNKNOWN_SENSOR", `Capteur inconnu : ${input.sensorCode}`);
  }
  if (sensor.status === "EN_MAINTENANCE" || sensor.status === "DESACTIVE") {
    throw new IngestionError(
      "SENSOR_UNAVAILABLE",
      `Le capteur ${sensor.code} est ${sensor.status} : mesure refusee`,
    );
  }

  const required = REQUIRED_VALUE[sensor.type];
  if (required && input[required] === undefined) {
    throw new IngestionError(
      "INVALID_MEASUREMENT",
      `Un capteur ${sensor.type} doit fournir ${required}`,
      [{ path: required, message: "Valeur obligatoire pour ce type de capteur" }],
    );
  }

  const sensorSummary = { id: sensor.id, code: sensor.code, zoneId: sensor.zoneId, type: sensor.type };
  const duplicateOf = (measurementId: string): IngestionResult => ({
    status: "duplicate",
    measurementId,
    sensor: sensorSummary,
    measuredAt: input.measuredAt,
  });

  const existing = await prisma.measurement.findUnique({
    where: { sensorId_measuredAt: { sensorId: sensor.id, measuredAt: input.measuredAt } },
    select: { id: true },
  });
  if (existing) return duplicateOf(existing.id);

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.measurement.findFirst({
        where: { sensorId: sensor.id },
        orderBy: { measuredAt: "desc" },
        select: { measuredAt: true },
      });
      const isMostRecent = !latest || input.measuredAt >= latest.measuredAt;

      const measurement = await tx.measurement.create({
        data: {
          sensorId: sensor.id,
          measuredAt: input.measuredAt,
          receivedAt,
          waterLevelCm: input.waterLevelCm ?? null,
          rainMm: input.rainMm ?? null,
          flowRate: input.flowRate ?? null,
          batteryPct: input.batteryPct ?? null,
          // Message d'origine conserve tel quel pour le diagnostic.
          rawPayload: rawInput as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await tx.sensor.update({
        where: { id: sensor.id },
        data: {
          lastCommunication: receivedAt,
          status: "ACTIF",
          ...(isMostRecent && input.batteryPct !== undefined && { batteryPct: input.batteryPct }),
        },
      });

      return {
        status: "accepted" as const,
        measurementId: measurement.id,
        sensor: sensorSummary,
        measuredAt: input.measuredAt,
      };
    });
  } catch (error) {
    // Retransmission simultanee : la contrainte unique (capteur, date) a joue.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.measurement.findUnique({
        where: { sensorId_measuredAt: { sensorId: sensor.id, measuredAt: input.measuredAt } },
        select: { id: true },
      });
      if (winner) return duplicateOf(winner.id);
    }
    throw error;
  }
}
