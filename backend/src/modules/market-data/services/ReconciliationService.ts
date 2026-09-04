import { setTimeout as wait } from "node:timers/promises";
import type { Logger } from "../../../shared/logger/logger";
import type { Timeframe } from "../core/types";
import type { MarketDataProvider } from "../core/ports";
import type { CandleRepository } from "../core/ports";

export interface ReconcileResult {
  stream: string;
  fetched: number;
  upserted: number;
  skipped: boolean;
  reason?: string;
}

export interface ReconcileConfig {
  intervalMs: number;
  enabled: boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;
const RATE_LIMIT_SLEEP_MS = 80;

/**
 * Detects and fills gaps in candle data by comparing DB state with
 * exchange REST. Runs in two modes:
 *
 *   1. Reconnect-triggered: fire once when the WebSocket reconnects,
 *      fetching candles from `latestDB.openTime + 1` to now.
 *   2. Periodic: run every N seconds as a fallback net (default 60s).
 *
 * The service is intentionally opportunistic: if a stream has no DB
 * rows yet, we skip reconciliation (the boot backfill handles initial
 * seeding). If a stream reconciles successfully, we log the result and
 * move on — no retries, no circuit breakers.
 */
export class ReconciliationService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repo: CandleRepository,
    private readonly logger: Logger,
    private readonly config: ReconcileConfig = {
      intervalMs: DEFAULT_INTERVAL_MS,
      enabled: true,
    },
  ) {}

  startPeriodic(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcileAll("periodic");
    }, this.config.intervalMs);
  }

  stopPeriodic(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Reconcile all active streams. Returns per-stream results.
   * Trigger can be "reconnect" or "periodic" for logging.
   */
  async reconcileAll(trigger: string): Promise<ReconcileResult[]> {
    const streams = this.provider.activeStreams();
    if (streams.length === 0) {
      return [];
    }

    const results: ReconcileResult[] = [];
    for (const streamKey of streams) {
      const parsed = parseStreamKey(streamKey);
      if (!parsed) {
        results.push({
          stream: streamKey,
          fetched: 0,
          upserted: 0,
          skipped: true,
          reason: "invalid-stream-key",
        });
        continue;
      }

      try {
        const result = await this.reconcileOne(
          parsed.symbol,
          parsed.timeframe,
          streamKey,
        );
        results.push(result);
      } catch (err) {
        this.logger.error(
          {
            stream: streamKey,
            trigger,
            err: (err as Error).message,
          },
          "market-data.reconcile.error",
        );
        results.push({
          stream: streamKey,
          fetched: 0,
          upserted: 0,
          skipped: true,
          reason: (err as Error).message,
        });
      }

      // Gentle throttle
      await wait(RATE_LIMIT_SLEEP_MS);
    }

    return results;
  }

  private async reconcileOne(
    symbol: string,
    timeframe: Timeframe,
    streamKey: string,
  ): Promise<ReconcileResult> {
    const latest = await this.repo.getLatestOpen(symbol, timeframe);
    if (!latest) {
      // No DB rows → skip (boot backfill handles initial seeding)
      return {
        stream: streamKey,
        fetched: 0,
        upserted: 0,
        skipped: true,
        reason: "no-db-rows",
      };
    }

    const fromMs = latest.openTime + 1;
    const untilMs = Date.now();
    if (fromMs >= untilMs) {
      // Already fresh
      return {
        stream: streamKey,
        fetched: 0,
        upserted: 0,
        skipped: true,
        reason: "already-fresh",
      };
    }

    // Fetch missing candles
    let fetched = 0;
    let upserted = 0;
    for await (const batch of this.provider.fetchSince(
      symbol,
      timeframe,
      fromMs,
      untilMs,
    )) {
      if (batch.length === 0) continue;
      fetched += batch.length;
      const inserted = await this.repo.upsertBatch(batch);
      upserted += inserted;
    }

    return {
      stream: streamKey,
      fetched,
      upserted,
      skipped: false,
    };
  }
}

interface ParsedStream {
  symbol: string;
  timeframe: Timeframe;
}

function parseStreamKey(streamKey: string): ParsedStream | null {
  // streamKey format: "btcusdt@kline_1m"
  const match = streamKey.match(/^(.+)@kline_(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    symbol: match[1].toUpperCase(),
    timeframe: match[2] as Timeframe,
  };
}
