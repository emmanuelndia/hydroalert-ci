import { AlertLevel } from "@prisma/client";
import { z } from "zod";

/**
 * Configuration du backend, lue et validee une seule fois a partir des variables d'environnement.
 * Voir .env.example pour la description de chaque variable.
 */
const alertLevelListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((level) => level.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(AlertLevel)));

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    API_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
    CORS_ORIGINS: z.string().trim().min(1).optional(),
    RISK_EVALUATOR: z.enum(["rule", "none"]).optional(),
    RULE_CRITICAL_WATER_LEVEL_CM: z.coerce.number().positive().max(1000).default(100),
    ALERT_VALIDATION_LEVELS: alertLevelListSchema.optional(),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(100_000).default(120),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.CORS_ORIGINS !== undefined, {
    message: "CORS_ORIGINS est obligatoire en production (liste d'origines separees par des virgules)",
    path: ["CORS_ORIGINS"],
  });

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  /** Adresse a laquelle les clients joignent l'API (sans / final). */
  publicUrl: string;
  /** "*" pour toutes les origines, sinon la liste exacte des origines autorisees. */
  corsOrigins: "*" | string[];
  /** Calcul de risque utilise apres chaque mesure : regle provisoire ou aucun (decision d'equipe en attente). */
  riskEvaluator: "rule" | "none";
  /** Niveau d'eau (cm) correspondant a un score de 100 dans la regle provisoire. */
  ruleCriticalWaterLevelCm: number;
  /** Niveaux d'alerte qui attendent une validation humaine avant diffusion. */
  alertValidationLevels: AlertLevel[];
  /** Derriere un proxy (Render), lire l'adresse du client dans X-Forwarded-For. */
  trustProxy: boolean;
  /** Requetes autorisees par minute et par adresse IP ; 0 desactive la limite. */
  rateLimitMax: number;
};

export class ConfigError extends Error {
  constructor(public readonly variables: string[], details: string[]) {
    super(`Configuration invalide :\n- ${details.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function parseOrigins(value: string): "*" | string[] {
  if (value === "*") return "*";
  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Les variables vides sont traitees comme absentes.
  const raw = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Seuls les noms de variables et les messages sont affiches, jamais les valeurs.
    const issues = result.error.issues;
    throw new ConfigError(
      issues.map((issue) => String(issue.path[0])),
      issues.map((issue) => `${String(issue.path[0])} : ${issue.message}`),
    );
  }

  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    publicUrl: (parsed.API_PUBLIC_URL ?? `http://127.0.0.1:${parsed.PORT}`).replace(/\/+$/, ""),
    corsOrigins: parseOrigins(parsed.CORS_ORIGINS ?? "*"),
    // La regle provisoire n'est pas activee en production tant que l'equipe ne l'a pas validee.
    riskEvaluator: parsed.RISK_EVALUATOR ?? (parsed.NODE_ENV === "production" ? "none" : "rule"),
    ruleCriticalWaterLevelCm: parsed.RULE_CRITICAL_WATER_LEVEL_CM,
    alertValidationLevels: [...new Set(parsed.ALERT_VALIDATION_LEVELS ?? [])],
    trustProxy: parsed.TRUST_PROXY === "true",
    rateLimitMax: parsed.RATE_LIMIT_MAX,
  };
}
