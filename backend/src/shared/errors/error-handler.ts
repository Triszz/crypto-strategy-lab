import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./AppError";
import { isProduction, loadEnv } from "../../config/env";
import { logger } from "../logger/logger";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Route ${req.method} ${req.path} not found`, { statusCode: 404, code: "NOT_FOUND" }));
}

/**
 * Global Express error middleware. Renders all errors as a uniform JSON
 * shape. Stack traces are NEVER exposed in production responses.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const env = loadEnv();
  const production = isProduction(env);

  if (err instanceof AppError) {
    logger.warn(
      { err: { name: err.name, code: err.code, statusCode: err.statusCode, message: err.message } },
      "Handled application error",
    );
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  if (err instanceof ZodError) {
    const validationError = new AppError("Request validation failed", {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      details: { issues: err.issues },
    });
    logger.warn({ err: validationError.toJSON() }, "Zod validation error");
    res.status(400).json(validationError.toJSON());
    return;
  }

  // Unknown error -> internal server error. Log full error, but only
  // expose a generic message in production.
  logger.error({ err }, "Unhandled error");
  const generic = new AppError(
    production ? "Internal server error" : (err as Error)?.message ?? "Internal server error",
    { statusCode: 500, code: "INTERNAL_SERVER_ERROR", cause: err },
  );
  const payload = generic.toJSON();
  if (production) {
    delete (payload.error as { details?: unknown }).details;
  } else {
    (payload.error as { details?: unknown }).details = {
      ...(generic.details ?? {}),
      stack: (err as Error)?.stack,
    };
  }
  res.status(500).json(payload);
}