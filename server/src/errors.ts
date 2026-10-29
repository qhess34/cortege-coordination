export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Ressource') => new HttpError(404, what + ' introuvable.');
export const forbidden = () => new HttpError(403, 'Action non autorisée.');
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
