/**
 * Public surface of the Market Data module.
 *
 * Consumers (server bootstrap, REST routing, future cross-module
 * subscribers) should import from this entry point only. Internal
 * files (adapters, repositories, ...) are intentionally not re-exported
 * — they are implementation details of the module.
 */

export {
  buildMarketDataContainer,
  type MarketDataContainer,
  type MarketDataContainerOverrides,
} from "./container";

export { MarketDataService } from "./application/MarketDataService";
export { BackfillService } from "./application/BackfillService";
export { DefaultChartSeeder } from "./application/DefaultChartSeeder";
export { ReconciliationService } from "./application/ReconciliationService";
export { SymbolSyncService } from "./application/SymbolSyncService";

export { BinanceRestAdapter } from "./infrastructure/BinanceRestAdapter";
export { BinanceWsAdapter } from "./infrastructure/BinanceWsAdapter";
export { PostgresCandleRepository } from "./infrastructure/PostgresCandleRepository";

export { SocketGateway } from "./realtime/SocketGateway";
export { CandlePersister } from "./realtime/CandlePersister";

export { buildMarketDataRouter } from "./presentation/market-data.routes";

export {
  SUPPORTED_TIMEFRAMES,
  DEFAULT_TIMEFRAMES,
  type Timeframe,
  type DefaultTimeframe,
  isSupportedTimeframe,
  isTimeframe,
  getStreamKey,
  getBinanceStreamName,
  parseBinanceInterval,
  timeframeToMs,
  TIMEFRAME_TO_BINANCE,
} from "./domain/Timeframe";

export type { Candle } from "./domain/Candle";
export { candleKey, candleRoom } from "./domain/Candle";

export type { ChartConfig } from "./domain/ChartConfig";

export type {
  CandleQuery,
  CandleRepository,
} from "./domain/CandleRepository.port";

export {
  MARKET_DATA_EVENTS,
  type CandleClosedEvent,
  type CandleClosedEventPayload,
  type WsConnectionStatus,
} from "./domain/events";

export type {
  ReconciliationConfig,
  ReconciliationResult,
  ReconcileTrigger,
  ReconcileSkipReason,
} from "./application/ReconciliationService";
