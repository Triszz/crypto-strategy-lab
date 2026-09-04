import { setTimeout as wait } from "node:timers/promises";
import { loadEnv } from "../../../../config/env";
import type { Logger } from "../../../../shared/logger/logger";
import type { Candle } from "../../core/types";
import type { Timeframe } from "../../core/types";
import {
  TIMEFRAME_TO_BINANCE,
  getBinanceStreamName,
} from "../../core/types";
import {
  CandleNormalizer,
  type BinanceKlineDTO,
} from "./BinanceNormalizer";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 4_000;
const MAX_KLINE_PER_REQUEST = 1_000;
const RATE_LIMIT_SLEEP_MS = 80;

export interface FetchOptions {
  symbol: string;
  timeframe: Timeframe;
  startMs?: number;
  endMs?: number;
  limit?: number;
}

export interface BinanceRestConfig {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Subset of `/api/v3/exchangeInfo` that the Market Data service needs.
 * Only USDT-quoted, TRADING symbols are kept by `SymbolSyncService`.
 */
export interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
    isSpotTradingAllowed?: boolean;
  }>;
}

/**
 * Binance REST client. Public endpoints only — no API key.
 * All Binance-specific knowledge (URL shape, retry policy, rate-limit
 * pause) lives here so the rest of the codebase never imports the SDK.
 */
export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly logger: Logger;

  constructor(cfg: Partial<BinanceRestConfig> & { logger: Logger }) {
    const env = loadEnv();
    this.baseUrl = (cfg.baseUrl ?? env.BINANCE_REST_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.logger = cfg.logger;
  }

  /** Build the canonical `btcusdt@kline_1h` style stream key. */
  getStreamKey(symbol: string, timeframe: Timeframe): string {
    return getBinanceStreamName(symbol, timeframe);
  }

  /**
   * Fetch a single batch of klines. Defaults to the most recent
   * `limit` candles when no cursor is provided.
   */
  async fetchKlines(opts: FetchOptions): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol: opts.symbol,
      interval: TIMEFRAME_TO_BINANCE[opts.timeframe],
      limit: String(opts.limit ?? 500),
    });
    if (opts.startMs !== undefined) params.set("startTime", String(opts.startMs));
    if (opts.endMs !== undefined) params.set("endTime", String(opts.endMs));

    const url = `${this.baseUrl}/api/v3/klines?${params.toString()}`;
    const rows = await this.httpGet<BinanceKlineDTO[]>(url);
    return CandleNormalizer.fromRestKlines(opts.symbol, rows, opts.timeframe);
  }

  /**
   * Convenience helper used by `BackfillService.backfillInitial`.
   * Returns the most recent N candles for `(symbol, timeframe)`.
   */
  fetchLatest(symbol: string, timeframe: Timeframe, limit = 1_000): Promise<Candle[]> {
    return this.fetchKlines({ symbol, timeframe, limit });
  }

  /**
   * Paginated fetch from a starting timestamp up to `untilMs` (default =
   * now). Yields one batch of up to 1000 candles per iteration. Honors
   * Binance's 1200 req/min budget by sleeping 80ms between requests.
   */
  async *fetchSince(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
    untilMs: number = Date.now(),
  ): AsyncGenerator<Candle[], void, void> {
    let cursor = sinceMs;
    while (cursor < untilMs) {
      const batch = await this.fetchKlines({
        symbol,
        timeframe,
        startMs: cursor,
        endMs: untilMs,
        limit: MAX_KLINE_PER_REQUEST,
      });
      if (batch.length === 0) break;

      yield batch;
      const last = batch[batch.length - 1];
      if (!last) break;

      cursor = last.openTime + 1;
      if (cursor >= untilMs) break;
      await wait(RATE_LIMIT_SLEEP_MS);
    }
  }

  /** Returns the exchange's published symbol metadata. */
  async fetchExchangeInfo(): Promise<BinanceExchangeInfo> {
    const url = `${this.baseUrl}/api/v3/exchangeInfo`;
    return this.httpGet<BinanceExchangeInfo>(url);
  }

  private async httpGet<T>(url: string, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Binance HTTP ${res.status}`);
      }
      if (!res.ok) {
        const body = await safeText(res);
        throw new Error(`Binance HTTP ${res.status}: ${body}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (attempt < this.maxRetries && shouldRetry(err)) {
        const delay = Math.min(2 ** attempt * 500, MAX_RETRY_DELAY_MS);
        this.logger.warn(
          { url, attempt, delay, err: (err as Error).message },
          "binance.rest.retry",
        );
        await wait(delay);
        return this.httpGet<T>(url, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function shouldRetry(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return /HTTP (5\d\d|429)/.test(err.message);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 256);
  } catch {
    return "<no-body>";
  }
}
