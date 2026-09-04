import type { Server as IOServer, Socket } from "socket.io";
import { getSocketServer } from "../../../infrastructure/websocket/socket";
import type { Candle } from "../core/types";
import {
  type Timeframe,
  isTimeframe,
  getStreamKey,
} from "../core/types";
import {
  CANDLE_CLOSED_EVENT_VERSION,
  type CandleClosedEvent,
  type CandleUpdatingEvent,
} from "../core/events";
import { candleKey, candleRoom } from "../core/types";
import type { MarketDataProvider } from "../core/ports";
import type { MarketDataService } from "../services/MarketDataService";

const MAX_TIMEFRAMES_PER_SUBSCRIBE = 4;

/**
 * Owns the Socket.IO surface that fronts the Market Data module.
 *
 *   - Receives `subscribe` / `unsubscribe` from clients and translates
 *     them into ref-counted `provider.subscribe(...)` calls.
 *   - Joins clients into Socket.IO rooms keyed by stream so updates
 *     only land on interested subscribers.
 *   - Re-broadcasts every `CandleClosed` and `CandleUpdating` from
 *     the provider as the canonical wire events.
 *
 * Per-event protocol (version "1.0", payload schema shared across
 * both event names):
 *
 *   client → server
 *     { type: "subscribe",   symbol: "BTCUSDT", timeframes: ["1m","1h"] }
 *     { type: "unsubscribe", symbol: "BTCUSDT", timeframes: ["1m"] }
 *
 *   server → client
 *     { type: "subscribed",    symbol, timeframes }
 *     { type: "unsubscribed",  symbol, timeframes }
 *     { type: "CandleClosed",  version, timestamp, payload: {...} }
 *     { type: "CandleUpdating",version, timestamp, payload: {...} }
 *     { type: "error",         code, message }
 */
export class SocketGateway {
  private readonly clientSubs = new Map<string, Set<string>>();
  private detach: (() => void) | null = null;
  private io: IOServer | null = null;

  constructor(
    private readonly provider: MarketDataProvider,  // ✅ Now uses provider interface
    private readonly marketData: MarketDataService,
  ) {}

  private resolveIo(): IOServer {
    if (this.io) return this.io;
    this.io = getSocketServer();
    return this.io;
  }

  start(): void {
    if (this.detach) return;
    const io = this.resolveIo();
    const handleClosed = (candle: Candle): void => {
      this.broadcast(candle, "CandleClosed");
    };
    const handleUpdating = (candle: Candle): void => {
      this.broadcast(candle, "CandleUpdating");
    };
    this.provider.on("CandleClosed", handleClosed);
    this.provider.on("CandleUpdating", handleUpdating);

    io.on("connection", (socket: Socket) => {
      this.clientSubs.set(socket.id, new Set());

      socket.on("subscribe", async (raw: unknown) => {
        try {
          const msg = parseSubscribeMessage(raw);
          const joined: string[] = [];
          for (const tf of msg.timeframes) {
            const streamKey = getStreamKey(msg.symbol, tf);
            this.ensureSubs(socket.id).add(streamKey);
            socket.join(candleRoom({ symbol: msg.symbol, timeframe: tf }));
            await this.marketData.ensureSubscribed(msg.symbol, tf);
            joined.push(tf);
          }
          socket.emit("subscribed", {
            type: "subscribed",
            symbol: msg.symbol,
            timeframes: joined,
          });
        } catch (err) {
          socket.emit("error", {
            type: "error",
            code: "SUBSCRIBE_FAILED",
            message: (err as Error).message,
          });
        }
      });

      socket.on("unsubscribe", async (raw: unknown) => {
        try {
          const msg = parseSubscribeMessage(raw);
          for (const tf of msg.timeframes) {
            const streamKey = getStreamKey(msg.symbol, tf);
            this.ensureSubs(socket.id).delete(streamKey);
            socket.leave(candleRoom({ symbol: msg.symbol, timeframe: tf }));
            await this.marketData.releaseSubscription(msg.symbol, tf);
          }
          socket.emit("unsubscribed", {
            type: "unsubscribed",
            symbol: msg.symbol,
            timeframes: msg.timeframes,
          });
        } catch (err) {
          socket.emit("error", {
            type: "error",
            code: "UNSUBSCRIBE_FAILED",
            message: (err as Error).message,
          });
        }
      });

      socket.on("disconnect", () => {
        // We intentionally do NOT call provider.unsubscribe here —
        // the upstream is ref-counted and other clients may still be
        // subscribed to the same stream.
        this.clientSubs.delete(socket.id);
      });
    });

    this.detach = (): void => {
      this.provider.off("CandleClosed", handleClosed);
      this.provider.off("CandleUpdating", handleUpdating);
      this.clientSubs.clear();
    };
  }

  stop(): void {
    if (this.detach) {
      this.detach();
      this.detach = null;
    }
  }

  private broadcast(
    candle: Candle,
    eventName: "CandleClosed" | "CandleUpdating",
  ): void {
    const room = candleRoom(candle);
    const payload = {
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      candle: {
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        quoteVolume: candle.quoteVolume,
        trades: candle.trades,
      },
      candleKey: candleKey(candle),
    };
    if (eventName === "CandleClosed") {
      const event: CandleClosedEvent = {
        event: "CandleClosed",
        version: CANDLE_CLOSED_EVENT_VERSION,
        timestamp: Date.now(),
        payload,
      };
      this.resolveIo().to(room).emit("CandleClosed", event);
    } else {
      const event: CandleUpdatingEvent = {
        event: "CandleUpdating",
        version: CANDLE_CLOSED_EVENT_VERSION,
        timestamp: Date.now(),
        payload,
      };
      this.resolveIo().to(room).emit("CandleUpdating", event);
    }
  }

  private ensureSubs(socketId: string): Set<string> {
    let set = this.clientSubs.get(socketId);
    if (!set) {
      set = new Set();
      this.clientSubs.set(socketId, set);
    }
    return set;
  }
}

interface ParsedSubscribeMessage {
  symbol: string;
  timeframes: Timeframe[];
}

function parseSubscribeMessage(raw: unknown): ParsedSubscribeMessage {
  if (!raw || typeof raw !== "object") {
    throw new Error("payload must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.symbol !== "string" || r.symbol.length === 0) {
    throw new Error("symbol is required");
  }
  if (!Array.isArray(r.timeframes) || r.timeframes.length === 0) {
    throw new Error("timeframes array is required");
  }
  if (r.timeframes.length > MAX_TIMEFRAMES_PER_SUBSCRIBE) {
    throw new Error(
      `at most ${MAX_TIMEFRAMES_PER_SUBSCRIBE} timeframes per request`,
    );
  }
  const timeframes: Timeframe[] = [];
  for (const tf of r.timeframes) {
    if (typeof tf !== "string" || !isTimeframe(tf)) {
      throw new Error(`unsupported timeframe: ${String(tf)}`);
    }
    timeframes.push(tf);
  }
  return { symbol: r.symbol.toUpperCase(), timeframes };
}
