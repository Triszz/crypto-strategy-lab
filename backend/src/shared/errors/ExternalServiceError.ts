import { AppError } from "./AppError";

/**
 * Thrown when an external API (Cryptopanic, RSS, etc.) returns a non-2xx
 * response or the request fails outright. The HTTP status is captured
 * so callers can distinguish 4xx (bad input) from 5xx (service down).
 */
export class ExternalServiceError extends AppError {
  public override readonly statusCode: number;

  constructor(message: string, statusCode = 502, cause?: unknown) {
    super(message, {
      statusCode,
      code: "UPSTREAM_ERROR",
      cause,
    });
    this.statusCode = statusCode;
  }
}
