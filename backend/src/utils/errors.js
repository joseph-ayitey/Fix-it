/**
 * An error that maps directly onto an HTTP response (as Problem Details, see
 * utils/problems.js). Thrown by routes and models.
 *   details: [{ field, message }] for validation errors
 *   slug: a specific problem type from docs/problems.md, when the status alone isn't enough
 */
export class HttpError extends Error {
  constructor(status, message, details, slug) {
    super(message);
    this.status = status;
    this.details = details;
    this.slug = slug;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = "sign in required") => new HttpError(401, message);
export const forbidden = (message = "you don't have access to this") => new HttpError(403, message);
export const notFound = (message = "not found") => new HttpError(404, message);
export const conflict = (message, slug) => new HttpError(409, message, undefined, slug);
export const unprocessable = (message, slug) => new HttpError(422, message, undefined, slug);
