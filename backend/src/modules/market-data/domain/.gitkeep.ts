/**
 * market-data · domain
 *
 * Domain entities, value objects and ports (interfaces) for the
 * Market Data Service.
 *
 * Rules (enforced by code review, not yet by tooling):
 * - MUST NOT import from `@prisma/client`, `express`, `socket.io`,
 *   `ioredis`, `bullmq`, or any Binance SDK.
 * - MUST NOT import from sibling modules.
 * - May import from `src/shared/types` only for genuinely shared types.
 *
 * Skeleton note: this file currently exports nothing. The concrete
 * `Candle` value object, `Timeframe` literal type and
 * `CandleRepository` port will be added by the market-data owner in
 * a later task, mirroring the contract defined in
 * `docs/Market Data Service.md`.
 */

// TODO(market-data): port `Candle`, `Timeframe` and `CandleRepository`
// from docs/Market Data Service.md into this folder.
export {};