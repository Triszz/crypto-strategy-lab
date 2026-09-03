import { setTimeout as wait } from "node:timers/promises";
import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../domain/Candle";
import { type Timeframe } from "../domain/Timeframe";
import type { BinanceRestAdapter } from "../infrastructure/BinanceRestAdapter";
import type { CandleRepository } from "../domain/CandleRepository.port";
import type { ChartConfig } from "../domain/ChartConfig";

export interface BackfillProgress {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  candles: number;
  batches: number;
  durationMs: number;
  /** Candles deleted by the retention trim (0 when trim is disabled). */
  trimmed: number;
}

const RATE_LIMIT_SLEEP_MS = 80;
const DEFAULT_INITIAL_CANDLES = 1_000;
const DEFAULT_MAX_CANDLES_PER_CHART = 100;
const MAX_PER_REQUEST = 1_000;

/**
 * Coordinates bulk historical fetches against Binance REST and writes
 * them into the `candles` table. The service is used both for the
 * boot-time initial feed (newest N candles per chart pane) and the
 * on-demand "load more" endpoint driven by infinite-scroll charts.
 */
export class BackfillService {
  constructor(
    private readonly rest: BinanceRestAdapter,
    private readonly repo: CandleRepository,
    private readonly logger: Logger,
    private readonly initialCandles: number = DEFAULT_INITIAL_CANDLES,
    /**
     * Retention cap per `(symbol, timeframe)`. After the gap fill on
     * boot, `backfillMissing` trims older candles so the table stays
     * bounded. Set to 0 (or negative) to skip trimming.
     */
    private readonly maxCandlesPerChart: number = DEFAULT_MAX_CANDLES_PER_CHART,
  ) {}

  /**
   * Fetch the newest N candles for every supplied chart config and
   * persist them with idempotent upserts. Returns per-chart progress.
   */
  async backfillInitial(charts: ChartConfig[]): Promise<BackfillProgress[]> {
    const progress: BackfillProgress[] = [];
    for (const chart of charts) {
      const started = Date.now();
      let total = 0;
      let batches = 0;
      try {
        const candles = await this.rest.fetchLatest(
          chart.symbol,
          chart.timeframe,
          Math.min(this.initialCandles, MAX_PER_REQUEST),
        );
        if (candles.length > 0) {
          total = await this.repo.upsertBatch(candles);
          batches = 1;
        }
      } catch (err) {
        this.logger.error(
          {
            chartIndex: chart.chartIndex,
            symbol: chart.symbol,
            timeframe: chart.timeframe,
            err: (err as Error).message,
          },
          "market-data.backfill.failed",
        );
      }
      progress.push({
        chartIndex: chart.chartIndex,
        symbol: chart.symbol,
        timeframe: chart.timeframe,
        candles: total,
        batches,
        durationMs: Date.now() - started,
        trimmed: 0,
      });
      // Gentle throttle so concurrent boots don't hammer the API.
      await wait(RATE_LIMIT_SLEEP_MS);
    }
    this.logger.info({ progress }, "market-data.backfill.complete");
    return progress;
  }

  /**
   * Incremental backfill: fetch only candles newer than the latest
   * one already in the DB. Designed for boot when you want to keep
   * existing data and just catch up.
   *
   * If the DB is empty for `(symbol, timeframe)`, fall back to
   * `fetchLatest(initialCandles)` so a fresh DB still gets seeded.
   */
  async backfillMissing(charts: ChartConfig[]): Promise<BackfillProgress[]> {
    const progress: BackfillProgress[] = [];
    for (const chart of charts) {
      const started = Date.now();
      let total = 0;
      let batches = 0;
      try {
        const latest = await this.repo.getLatestOpen(
          chart.symbol,
          chart.timeframe,
        );

        if (latest === null) {
          // Empty DB → seed with the latest N candles.
          this.logger.info(
            {
              chartIndex: chart.chartIndex,
              symbol: chart.symbol,
              timeframe: chart.timeframe,
            },
            "market-data.backfill-missing.empty-db",
          );
          const candles = await this.rest.fetchLatest(
            chart.symbol,
            chart.timeframe,
            Math.min(this.initialCandles, MAX_PER_REQUEST),
          );
          if (candles.length > 0) {
            total = await this.repo.upsertBatch(candles);
            batches = 1;
          }
        } else {
          // Incremental: from (latest.openTime + 1) → now.
          const fromMs = latest.openTime + 1;
          const untilMs = Date.now();
          if (fromMs >= untilMs) {
            this.logger.debug(
              {
                chartIndex: chart.chartIndex,
                latest: latest.openTime,
                now: untilMs,
              },
              "market-data.backfill-missing.already-fresh",
            );
          } else {
            for await (const batch of this.rest.fetchSince(
              chart.symbol,
              chart.timeframe,
              fromMs,
              untilMs,
            )) {
              if (batch.length === 0) continue;
              const inserted = await this.repo.upsertBatch(batch);
              total += inserted;
              batches++;
            }
          }
        }
      } catch (err) {
        this.logger.error(
          {
            chartIndex: chart.chartIndex,
            symbol: chart.symbol,
            timeframe: chart.timeframe,
            err: (err as Error).message,
          },
          "market-data.backfill-missing.failed",
        );
      }

      // Retention cap — keep only the newest N per chart.
      // Runs after the fill (success or fail) so a failed chart still
      // gets trimmed on the next run.
      let trimmed = 0;
      if (this.maxCandlesPerChart > 0) {
        try {
          trimmed = await this.repo.trimToLatest(
            chart.symbol,
            chart.timeframe,
            this.maxCandlesPerChart,
          );
        } catch (err) {
          this.logger.warn(
            {
              chartIndex: chart.chartIndex,
              symbol: chart.symbol,
              timeframe: chart.timeframe,
              err: (err as Error).message,
            },
            "market-data.backfill-missing.trim-failed",
          );
        }
      }

      progress.push({
        chartIndex: chart.chartIndex,
        symbol: chart.symbol,
        timeframe: chart.timeframe,
        candles: total,
        batches,
        durationMs: Date.now() - started,
        trimmed,
      });
      // Gentle throttle so concurrent boots don't hammer the API.
      await wait(RATE_LIMIT_SLEEP_MS);
    }
    this.logger.info({ progress }, "market-data.backfill-missing.complete");
    return progress;
  }

  /**
   * Fetch `limit` candles older than `beforeMs` for the supplied
   * (symbol, timeframe) pair and persist them. Returns the rows in
   * ascending order so callers can splice them into the existing
   * dataset without re-sorting.
   * 
   * Important: `beforeMs` is the openTime of the oldest candle we already have.
   * We fetch candles BEFORE (older than) this timestamp by setting endMs = beforeMs - 1.
   */
  async loadMore(
    symbol: string,
    timeframe: Timeframe,
    beforeMs: number,
    limit = DEFAULT_INITIAL_CANDLES,
  ): Promise<Candle[]> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_PER_REQUEST);
    
    // Fetch candles BEFORE beforeMs (exclude the candle at beforeMs itself)
    const rows = await this.rest.fetchKlines({
      symbol,
      timeframe,
      endMs: beforeMs - 1,
      limit: safeLimit,
    });
    
    this.logger.debug(
      { symbol, timeframe, beforeMs, limit: safeLimit, fetched: rows.length },
      "backfill.load-more",
    );
    
    if (rows.length === 0) {
      return rows;
    }
    await this.repo.upsertBatch(rows);
    return rows.sort((a, b) => a.openTime - b.openTime);
  }
}
