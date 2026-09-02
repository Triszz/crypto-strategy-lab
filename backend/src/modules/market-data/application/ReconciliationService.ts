import { setTimeout as wait } from "node:timers/promises";
import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../domain/Candle";
import {
  getBinanceStreamName,
  parseBinanceInterval,
  timeframeToMs,
  type Timeframe,
} from "../domain/Timeframe";
import type { BinanceRestAdapter } from "../infrastructure/BinanceRestAdapter";
import type { BinanceWsAdapter } from "../infrastructure/BinanceWsAdapter";
import type { CandleRepository } from "../domain/CandleRepository.port";

const INTER_STREAM_SLEEP_MS = 100;
/** Hard cap on REST calls per single reconcile run — guards against runaway gaps. */
const MAX_REST_CALLS_PER_RUN = 50;

export interface ReconciliationConfig {
  /** When > 0, run periodic reconciliation every `intervalMs`. 0 disables. */
  intervalMs: number;
  /** Master switch for reconnect-triggered reconciliation. */
  enabled: boolean;
}

export type ReconcileTrigger = "periodic" | "reconnect" | "manual";

export type ReconcileSkipReason =
  | "no_gap"
  | "empty_db"
  | "no_active"
  | "disabled"
  | "error";

export interface ReconciliationResult {
  stream: string;
  symbol: string;
  timeframe: Timeframe;
  skipped: boolean;
  reason?: ReconcileSkipReason;
  fetched: number;
  upserted: number;
  batches: number;
  durationMs: number;
  error?: string;
}

/**
 * Fills candle gaps that occur while the WebSocket is disconnected.
 *
 * Two trigger paths, both routing through the same per-stream worker:
 *
 *   1. **Reconnect Reconciliation** — fired by `MarketDataService` the
 *      moment `BinanceWsAdapter` transitions from `"reconnecting"` to
 *      `"connected"`. Catches gaps immediately after WS recovery.
 *
 *   2. **Periodic Reconciliation** — a `setInterval` loop catching any
 *      silent drop that escaped trigger (1), e.g. Binance closes a
 *      candle during a TCP half-open window, the adapter reconnects
 *      but the close message never reaches us.
 *
 * Both paths share `reconcileGap(symbol, timeframe)` so multiple
 * triggers coalesce via a per-stream `Promise` map — never run two
 * reconciliations for the same `(symbol, timeframe)` simultaneously.
 *
 * Reference: docs/Market Data Service.md §15.
 */
export class ReconciliationService {
  private readonly inFlight = new Map<string, Promise<ReconciliationResult>>();
  private periodicTimer: NodeJS.Timeout | null = null;
  private runningPeriodic = false;

  constructor(
    private readonly rest: BinanceRestAdapter,
    private readonly repo: CandleRepository,
    private readonly wsAdapter: BinanceWsAdapter,
    private readonly logger: Logger,
    private readonly cfg: ReconciliationConfig,
  ) {}

  // ── Periodic lifecycle ──────────────────────────────────────────────────

  startPeriodic(): void {
    if (!this.cfg.enabled) {
      this.logger.info(
        "market-data.reconcile.periodic.disabled-by-config",
      );
      return;
    }
    if (this.cfg.intervalMs <= 0) {
      this.logger.info(
        { intervalMs: this.cfg.intervalMs },
        "market-data.reconcile.periodic.disabled",
      );
      return;
    }
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      void this.tickPeriodic();
    }, this.cfg.intervalMs);
    this.periodicTimer.unref?.();
    this.logger.info(
      { intervalMs: this.cfg.intervalMs },
      "market-data.reconcile.periodic.started",
    );
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
      this.logger.info("market-data.reconcile.periodic.stopped");
    }
  }

  private async tickPeriodic(): Promise<void> {
    if (this.runningPeriodic) {
      // Coalesce overlapping intervals — never run two sweeps in parallel.
      this.logger.debug("market-data.reconcile.periodic.skipped-overlap");
      return;
    }
    this.runningPeriodic = true;
    try {
      const results = await this.reconcileAll("periodic");
      const filled = results.filter((r) => !r.skipped);
      if (filled.length > 0) {
        this.logger.info(
          { streams: filled.length, total: results.length },
          "market-data.reconcile.periodic.filled",
        );
      }
    } finally {
      this.runningPeriodic = false;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Reconcile every stream currently held by the WS adapter. Throttles
   * between streams so a 4-chart boot doesn't hammer the API.
   */
  async reconcileAll(
    trigger: ReconcileTrigger,
  ): Promise<ReconciliationResult[]> {
    const streams = this.wsAdapter.activeStreams();
    if (streams.length === 0) return [];
    const results: ReconciliationResult[] = [];
    for (const stream of streams) {
      const parsed = parseStream(stream);
      if (!parsed) {
        results.push({
          stream,
          symbol: "UNKNOWN",
          timeframe: "1m",
          skipped: true,
          reason: "no_active",
          fetched: 0,
          upserted: 0,
          batches: 0,
          durationMs: 0,
        });
        continue;
      }
      const result = await this.reconcileGap(
        parsed.symbol,
        parsed.timeframe,
        trigger,
      );
      results.push(result);
      await wait(INTER_STREAM_SLEEP_MS);
    }
    return results;
  }

  /**
   * Idempotent per-stream gap fill. If a reconcile for the same stream
   * is already running, returns the existing promise.
   */
  async reconcileGap(
    symbol: string,
    timeframe: Timeframe,
    trigger: ReconcileTrigger = "manual",
  ): Promise<ReconciliationResult> {
    if (!this.cfg.enabled && trigger !== "manual") {
      return {
        stream: getBinanceStreamName(symbol, timeframe),
        symbol,
        timeframe,
        skipped: true,
        reason: "disabled",
        fetched: 0,
        upserted: 0,
        batches: 0,
        durationMs: 0,
      };
    }
    const stream = getBinanceStreamName(symbol, timeframe);
    const existing = this.inFlight.get(stream);
    if (existing) {
      this.logger.debug(
        { stream, trigger },
        "market-data.reconcile.coalesced",
      );
      return existing;
    }
    const promise = this.runReconcile(symbol, timeframe, trigger);
    this.inFlight.set(stream, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(stream);
    }
  }

  // ── Worker ──────────────────────────────────────────────────────────────

  private async runReconcile(
    symbol: string,
    timeframe: Timeframe,
    trigger: ReconcileTrigger,
  ): Promise<ReconciliationResult> {
    const started = Date.now();
    const stream = getBinanceStreamName(symbol, timeframe);
    const tfMs = timeframeToMs(timeframe);

    let fetched = 0;
    let upserted = 0;
    let batches = 0;

    try {
      const dbLatest = await this.repo.getLatestOpen(symbol, timeframe);

      if (!dbLatest) {
        // Empty DB → boot backfill handles this; periodic/reconnect
        // reconcile is not the right tool (would fetch too much).
        this.logger.debug(
          { stream, trigger },
          "market-data.reconcile.skip-empty-db",
        );
        return {
          stream,
          symbol,
          timeframe,
          skipped: true,
          reason: "empty_db",
          fetched: 0,
          upserted: 0,
          batches: 0,
          durationMs: Date.now() - started,
        };
      }

      const now = Date.now();
      // Last CLOSED candle openTime = floor((now - tfMs) / tfMs) * tfMs.
      // The candle currently being formed (openTime == lastClosedOpenTime + tfMs)
      // is excluded — it has `x=false` and Binance still owns it.
      const lastClosedOpenTime = Math.floor(now / tfMs) * tfMs - tfMs;

      if (dbLatest.openTime >= lastClosedOpenTime) {
        // Skip logging when no gap (too verbose in production)
        return {
          stream,
          symbol,
          timeframe,
          skipped: true,
          reason: "no_gap",
          fetched: 0,
          upserted: 0,
          batches: 0,
          durationMs: Date.now() - started,
        };
      }

      const fromMs = dbLatest.openTime + 1;
      const untilMs = lastClosedOpenTime;

      this.logger.info(
        {
          trigger,
          stream,
          fromMs,
          untilMs,
          gapCandles: Math.floor((untilMs - fromMs) / tfMs) + 1,
        },
        "market-data.reconcile.start",
      );

      for await (const batch of this.rest.fetchSince(
        symbol,
        timeframe,
        fromMs,
        untilMs,
      )) {
        fetched += batch.length;
        batches += 1;
        if (batch.length > 0) {
          upserted += await this.repo.upsertBatch(batch);
        }
        if (batches >= MAX_REST_CALLS_PER_RUN) {
          this.logger.warn(
            {
              stream,
              trigger,
              batches,
              fromMs,
              untilMs,
            },
            "market-data.reconcile.too-large",
          );
          break;
        }
      }

      // Sanity check: after reconcile, DB should be caught up to lastClosedOpenTime.
      const after = await this.repo.getLatestOpen(symbol, timeframe);
      const stillStale =
        !after || after.openTime < lastClosedOpenTime;

      this.logger.info(
        {
          trigger,
          stream,
          fetched,
          upserted,
          batches,
          durationMs: Date.now() - started,
          dbLatestOpenTime: after?.openTime ?? null,
          stillStale,
        },
        "market-data.reconcile.complete",
      );

      return {
        stream,
        symbol,
        timeframe,
        skipped: false,
        fetched,
        upserted,
        batches,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      this.logger.error(
        {
          trigger,
          stream,
          symbol,
          timeframe,
          err: (err as Error).message,
          fetched,
          upserted,
          batches,
          durationMs: Date.now() - started,
        },
        "market-data.reconcile.failed",
      );
      return {
        stream,
        symbol,
        timeframe,
        skipped: true,
        reason: "error",
        fetched,
        upserted,
        batches,
        durationMs: Date.now() - started,
        error: (err as Error).message,
      };
    }
  }
}

/**
 * Parse a Binance combined-stream key into symbol + timeframe.
 * Format: `btcusdt@kline_1m` → `{ symbol: "BTCUSDT", timeframe: "1m" }`.
 */
function parseStream(stream: string): { symbol: string; timeframe: Timeframe } | null {
  const m = stream.match(/^([a-z0-9]+)@kline_([a-z0-9]+)$/);
  if (!m || !m[1] || !m[2]) return null;
  const symbol = m[1].toUpperCase();
  try {
    const timeframe = parseBinanceInterval(m[2]);
    return { symbol, timeframe };
  } catch {
    return null;
  }
}

export type { Candle };