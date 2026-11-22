/** An error that maps directly onto an HTTP response. Thrown by routes and models. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = "sign in required") => new HttpError(401, message);
export const forbidden = (message = "you don't have access to this") => new HttpError(403, message);
export const notFound = (message = "not found") => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
