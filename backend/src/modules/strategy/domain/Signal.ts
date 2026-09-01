/**
 * strategy · domain · Signal
 *
 * The pure output of a Strategy's `analyze(ctx)` call. A Signal represents
 * the strategy's *intent* for one candle; the Backtester is responsible
 * for turning intent into trades and applying position-sizing / exit rules.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * Conventions:
 *  - `side === "HOLD"` is the default; signals with `strength === 0`
 *    are conceptually equivalent and the Backtester treats both the same.
 *  - `strength` is bounded to `[-1, 1]`. Negative = bearish, positive =
 *    bullish. Magnitude encodes confidence.
 *  - `confidence` is an optional `[0, 1]` score; some cannot report a
 *    meaningful confidence (e.g. MA crossover) and may leave it undefined.
 *  - `reason` is a short human-readable rationale for logs / debug UI.
 *  - `metadata` carries strategy-specific readouts (e.g. RSI value, band
 *    touches); MUST NOT contain row ids, candle arrays, or any other
 *    infrastructure-level data.
 */
export type SignalSide = "BUY" | "SELL" | "HOLD";

export interface Signal {
  /** Position-direction intent. */
  readonly side: SignalSide;
  /**
   * Magnitude in `[-1, 1]`. Sign matches `side` (BUY ⇒ ≥ 0, SELL ⇒ ≤ 0,
   * HOLD ⇒ 0). Used by CombinationEngine / Backtester for weighting.
   */
  readonly strength: number;
  /** Optional `[0, 1]` confidence; absent when the strategy cannot express it. */
  readonly confidence?: number;
  /** Short human-readable rationale. Free-form; not localized. */
  readonly reason?: string;
  /** Strategy-specific readouts (e.g. `{ rsi: 28.4 }`). Never carries row ids. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Convenience constructor for a HOLD signal. Centralised so Backtest /
 * Combination can detect a flat position intent uniformly.
 */
export function holdSignal(reason?: string, metadata?: Readonly<Record<string, unknown>>): Signal {
  return reason === undefined && metadata === undefined
    ? { side: "HOLD", strength: 0 }
    : reason !== undefined && metadata !== undefined
      ? { side: "HOLD", strength: 0, reason, metadata }
      : reason !== undefined
        ? { side: "HOLD", strength: 0, reason }
        : { side: "HOLD", strength: 0, metadata: metadata as Readonly<Record<string, unknown>> };
}