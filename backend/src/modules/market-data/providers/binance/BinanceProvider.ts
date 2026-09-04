import { EventEmitter } from "node:events";
import type { MarketDataProvider, FetchCandlesOptions, ExchangeSymbol } from "../../core/ports";
import type { Candle, Timeframe } from "../../core/types";
import type { WsConnectionStatus } from "../../core/events";
import { BinanceRestClient } from "./BinanceRestClient";
import { BinanceWsClient } from "./BinanceWsClient";
import type { Logger } from "../../../../shared/logger/logger";

/**
 * Binance implementation of MarketDataProvider.
 * 
 * Composes BinanceRestClient (historical data) and BinanceWsClient (real-time streams).
 * Acts as a unified facade that implements the provider interface.
 */
export class BinanceProvider extends EventEmitter implements MarketDataProvider {
  private rest: BinanceRestClient;
  private ws: BinanceWsClient;
  
  constructor(config: { logger: Logger }) {
    super();
    this.rest = new BinanceRestClient(config);
    this.ws = new BinanceWsClient(config);
    
    // Forward WebSocket events (keep original event names for compatibility)
    this.ws.on("CandleClosed", (candle: Candle) => {
      this.emit("CandleClosed", candle);
    });
    
    this.ws.on("CandleUpdating", (candle: Candle) => {
      this.emit("CandleUpdating", candle);
    });
    
    this.ws.on("status", (status: WsConnectionStatus) => {
      this.emit("status", status);
    });
  }
  
  // ===== REST Delegation =====
  async fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]> {
    return this.rest.fetchKlines(opts);
  }
  
  async fetchLatest(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    return this.rest.fetchLatest(symbol, timeframe, limit);
  }
  
  fetchSince(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
    untilMs?: number,
  ): AsyncGenerator<Candle[], void, void> {
    return this.rest.fetchSince(symbol, timeframe, sinceMs, untilMs);
  }
  
  async fetchSymbols(): Promise<ExchangeSymbol[]> {
    const info = await this.rest.fetchExchangeInfo();
    return info.symbols;
  }
  
  getStreamKey(symbol: string, timeframe: Timeframe): string {
    return this.rest.getStreamKey(symbol, timeframe);
  }
  
  // ===== WebSocket Delegation =====
  async connect(): Promise<void> {
    return this.ws.connect();
  }
  
  async disconnect(): Promise<void> {
    return this.ws.disconnect();
  }
  
  async subscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    return this.ws.subscribe(symbol, timeframe);
  }
  
  async unsubscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    return this.ws.unsubscribe(symbol, timeframe);
  }
  
  isConnected(): boolean {
    return this.ws.isConnected();
  }
  
  activeStreams(): string[] {
    return this.ws.activeStreams();
  }
}
