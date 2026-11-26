/** Erreur metier convertie en reponse HTTP par le gestionnaire d'erreurs global. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(resource: string) {
  return new HttpError(404, "NOT_FOUND", `${resource} introuvable`);
}
