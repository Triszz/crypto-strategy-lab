/**
 * Core interfaces (ports) for Market Data module.
 * These define contracts that exchange providers must implement.
 */

import type { Candle, Timeframe } from "./types";
import type { WsConnectionStatus } from "./events";

/**
 * Generic market data provider interface.
 * Any exchange (Binance, OKX, Bybit) must implement this contract.
 * 
 * Provides both REST (historical data) and WebSocket (real-time streams).
 */
export interface MarketDataProvider {
  // ===== REST Operations =====
  /**
   * Fetch historical candles from exchange.
   * @returns Array of candles, oldest first
   */
  fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]>;
  
  /**
   * Fetch most recent N candles.
   */
  fetchLatest(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  
  /**
   * Fetch candles since timestamp with pagination.
   */
  fetchSince(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
    untilMs?: number,
  ): AsyncGenerator<Candle[], void, void>;
  
  /**
   * Fetch available trading symbols from exchange.
   * @returns Array of symbols with metadata
   */
  fetchSymbols(): Promise<ExchangeSymbol[]>;
  
  /**
   * Get stream key for a symbol+timeframe pair.
   */
  getStreamKey(symbol: string, timeframe: Timeframe): string;
  
  // ===== WebSocket Lifecycle =====
  /**
   * Connect to exchange WebSocket.
   * Resolves when connection is established.
   */
  connect(): Promise<void>;
  
  /**
   * Disconnect from exchange WebSocket.
   * Cleans up subscriptions and closes connection.
   */
  disconnect(): Promise<void>;
  
  // ===== Stream Management =====
  /**
   * Subscribe to real-time candle stream.
   * Ref-counted - multiple subscribers share same stream.
   */
  subscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  
  /**
   * Unsubscribe from candle stream.
   * Only unsubscribes from exchange when last subscriber leaves.
   */
  unsubscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  
  // ===== Event Emitter =====
  /**
   * Listen for closed candle events (candle completed).
   */
  on(event: "CandleClosed", listener: (c: Candle) => void): void;
  
  /**
   * Listen for updating candle events (candle in progress).
   */
  on(event: "CandleUpdating", listener: (c: Candle) => void): void;
  
  /**
   * Listen for connection status changes.
   */
  on(event: "status", listener: (s: WsConnectionStatus) => void): void;
  
  /**
   * Remove event listener.
   */
  off(event: string, listener: (...args: any[]) => void): void;
  
  // ===== State Inspection =====
  /**
   * Check if WebSocket is currently connected.
   */
  isConnected(): boolean;
  
  /**
   * Get list of active stream keys.
   */
  activeStreams(): string[];
}

export interface FetchCandlesOptions {
  symbol: string;
  timeframe: Timeframe;
  startMs?: number;
  endMs?: number;
  limit?: number;
}

export interface ExchangeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed?: boolean;
}

/**
 * Repository interface for candle persistence.
 */
export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface CandleRepository {
  upsert(candle: Candle): Promise<void>;
  upsertBatch(candles: Candle[]): Promise<number>;
  query(q: CandleQuery): Promise<Candle[]>;
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  deleteAll(): Promise<void>;
  trimToLatest(symbol: string, timeframe: Timeframe, keepCount: number): Promise<number>;
}
