export class AppError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function fail(statusCode, message, details = null) {
  throw new AppError(statusCode, message, details);
}
