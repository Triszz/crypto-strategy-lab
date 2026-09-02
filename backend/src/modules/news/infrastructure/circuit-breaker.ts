import { logger, Logger } from "../../../shared/logger/logger";

/**
 * State machine for the circuit breaker.
 *
 *  CLOSED      → normal operation; calls pass through.
 *                After `failureThreshold` consecutive failures the machine
 *                transitions to OPEN.
 *
 *  OPEN        → calls are rejected immediately (fast-fail) with the
 *                reason "Circuit open". After `resetTimeoutMs` the machine
 *                transitions to HALF_OPEN so the next call can probe
 *                whether the downstream service has recovered.
 *
 *  HALF_OPEN   → one probe call is allowed through.
 *                Success → transition to CLOSED (failures counter reset).
 *                Failure → transition back to OPEN (timer restarted).
 *
 * The breaker is scoped per adapter so a failure in Cryptopanic does NOT
 * affect RSS and vice-versa.
 */
export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3. */
  failureThreshold?: number;
  /** Milliseconds to wait before attempting recovery (OPEN → HALF_OPEN). Default: 60 000. */
  resetTimeoutMs?: number;
  /** Optional logger; falls back to the shared Pino logger. */
  logger?: Logger;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly log: Logger;

  constructor(private readonly name: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.log = options.logger ?? logger;
  }

  /**
   * Returns the current state. Exposed for monitoring / diagnostics.
   */
  public getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Executes `fn` through the circuit breaker. If the circuit is OPEN
   * the function is NOT called; instead a `CircuitOpenError` is thrown.
   *
   * Any error thrown by `fn` counts as a failure and increments the
   * internal counter. Successful calls reset it to zero.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === CircuitState.OPEN) {
      this.log.debug(
        { event: "circuit_breaker.rejected", name: this.name, state: this.state },
        `Circuit ${this.name} is OPEN; rejecting call`,
      );
      throw new CircuitOpenError(this.name, this.resetTimeoutMs);
    }

    // state === HALF_OPEN or CLOSED
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === CircuitState.OPEN &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.log.info(
        { event: "circuit_breaker.half_open", name: this.name },
        `Circuit ${this.name} transitioning OPEN → HALF_OPEN (timeout expired)`,
      );
      this.state = CircuitState.HALF_OPEN;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.log.info(
        { event: "circuit_breaker.closed", name: this.name },
        `Circuit ${this.name} transitioning HALF_OPEN → CLOSED (probe succeeded)`,
      );
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  private onFailure(err: unknown): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Probe failed → go back to OPEN
      this.log.warn(
        { event: "circuit_breaker.reopen", name: this.name, err },
        `Circuit ${this.name} HALF_OPEN probe failed; returning OPEN`,
      );
      this.state = CircuitState.OPEN;
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.log.warn(
        {
          event: "circuit_breaker.open",
          name: this.name,
          failureCount: this.failureCount,
          threshold: this.failureThreshold,
        },
        `Circuit ${this.name} opening (${this.failureCount} consecutive failures)`,
      );
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Resets the breaker to CLOSED. Intended for tests.
   */
  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

/**
 * Thrown by `CircuitBreaker.execute()` when the circuit is OPEN.
 * NOT a subclass of `AppError` — callers must handle this specifically
 * (fast-fail, do not retry).
 */
export class CircuitOpenError extends Error {
  public override readonly name = "CircuitOpenError";
  public readonly circuitName: string;
  public readonly retryAfterMs: number;

  constructor(circuitName: string, retryAfterMs: number) {
    super(`Circuit '${circuitName}' is open. Retry after ${Math.round(retryAfterMs / 1000)}s.`);
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}
