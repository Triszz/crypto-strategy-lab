/**
 * strategy · domain · StrategyContext
 *
 * The pure input a Strategy receives for ONE candle analysis. The
 * Backtester (or any future live runner) constructs this per candle and
 * calls `strategy.analyze(ctx)`.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * The candle history is intentionally a plain `ReadonlyArray<Candle>` of
 * plain numbers (epoch ms + OHLCV) rather than the Prisma-decimal
 * representation used by `PostgresCandleRepository`. This keeps the
 * Strategy domain free of decimal precision concerns and lets tests use
 * simple numeric fixtures.
 */

/**
 * A minimal, pure candle view used by Strategy domain code. Field types
 * are deliberately primitive so Strategy implementations can be tested
 * without touching Prisma, Redis, or any external adapter.
 *
 * NOTE: This is the *domain* Candle. It is structurally a subset of the
 * market-data module's internal `Candle` (`market-data/domain/Candle.ts`)
 * but lives in strategy/domain so the Strategy domain has zero compile-
 * time dependency on the market-data module.
 */
export interface StrategyCandle {
  /** Epoch milliseconds (Binance convention). */
  readonly openTime: number;
  /** Epoch milliseconds. */
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Timeframe identifier as understood by the Strategy domain. Mirrors
 * the market-data module's `SUPPORTED_TIMEFRAMES` (`"1m" | "5m" | "15m"
 * | "1h" | "4h" | "1d"`) but defined here as a string literal so the
 * Strategy domain never imports the market-data module.
 */
export type StrategyTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * Strategy-family classification. Mirrors the Prisma `strategy_family`
 * enum (`TREND | MOMENTUM | STRUCTURE | VOLATILITY | SENTIMENT`) so
 * values can be mapped 1:1 by `infrastructure/` without conversion. The
 * domain MUST NOT import `@prisma/client`, so it carries its own literal.
 */
export type StrategyFamily =
  | "TREND"
  | "MOMENTUM"
  | "STRUCTURE"
  | "VOLATILITY"
  | "SENTIMENT";

/**
 * Parameters shape. The Strategy contract deliberately leaves the
 * contents untyped: each strategy defines its own ParamSpec and
 * parameter shape (e.g. `{ period: 14, oversold: 30 }` for RSI). The
 * domain receives a `Readonly<Record<string, unknown>>` so the Strategy
 * implementation is the only place that knows the concrete keys.
 *
 * The Strategy implementation MUST validate parameters via
 * `Strategy.validateParameters(p)` before iterating; this contract
 * documents that the caller has already done so.
 */
export type StrategyParameters = Readonly<Record<string, unknown>>;

/**
 * The input slice passed to `Strategy.analyze(ctx)`. The caller (the
 * Backtester) is responsible for:
 *   1. Loading at least `strategy.requiredHistory` candles + the current
 *      one;
 *   2. Validating parameters via `strategy.validateParameters(p)`;
 *   3. Passing them in this immutable shape.
 *
 * `history` is the candles *preceding* and *including* the current
 * candle, sorted ASCENDING by `openTime`. `history[history.length-1]`
 * equals `candle`.
 */
export interface StrategyContext {
  readonly symbol: string;
  readonly timeframe: StrategyTimeframe;
  /** The current candle being analysed. Also `history[history.length-1]`. */
  readonly candle: StrategyCandle;
  /** ASCENDING by `openTime`. Length must be ≥ `strategy.requiredHistory + 1`. */
  readonly history: ReadonlyArray<StrategyCandle>;
  /** Already validated parameters for this strategy instance. */
  readonly parameters: StrategyParameters;
  /** Optional wall-clock now (epoch ms). Defaults to `Date.now()` upstream. */
  readonly now?: number;
  /** Free-form context (experimental flags, debugging, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}