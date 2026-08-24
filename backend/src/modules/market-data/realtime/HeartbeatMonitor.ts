export interface HeartbeatConfig {
  /**
   * Maximum gap between consecutive data messages before `onTimeout`
   * is invoked. Binance doesn't send explicit heartbeats on stream
   * payloads, so we use frame activity as a proxy.
   */
  timeoutMs: number;
  onTimeout: () => void;
}

const DEFAULT_CHECK_DIVISOR = 3;

/**
 * Cheap watchdog: stamps the last activity timestamp every time
 * `beat()` is called and probes it on a recurring interval. If the gap
 * exceeds `timeoutMs`, `onTimeout` fires once. The owner is responsible
 * for stopping the monitor and tearing down the underlying socket.
 */
export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastBeat = Date.now();

  constructor(private readonly cfg: HeartbeatConfig) {}

  start(): void {
    if (this.timer) return;
    this.lastBeat = Date.now();
    const interval = Math.max(1_000, Math.floor(this.cfg.timeoutMs / DEFAULT_CHECK_DIVISOR));
    this.timer = setInterval(() => this.check(), interval);
    // Don't keep the event loop alive solely for this timer.
    this.timer.unref?.();
  }

  beat(): void {
    this.lastBeat = Date.now();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    if (Date.now() - this.lastBeat > this.cfg.timeoutMs) {
      // Stop the loop first so we never fire twice.
      this.stop();
      try {
        this.cfg.onTimeout();
      } catch {
        /* swallow — disconnect path is the owner's responsibility */
      }
    }
  }
}
