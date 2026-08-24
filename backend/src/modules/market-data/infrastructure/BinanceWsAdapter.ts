import { EventEmitter } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { loadEnv } from "../../../config/env";
import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../domain/Candle";
import type { WsConnectionStatus } from "../domain/events";
import type { Timeframe } from "../domain/Timeframe";
import { getBinanceStreamName } from "../domain/Timeframe";
import {
  CandleNormalizer,
  type BinanceKlineWSMessage,
} from "./CandleNormalizer";
import { ReconnectStrategy } from "./ReconnectStrategy";
import { HeartbeatMonitor } from "../realtime/HeartbeatMonitor";

const HEARTBEAT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export interface BinanceWsConfig {
  baseUrl?: string;
  logger: Logger;
  heartbeatMs?: number;
  pingIntervalMs?: number;
  connectTimeoutMs?: number;
}

export interface IBinanceWsAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  unsubscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  on(event: "CandleClosed", listener: (c: Candle) => void): this;
  on(event: "CandleUpdating", listener: (c: Candle) => void): this;
  on(event: "status", listener: (s: WsConnectionStatus) => void): this;
  once(event: "ready", listener: () => void): this;
  isConnected(): boolean;
  activeStreams(): string[];
}

/**
 * Reference-counted Binance WebSocket client. Many internal subscribers
 * (default chart panes + front-end clients via SocketGateway) can share
 * the same underlying stream — only the first subscriber triggers a
 * SUBSCRIBE, and we only UNSUBSCRIBE when the last one leaves.
 *
 * The adapter is intentionally permissive about connecting: the first
 * `connect()` resolves as soon as the WebSocket opens and the initial
 * subscriptions are flushed. Subsequent reconnects are transparent —
 * consumers keep their event listeners attached.
 */
export class BinanceWsAdapter extends EventEmitter implements IBinanceWsAdapter {
  private ws: WebSocket | null = null;
  private readonly refCount = new Map<string, number>();
  private readonly reconnect: ReconnectStrategy;
  private readonly heartbeat: HeartbeatMonitor;
  private pingTimer: NodeJS.Timeout | null = null;
  private connectingPromise: Promise<void> | null = null;
  private stopped = false;
  private ready = false;

  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly heartbeatMs: number;
  private readonly connectTimeoutMs: number;

  constructor(cfg: BinanceWsConfig) {
    super();
    const env = loadEnv();
    this.baseUrl = (cfg.baseUrl ?? env.BINANCE_WS_BASE_URL).replace(/\/+$/, "");
    this.logger = cfg.logger;
    this.heartbeatMs = cfg.heartbeatMs ?? HEARTBEAT_TIMEOUT_MS;
    this.connectTimeoutMs = cfg.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    this.reconnect = new ReconnectStrategy();
    this.heartbeat = new HeartbeatMonitor({
      timeoutMs: this.heartbeatMs,
      onTimeout: () => {
        this.logger.warn(
          { streams: this.activeStreams() },
          "binance.ws.heartbeat.timeout",
        );
        // Force-close the socket so the 'close' handler schedules a reconnect.
        this.ws?.close();
      },
    });
  }

  isConnected(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  activeStreams(): string[] {
    return [...this.refCount.entries()]
      .filter(([, count]) => count > 0)
      .map(([stream]) => stream);
  }

  async connect(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    if (this.stopped) {
      throw new Error("BinanceWsAdapter has been stopped");
    }
    this.connectingPromise = this.openConnection();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async openConnection(): Promise<void> {
    this.logger.info({ streams: this.activeStreams() }, "binance.ws.connecting");
    this.emit("status", { state: "connecting" });
    this.ready = false;

    const url = this.buildUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    const opened = new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Event): void => {
        cleanup();
        const message = extractErrorMessage(err) ?? "ws error";
        reject(new Error(message));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("WebSocket connection timeout"));
      }, this.connectTimeoutMs);

      const cleanup = (): void => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        clearTimeout(timeout);
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      void this.handleMessage(event.data);
    });
    ws.addEventListener("close", (event: Event) => {
      const close = event as unknown as {
        code?: number;
        reason?: string;
      };
      this.handleClose(close.code ?? 1006, close.reason ?? "");
    });
    ws.addEventListener("error", (event: Event) => {
      const message = extractErrorMessage(event) ?? "unknown";
      this.logger.warn({ message }, "binance.ws.error");
    });

    await opened;

    this.reconnect.reset();
    this.heartbeat.start();
    this.startPing();
    this.ready = true;
    this.emit("status", { state: "connected", since: Date.now() });
    this.emit("ready");
    this.logger.info(
      { streams: this.activeStreams() },
      "binance.ws.connected",
    );
  }

  async disconnect(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.reconnect.stop();
    this.heartbeat.stop();
    this.stopPing();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      const closed = new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.addEventListener("close", () => resolve(), { once: true });
        ws.close(1000, "client_disconnect");
      });
      await wait(50); // brief grace period for the close frame to flush
      await Promise.race([closed, wait(1_000)]);
    }
    this.ready = false;
    this.emit("status", { state: "closed", reason: "client_disconnect" });
  }

  async subscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const stream = getBinanceStreamName(symbol, timeframe);
    const prev = this.refCount.get(stream) ?? 0;
    this.refCount.set(stream, prev + 1);
    if (prev === 0) {
      await this.ensureConnected();
      this.send({ method: "SUBSCRIBE", params: [stream], id: Date.now() });
      this.logger.debug({ stream, ref: 1 }, "binance.ws.subscribe");
    } else {
      this.logger.debug({ stream, ref: prev + 1 }, "binance.ws.subscribe.deduplicated");
    }
  }

  async unsubscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const stream = getBinanceStreamName(symbol, timeframe);
    const prev = this.refCount.get(stream) ?? 0;
    if (prev <= 1) {
      this.refCount.delete(stream);
      if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
        this.send({ method: "UNSUBSCRIBE", params: [stream], id: Date.now() });
      }
      this.logger.debug({ stream, ref: 0 }, "binance.ws.unsubscribe");
    } else {
      this.refCount.set(stream, prev - 1);
      this.logger.debug({ stream, ref: prev - 1 }, "binance.ws.unsubscribe.decremented");
    }
  }

  /** Wait until the underlying socket is open (used by `subscribe`). */
  private async ensureConnected(): Promise<void> {
    if (this.isConnected()) return;
    if (this.connectingPromise) {
      await this.connectingPromise;
      return;
    }
    await this.connect();
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let payload: unknown;
    try {
      payload =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw && typeof raw === "object"
            ? raw
            : null;
    } catch {
      return; // ignore non-JSON frames
    }

    if (!payload) return;
    if (!isWrappedMessage(payload)) {
      // Could be an ack or a result frame — we only care about klines.
      return;
    }
    const stream = payload.stream;
    if (!stream.includes("@kline")) return;

    const kmsg = payload.data as BinanceKlineWSMessage;
    if (!kmsg || kmsg.e !== "kline") return;

    this.heartbeat.beat();
    try {
      const candle = CandleNormalizer.fromWsKline(kmsg);
      if (kmsg.k.x) {
        this.emit("CandleClosed", candle);
      } else {
        this.emit("CandleUpdating", candle);
      }
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message },
        "binance.ws.parse.failed",
      );
    }
  }

  private handleClose(code: number, reason: string): void {
    this.heartbeat.stop();
    this.stopPing();
    this.ready = false;
    const reasonStr = reason?.toString?.() || `code ${code}`;
    this.logger.warn({ code, reason: reasonStr }, "binance.ws.closed");
    this.emit("status", { state: "closed", reason: reasonStr });
    if (!this.stopped) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const delay = this.reconnect.next();
    this.emit("status", {
      state: "reconnecting",
      attempt: this.reconnect.attempt,
      nextRetryMs: delay,
    });
    setTimeout(() => {
      if (this.stopped) return;
      this.connect().catch((err) => {
        this.logger.error(
          { err: (err as Error).message, attempt: this.reconnect.attempt },
          "binance.ws.reconnect.failed",
        );
        this.scheduleReconnect();
      });
    }, delay);
  }

  private send(payload: object): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  private startPing(): void {
    // Node's built-in `WebSocket` (undici) automatically frames
    // PING/PONG on the underlying TCP socket. Binance tolerates this
    // — we keep the start/stop hooks so external callers don't have to
    // know whether ping is implemented.
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private buildUrl(): string {
    const streams = this.activeStreams();
    if (streams.length === 0) {
      // Some Binance deployments reject an empty streams query; default
      // to a single BTC kline so the URL remains valid.
      return `${this.baseUrl}/stream?streams=btcusdt@kline_1m`;
    }
    return `${this.baseUrl}/stream?streams=${streams.join("/")}`;
  }
}

interface BinanceStreamWrapper {
  stream: string;
  data: unknown;
}

function isWrappedMessage(value: unknown): value is BinanceStreamWrapper {
  return (
    typeof value === "object" &&
    value !== null &&
    "stream" in value &&
    typeof (value as { stream: unknown }).stream === "string"
  );
}

function extractErrorMessage(event: Event | unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as { message?: unknown; reason?: unknown };
  if (typeof e.message === "string") return e.message;
  if (typeof e.reason === "string") return e.reason;
  return undefined;
}
