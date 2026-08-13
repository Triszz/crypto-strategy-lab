/**
 * market-data · infrastructure
 *
 * External integrations for the Market Data Service:
 * - `BinanceRestAdapter` (historical REST)
 * - `BinanceWsAdapter` (realtime WebSocket)
 * - `CandleNormalizer` (Binance DTO -> internal `Candle`)
 * - `PostgresCandleRepository` (Prisma-backed implementation of the
 *   `CandleRepository` port from `domain/`)
 *
 * Skeleton note: nothing is exported yet. Adapters will be added by
 * the market-data owner in a later task.
 */

// TODO(market-data): add Binance adapters, normalizer and Prisma
// repository once the domain port is in place.
export {};