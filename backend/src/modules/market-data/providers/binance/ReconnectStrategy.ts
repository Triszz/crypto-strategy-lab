/**
 * Exponential backoff strategy for WebSocket reconnection.
 */
export class ReconnectStrategy {
  public attempt = 0;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(baseDelayMs = 1000, maxDelayMs = 30000) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  reset(): void {
    this.attempt = 0;
  }

  stop(): void {
    this.attempt = 0;
  }

  next(): number {
    return this.nextDelay();
  }

  nextDelay(): number {
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.attempt),
      this.maxDelayMs,
    );
    this.attempt++;
    return delay;
  }

  getAttempt(): number {
    return this.attempt;
  }
}
