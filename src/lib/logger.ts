import type { FastifyRequest } from "fastify";

/**
 * Journalisation sans secret : les en-tetes d'authentification ne sont jamais journalises,
 * et les parametres sensibles d'URL (token, key, password, ...) sont masques.
 */
export const MASK = "MASQUE";
const SENSITIVE_QUERY_KEYS = /^(token|access_token|refresh_token|key|api_key|apikey|password|secret)$/i;

export function redactUrl(url: string): string {
  const index = url.indexOf("?");
  if (index === -1) return url;
  const params = new URLSearchParams(url.slice(index + 1));
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      params.set(key, MASK);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, index)}?${params.toString()}` : url;
}

export function loggerOptions(stream?: NodeJS.WritableStream) {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    ...(stream && { stream }),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
        "*.password",
        "*.token",
        "*.accessKey",
      ],
      censor: MASK,
    },
    serializers: {
      // Seules ces informations de la requete sont journalisees : jamais les en-tetes ni le corps.
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          remoteAddress: request.ip,
        };
      },
    },
  };
}
