/**
 * Market Data module exports.
 * 
 * After refactoring to Provider pattern:
 * - BinanceProvider implements MarketDataProvider interface
 * - Services depend on interfaces, not concrete implementations
 * - Old adapters kept for backward compatibility (will be removed in Phase 7)
 */

// ===== Core Types & Interfaces =====
export type { Candle, Timeframe, ChartConfig } from "./core/types";
export type { MarketDataProvider, CandleRepository, FetchCandlesOptions, ExchangeSymbol } from "./core/ports";
export type { WsConnectionStatus, CandleClosedEvent, CandleUpdatingEvent } from "./core/events";
export { CANDLE_CLOSED_EVENT_VERSION, MARKET_DATA_EVENTS } from "./core/events";

// ===== Providers =====
export { BinanceProvider } from "./providers/binance/BinanceProvider";

// ===== Services =====
export { MarketDataService } from "./services/MarketDataService";
export type { MarketDataStartResult } from "./services/MarketDataService";
export { BackfillService } from "./services/BackfillService";
export type { BackfillProgress } from "./services/BackfillService";
export { ReconciliationService } from "./services/ReconciliationService";
export type { ReconcileResult } from "./services/ReconciliationService";
export { SymbolSyncService } from "./services/SymbolSyncService";
export type { SymbolSyncResult } from "./services/SymbolSyncService";
export { DefaultChartSeeder } from "./services/DefaultChartSeeder";

// ===== Storage =====
export { PostgresCandleRepository } from "./storage/PostgresCandleRepository";

// ===== Realtime =====
export { SocketGateway } from "./realtime/SocketGateway";
export { CandlePersister } from "./realtime/CandlePersister";

// ===== Container =====
export { buildMarketDataContainer } from "./container";
export type { MarketDataContainer, MarketDataContainerOverrides } from "./container";

// ===== Routes =====
export { buildMarketDataRouter } from "./presentation/market-data.routes";

// ===== Domain Helpers =====
export { candleKey, candleRoom, getStreamKey, timeframeToMs } from "./core/types";

// ===== Legacy Exports (Deprecated - removed) =====
// Old adapters have been replaced by BinanceProvider
// Import from providers/binance/* if needed
