/**
 * Socket.IO client singleton for the Market Data module.
 *
 * Connects once, exposes typed subscribe/unsubscribe, and relays
 * `CandleClosed`, `CandleUpdating`, `NewsCollected`, and `SentimentAnalyzed` events to React consumers.
 */

import { io, type Socket } from "socket.io-client";
import type { Timeframe } from "./api";
import type { NewsCollectedEvent } from "../types/news";

export type { Timeframe };
export { type Timeframe as TimeframeType };

export interface CandleClosedPayload {
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
  payload: CandleClosedPayload;
}

export interface CandleUpdatingEvent {
  event: "CandleUpdating";
  version: string;
  timestamp: number;
  payload: CandleClosedPayload;
}

export interface SentimentAnalyzedPayload {
  newsId: string;
  sentimentId: string;
  classification: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  score: number;
  coinSymbols: string[];
}

type WsStatus =
  | { state: "connecting" }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "closed"; reason: string };

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  "http://localhost:3000";

// Debug mode: set to true to log all socket traffic
const DEBUG = true;

let socket: Socket | null = null;
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[ws:debug]", new Date().toISOString(), ...args);
  }
}

function getSocket(): Socket {
  if (!socket || !socket.connected) {
    socket = io(WS_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
    });

    socket.on("connect", () => {
      console.log(`[ws] connected ${socket!.id}`);
      emit("ws:status", { state: "connected", since: Date.now() });
    });

    socket.on("disconnect", (reason: string) => {
      console.log(`[ws] disconnected: ${reason}`);
      emit("ws:status", { state: "closed", reason });
    });

    socket.on("connect_error", (err: Error) => {
      console.error("[ws] connect_error:", err.message);
      emit("ws:status", { state: "closed", reason: err.message });
    });

    socket.on("CandleClosed", (data: CandleClosedEvent) => {
      debug("IN ← CandleClosed", {
        symbol: data.payload?.symbol,
        tf: data.payload?.timeframe,
        candle: data.payload?.candle ? {
          o: data.payload.candle.open,
          h: data.payload.candle.high,
          l: data.payload.candle.low,
          c: data.payload.candle.close,
          v: data.payload.candle.volume,
          openTime: new Date(data.payload.candle.openTime).toISOString(),
        } : null,
      });
      emit("CandleClosed", data);
    });

    socket.on("CandleUpdating", (data: CandleUpdatingEvent) => {
      debug("IN ← CandleUpdating", {
        symbol: data.payload?.symbol,
        tf: data.payload?.timeframe,
        candle: data.payload?.candle ? {
          o: data.payload.candle.open,
          h: data.payload.candle.high,
          l: data.payload.candle.low,
          c: data.payload.candle.close,
          v: data.payload.candle.volume,
          openTime: new Date(data.payload.candle.openTime).toISOString(),
        } : null,
      });
      emit("CandleUpdating", data);
    });

    socket.on("NewsCollected", (data: NewsCollectedEvent) => {
      debug("IN ← NewsCollected", {
        newsId: data?.newsId,
        symbols: data?.coinSymbols,
        title: data?.title?.slice(0, 60),
      });
      emit("NewsCollected", data);
    });

    socket.on("SentimentAnalyzed", (data: SentimentAnalyzedPayload) => {
      debug("IN ← SentimentAnalyzed", data);
      emit("SentimentAnalyzed", data);
    });

    socket.on("subscribed", (data: unknown) => {
      debug("IN ← subscribed", data);
      emit("subscribed", data);
    });

    socket.on("unsubscribed", (data: unknown) => {
      debug("IN ← unsubscribed", data);
      emit("unsubscribed", data);
    });

    socket.on("error", (data: unknown) => {
      console.error("[ws] server error:", data);
      debug("IN ← error", data);
      emit("ws:error", data);
    });

    socket.onAny((event: string, ...args: unknown[]) => {
      if (!["connect", "disconnect", "connect_error", "CandleClosed", "CandleUpdating", "NewsCollected", "SentimentAnalyzed", "subscribed", "unsubscribed", "error"].includes(event)) {
        debug(`IN ← ${event}`, args);
      }
    });
  }
  return socket;
}

function emit(event: string, ...args: unknown[]): void {
  debug(`EMIT → ${event}`, args.length === 1 ? args[0] : args);
  listeners.get(event)?.forEach((fn) => fn(...args));
}

export function connect(): void {
  getSocket();
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
}

export function subscribe(
  symbol: string,
  timeframes: Timeframe[],
): void {
  debug("OUT → subscribe", { symbol, timeframes });
  getSocket().emit("subscribe", { symbol, timeframes });
}

export function unsubscribe(
  symbol: string,
  timeframes: Timeframe[],
): void {
  debug("OUT → unsubscribe", { symbol, timeframes });
  getSocket().emit("unsubscribe", { symbol, timeframes });
}

export function on(
  event: string,
  handler: (...args: unknown[]) => void,
): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);

  return () => {
    listeners.get(event)?.delete(handler);
    if (listeners.get(event)?.size === 0) listeners.delete(event);
  };
}

export function onCandleClosed(
  handler: (event: CandleClosedEvent) => void,
): () => void {
  return on("CandleClosed", handler as (...args: unknown[]) => void);
}

export function onCandleUpdating(
  handler: (event: CandleUpdatingEvent) => void,
): () => void {
  return on("CandleUpdating", handler as (...args: unknown[]) => void);
}

export function onNewsCollected(
  handler: (event: NewsCollectedEvent) => void,
): () => void {
  return on("NewsCollected", handler as (...args: unknown[]) => void);
}

export function onSentimentAnalyzed(
  handler: (event: SentimentAnalyzedPayload) => void,
): () => void {
  return on("SentimentAnalyzed", handler as (...args: unknown[]) => void);
}

export function onWsStatus(handler: (status: WsStatus) => void): () => void {
  return on("ws:status", handler as (...args: unknown[]) => void);
}

export function isConnected(): boolean {
  return socket?.connected ?? false;
}