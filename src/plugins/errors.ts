import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { HttpError } from "../lib/http-errors.js";

/**
 * Format unique des erreurs API :
 * { "error": { "code": "...", "message": "...", "details"?: ... } }
 */
const errorsPluginImplementation: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "La requete contient des donnees invalides",
          details: error.validation.map((issue) => ({
            location: error.validationContext,
            path: issue.instancePath,
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    // Erreurs client produites par Fastify (JSON mal forme, corps trop volumineux, ...).
    if (
      !isResponseSerializationError(error) &&
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error: { code: error.code ?? "BAD_REQUEST", message: error.message },
      });
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue" },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url.split("?")[0]} introuvable`,
      },
    }),
  );
};

export const errorsPlugin = fp(errorsPluginImplementation, { name: "errors" });
