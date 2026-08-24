export interface ReconnectConfig {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  jitterRatio: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialMs: 1_000,
  maxMs: 30_000,
  multiplier: 2,
  jitterRatio: 0.2,
};

/**
 * Computes the delay for the next reconnect attempt using an
 * exponential backoff with symmetric jitter. The attempt counter
 * survives across reconnects; call `reset()` once a connection is
 * established.
 *
 *   attempt 1 -> 1000ms ±20%
 *   attempt 2 -> 2000ms ±20%
 *   attempt 3 -> 4000ms ±20%
 *   attempt 5 -> 16000ms ±20%
 *   attempt 6+ -> 30000ms (capped)
 */
export class ReconnectStrategy {
  public attempt = 0;
  private stopped = false;

  constructor(private readonly cfg: ReconnectConfig = DEFAULT_RECONNECT_CONFIG) {}

  /** Returns the delay (ms) until the next attempt and increments the counter. */
  next(): number {
    if (this.stopped) {
      throw new Error("reconnect strategy stopped");
    }
    const base = Math.min(
      this.cfg.initialMs * this.cfg.multiplier ** this.attempt,
      this.cfg.maxMs,
    );
    const jitter = base * this.cfg.jitterRatio * (Math.random() * 2 - 1);
    this.attempt += 1;
    return Math.max(0, Math.floor(base + jitter));
  }

  reset(): void {
    this.attempt = 0;
  }

  stop(): void {
    this.stopped = true;
  }
}
