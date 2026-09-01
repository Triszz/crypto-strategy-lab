export const MARKET_DATA_EVENTS = {
  CANDLE_CLOSED: "market-data.candle.closed",
  CANDLE_UPDATING: "market-data.candle.updating",
  WS_STATUS: "market-data.ws.status",
  BACKFILL_PROGRESS: "market-data.backfill.progress",
  SYMBOLS_SYNCED: "market-data.symbols.synced",
} as const;

export type MarketDataEventName =
  (typeof MARKET_DATA_EVENTS)[keyof typeof MARKET_DATA_EVENTS];

export const CANDLE_CLOSED_EVENT_VERSION = "1.0";

export interface CandleClosedEventPayload {
  symbol: string;
  timeframe: string;
  candle: {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume: number;
    trades: number;
  };
  candleKey: string;
}

export interface CandleClosedEvent {
  event: "CandleClosed";
  version: typeof CANDLE_CLOSED_EVENT_VERSION;
  timestamp: number;
  payload: CandleClosedEventPayload;
}

export interface CandleUpdatingEvent {
  event: "CandleUpdating";
  version: typeof CANDLE_CLOSED_EVENT_VERSION;
  timestamp: number;
  payload: CandleClosedEventPayload;
}

export type WsConnectionStatus =
  | { state: "connecting" }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "closed"; reason: string };
