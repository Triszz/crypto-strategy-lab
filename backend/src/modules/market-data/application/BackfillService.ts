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
}

const RATE_LIMIT_SLEEP_MS = 80;
const DEFAULT_INITIAL_CANDLES = 1_000;
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
      });
      // Gentle throttle so concurrent boots don't hammer the API.
      await wait(RATE_LIMIT_SLEEP_MS);
    }
    this.logger.info({ progress }, "market-data.backfill.complete");
    return progress;
  }

  /**
   * Fetch `limit` candles older than `beforeMs` for the supplied
   * (symbol, timeframe) pair and persist them. Returns the rows in
   * ascending order so callers can splice them into the existing
   * dataset without re-sorting.
   */
  async loadMore(
    symbol: string,
    timeframe: Timeframe,
    beforeMs: number,
    limit = DEFAULT_INITIAL_CANDLES,
  ): Promise<Candle[]> {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_PER_REQUEST);
    const rows = await this.rest.fetchKlines({
      symbol,
      timeframe,
      endMs: beforeMs,
      limit: safeLimit,
    });
    if (rows.length === 0) return rows;
    await this.repo.upsertBatch(rows);
    this.logger.debug(
      { symbol, timeframe, count: rows.length, beforeMs },
      "market-data.backfill.load-more",
    );
    return rows.sort((a, b) => a.openTime - b.openTime);
  }
}
