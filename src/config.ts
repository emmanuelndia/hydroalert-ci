import { z } from "zod";

/**
 * Configuration du backend, lue et validee une seule fois a partir des variables d'environnement.
 * Voir .env.example pour la description de chaque variable.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    API_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
    CORS_ORIGINS: z.string().trim().min(1).optional(),
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
  };
}
