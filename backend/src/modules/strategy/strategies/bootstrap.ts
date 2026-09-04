/**
 * strategy · strategies · bootstrap
 *
 * Registers every built-in BASE strategy into the process-wide
 * `StrategyRegistry`. This is the ONLY place where concrete strategy
 * classes are mapped to their `implementationRef` strings. Adding a new
 * strategy = adding one `registry.register(...)` line here (and the
 * corresponding `.ts` file). Backtest, Search, Evaluation, Leaderboard
 * and Market Data MUST NOT change.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * Usage:
 *   import { bootstrapStrategies } from "./bootstrap";
 *   bootstrapStrategies();
 *
 * The bootstrap is idempotent: calling it twice is a no-op (the
 * registry's `register` throws on duplicates, but `bootstrap` first
 * `has()`-checks so the call is safe to repeat). Calling it AFTER a
 * different strategy has registered the same id will surface that
 * duplicate as a throw — which is the intended early-failure signal.
 */
import { getStrategyRegistry } from "../domain/StrategyRegistry";
import type { Strategy } from "../domain/Strategy";
import { BollingerBandsStrategy } from "./BollingerBandsStrategy";
import { MovingAverageStrategy } from "./MovingAverageStrategy";
import { RsiStrategy } from "./RsiStrategy";
import { SupportResistanceStrategy } from "./SupportResistanceStrategy";
import { NewsSentimentStrategy } from "./NewsSentimentStrategy";

/** The list of built-in BASE strategies shipped with this build. */
export const BUILT_IN_STRATEGIES: ReadonlyArray<Strategy> = [
  new MovingAverageStrategy(),
  new RsiStrategy(),
  new BollingerBandsStrategy(),
  new SupportResistanceStrategy(),
  new NewsSentimentStrategy(),
];

/**
 * Register every built-in strategy into the runtime registry. Safe to
 * call multiple times — strategies that are already registered are
 * skipped. Throws if a duplicate id is detected on the first call.
 */
export function bootstrapStrategies(): void {
  const registry = getStrategyRegistry();
  for (const strategy of BUILT_IN_STRATEGIES) {
    if (registry.has(strategy.id)) {
      continue;
    }
    registry.register(strategy);
  }
}