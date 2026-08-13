/**
 * Standard application error. Domain modules SHOULD throw AppError
 * (or a subclass) so that the global error middleware can render a
 * consistent JSON response without leaking implementation details.
 */
export type ErrorCode =
  | "INTERNAL_SERVER_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "SERVICE_UNAVAILABLE"
  | "UPSTREAM_ERROR";

export interface AppErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public override readonly cause: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? "INTERNAL_SERVER_ERROR";
    this.details = options.details;
    this.cause = options.cause;

    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === "function") {
      (Error as unknown as { captureStackTrace: (target: object, ctor: Function) => void })
        .captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): {
    success: false;
    error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
  } {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 400, code: "VALIDATION_ERROR", details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, { statusCode: 404, code: "NOT_FOUND" });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { statusCode: 400, code: "BAD_REQUEST", details });
  }
}