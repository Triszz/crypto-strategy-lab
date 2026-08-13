/**
 * strategy · domain
 *
 * Pure domain code:
 * - `Strategy` interface (BR-008, BR-009, BR-010).
 * - `Signal`, `StrategyContext`, `StrategyFamily` value objects.
 * - `StrategyRegistry` plugin registry.
 * - `CombinationEngine` + `WeightedCombiner`.
 *
 * Rules:
 * - MUST NOT import from `@prisma/client`, `express`, `socket.io`,
 *   `ioredis`, `bullmq`, or any Binance SDK.
 * - MUST NOT import from sibling modules.
 *
 * Skeleton note: nothing is exported yet. The owner will add concrete
 * implementations for MA, RSI, Bollinger, SupportResistance in later
 * tasks.
 */

// TODO(strategy): add `Strategy` interface and the four MVP strategies.
// TODO(strategy): add `CombinationEngine`, `WeightedCombiner`,
// `StrategyRegistry`.
export {};