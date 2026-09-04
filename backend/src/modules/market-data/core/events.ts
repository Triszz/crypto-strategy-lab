/**
 * Event types for Market Data module.
 */

export const CANDLE_CLOSED_EVENT_VERSION = "1.0";

export type WsConnectionStatus =
  | { state: "connecting" }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "closed"; reason: string };

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
  version: string;
  timestamp: number;
  payload: CandleClosedEventPayload;
}

export interface CandleUpdatingEvent {
  event: "CandleUpdating";
  version: string;
  timestamp: number;
  payload: CandleClosedEventPayload;
}

export const MARKET_DATA_EVENTS = {
  CANDLE_CLOSED: "market-data.candle.closed",
  CANDLE_UPDATING: "market-data.candle.updating",
} as const;
