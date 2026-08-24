# Market Data Service — Thiết kế chi tiết

**Module owner:** Bảo
**Ngày tạo:** 2026-08-07
**Trạng thái:** Draft (Tuần 1 — Design)
**Phụ thuộc:** `Candle` schema, `Event Catalog` (Tuần 1 đã chốt)

---

## 1. Phạm vi & trách nhiệm

`Market Data Service` chịu trách nhiệm **duy nhất** cho việc:

1. Kết nối tới **Binance** (REST + WebSocket).
2. **Chuẩn hóa** dữ liệu Binance về `Candle` schema nội bộ.
3. **Lưu** historical candle xuống PostgreSQL.
4. **Phát event** `CandleClosed` qua EventBus nội bộ + đẩy ra client qua SocketGateway.
5. **Tự phục hồi** khi mất kết nối (reconnect + exponential backoff).

> Module **KHÔNG** biết gì về Strategy, Backtester, Frontend. Chỉ biết: "có candle mới → phát đi".

---

## 2. Vị trí trong kiến trúc (C4 Level 3)

```
┌────────────────────────────────────────────────────────────────┐
│                     MARKET DATA SERVICE                        │
│                                                                │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ BinanceAdapter   │    │ BinanceAdapter   │                  │
│  │ (REST — history) │    │ (WS — realtime)  │                  │
│  └────────┬─────────┘    └────────┬─────────┘                  │
│           │                       │                            │
│           ▼                       ▼                            │
│  ┌─────────────────────────────────────────┐                   │
│  │     CandleNormalizer (shared util)      │                   │
│  │  Binance DTO → internal Candle type     │                   │
│  └────────────────────┬────────────────────┘                   │
│                       │                                        │
│           ┌───────────┴───────────┐                            │
│           ▼                       ▼                            │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │ CandleRepository │    │   EventBus       │                  │
│  │ (PostgreSQL)     │    │  (in-process)    │                  │
│  └──────────────────┘    └────────┬─────────┘                  │
│                                  │ publish CandleClosed        │
│                                  ▼                             │
│                         ┌──────────────────┐                   │
│                         │  SocketGateway   │                   │
│                         │  (Socket.IO)     │                   │
│                         └────────┬─────────┘                   │
└──────────────────────────────────┼─────────────────────────────┘
                                   │ wss://.../socket.io
                                   ▼
                            ┌─────────────┐
                            │  Frontend   │
                            │  (4 charts) │
                            └─────────────┘


                         Binance
                            │
                     WebSocket Kline
                            │
                            ▼
                 ┌────────────────────┐
                 │ BinanceWsAdapter   │
                 │                    │
                 │ Raw Binance Event  │
                 │        ↓           │
                 │ Normalize Candle   │
                 └─────────┬──────────┘
                           │
                           │ publish
                           ▼
                  ┌──────────────────┐
                  │    Event Bus     │
                  │ Node EventEmitter│
                  └───────┬──────────┘
                          │
              ┌───────────┼────────────┐
              │           │            │
              ▼           ▼            ▼
       CandleConsumer  SocketGateway  Logger
              │           │
              ▼           ▼
         PostgreSQL    Socket.IO
                            │
                            │ WebSocket
                            ▼
                         React
```

---

## 3. Thư mục & file layout

```
apps/market-data-service/
├── src/
│   ├── domain/
│   │   ├── Candle.ts                  ← internal type (shared)
│   │   ├── Timeframe.ts
│   │   └── CandleRepository.port.ts   ← interface (Port)
│   ├── adapters/
│   │   ├── BinanceRestAdapter.ts      ← historical data
│   │   ├── BinanceWsAdapter.ts        ← realtime data
│   │   ├── CandleNormalizer.ts        ← Binance DTO → Candle
│   │   └── PostgresCandleRepository.ts← implements CandleRepository
│   ├── realtime/
│   │   ├── ReconnectStrategy.ts       ← exponential backoff
│   │   ├── HeartbeatMonitor.ts        ← phát hiện socket chết
│   │   └── SocketGateway.ts           ← WS push ra client
│   ├── config/
│   │   └── env.ts
│   ├── container.ts                   ← DI wiring
│   ├── server.ts                      ← entrypoint
│   └── __tests__/
│       ├── BinanceRestAdapter.test.ts
│       ├── BinanceWsAdapter.test.ts
│       ├── CandleNormalizer.test.ts
│       └── ReconnectStrategy.test.ts
├── package.json
└── tsconfig.json
```

---

## 4. Domain types (đã chốt Tuần 1)

```typescript
// src/domain/Timeframe.ts
export type Timeframe =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "8h" | "12h"
  | "1d" | "3d" | "1w" | "1M";

export const SUPPORTED_TIMEFRAMES: Timeframe[] = [
  "1m", "5m", "15m", "1h", "4h", "1d"  // MVP: chỉ enable 6 timeframe này
];

// Map timeframe nội bộ → Binance interval string
export const TIMEFRAME_TO_BINANCE: Record<Timeframe, string> = {
  "1m": "1m",  "3m": "3m",  "5m": "5m",
  "15m": "15m","30m": "30m","1h": "1h",
  "2h": "2h",  "4h": "4h",  "6h": "6h",
  "8h": "8h",  "12h": "12h","1d": "1d",
  "3d": "3d",  "1w": "1w",  "1M": "1M"
};
```

```typescript
// src/domain/Candle.ts — schema đã chốt Tuần 1, không ai được đổi
export interface Candle {
  symbol: string;        // "BTCUSDT"
  timeframe: Timeframe;
  openTime: number;      // epoch ms — Binance dùng ms
  closeTime: number;     // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;   // volume * price (cho valuation)
  trades: number;        // số lệnh trade trong candle
}

// Unique key theo DB schema
export function candleKey(c: Candle): string {
  return `${c.symbol}@${c.timeframe}@${c.openTime}`;
}
```

```typescript
// src/domain/CandleRepository.port.ts — Port (interface only)
import { Candle } from "./Candle";
import { Timeframe } from "./Timeframe";

export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  fromMs: number;        // inclusive
  toMs: number;          // exclusive
  limit?: number;        // mặc định 500, max 1000
}

export interface CandleRepository {
  upsert(candle: Candle): Promise<void>;
  upsertBatch(candles: Candle[]): Promise<number>;  // return row count
  query(q: CandleQuery): Promise<Candle[]>;
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
}
```

---

## 5. Candle Normalizer (shared utility)

**Mục đích:** Adapter gì cũng phải đi qua normalizer để về cùng `Candle` schema. Đây là điểm duy nhất "biết Binance shape".

```typescript
// src/adapters/CandleNormalizer.ts
import { Candle, candleKey } from "../domain/Candle";
import { Timeframe, TIMEFRAME_TO_BINANCE } from "../domain/Timeframe";

// Binance REST: GET /api/v3/klines trả array of arrays
//   [openTime, open, high, low, close, volume, closeTime,
//    quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
export interface BinanceKlineDTO extends Array<unknown> {
  0: number;   // openTime ms
  1: string;   // open
  2: string;   // high
  3: string;   // low
  4: string;   // close
  5: string;   // volume
  6: number;   // closeTime ms
  7: string;   // quoteVolume
  8: number;   // trades
}

// Binance WS: kline event
export interface BinanceKlineWSMessage {
  e: "kline";
  E: number;
  s: string;
  k: {
    t: number;  // openTime
    T: number;  // closeTime
    s: string;  // symbol
    i: string;  // interval (e.g. "1m")
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    q: string;  // quoteVolume
    n: number;  // trades
    x: boolean; // candle closed?
  };
}

export class CandleNormalizer {
  static fromRestKline(symbol: string, dto: BinanceKlineDTO): Candle {
    const timeframe = this.reverseTimeframe(dto, /* T - t */);
    return {
      symbol,
      timeframe,
      openTime: dto[0],
      closeTime: dto[6],
      open:      Number(dto[1]),
      high:      Number(dto[2]),
      low:       Number(dto[3]),
      close:     Number(dto[4]),
      volume:    Number(dto[5]),
      quoteVolume: Number(dto[7]),
      trades:    dto[8],
    };
  }

  static fromWsKline(msg: BinanceKlineWSMessage): Candle {
    const timeframe = Object.entries(TIMEFRAME_TO_BINANCE)
      .find(([, v]) => v === msg.k.i)?.[0] as Timeframe;
    if (!timeframe) throw new Error(`Unknown timeframe: ${msg.k.i}`);

    return {
      symbol: msg.s,
      timeframe,
      openTime: msg.k.t,
      closeTime: msg.k.T,
      open:   Number(msg.k.o),
      high:   Number(msg.k.h),
      low:    Number(msg.k.l),
      close:  Number(msg.k.c),
      volume: Number(msg.k.v),
      quoteVolume: Number(msg.k.q),
      trades: msg.k.n,
    };
  }

  /** Binance không trả interval trong REST. Tính từ (closeTime - openTime). */
  private static reverseTimeframe(dto: BinanceKlineDTO): Timeframe {
    const ms = dto[6] - dto[0];
    const match = Object.entries(TIMEFRAME_TO_BINANCE)
      .find(([tf]) => timeframeToMs(tf as Timeframe) === ms);
    if (!match) throw new Error(`Unknown candle duration: ${ms}ms`);
    return match[0] as Timeframe;
  }
}

function timeframeToMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "6h": 21_600_000, "8h": 28_800_000,
    "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
    "1w": 604_800_000, "1M": 2_592_000_000
  };
  return map[tf];
}
```

---

## 6. REST Adapter — Historical Data

### 6.1 API Binance sử dụng

```
GET https://api.binance.com/api/v3/klines
  ?symbol=BTCUSDT
  &interval=1h
  &startTime=1700000000000     ← optional
  &endTime=1700100000000       ← optional
  &limit=500                   ← max 1000
```

### 6.2 Interface

```typescript
// src/adapters/BinanceRestAdapter.ts
export interface BinanceRestConfig {
  baseUrl: string;          // https://api.binance.com
  recvWindow?: number;       // default 5000ms
  timeoutMs?: number;        // default 10_000
  maxRetries?: number;       // default 3
}

export interface FetchOptions {
  symbol: string;
  timeframe: Timeframe;
  startMs?: number;          // exclusive với "now" → fetch newest
  endMs?: number;
  limit?: number;            // default 500
}

export interface IBinanceRestAdapter {
  fetchKlines(opts: FetchOptions): Promise<Candle[]>;
  fetchAllSince(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
    untilMs?: number,
  ): AsyncGenerator<Candle[], void, void>;
}
```

### 6.3 Implementation sketch

```typescript
// src/adapters/BinanceRestAdapter.ts
import { Candle, candleKey } from "../domain/Candle";
import { CandleRepository } from "../domain/CandleRepository.port";
import { Timeframe, TIMEFRAME_TO_BINANCE } from "../domain/Timeframe";
import { BinanceKlineDTO, CandleNormalizer } from "./CandleNormalizer";

export class BinanceRestAdapter implements IBinanceRestAdapter {
  constructor(
    private readonly cfg: BinanceRestConfig,
    private readonly repo: CandleRepository,
    private readonly logger: Logger,
  ) {}

  async fetchKlines(opts: FetchOptions): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol: opts.symbol,
      interval: TIMEFRAME_TO_BINANCE[opts.timeframe],
      limit: String(opts.limit ?? 500),
    });
    if (opts.startMs) params.set("startTime", String(opts.startMs));
    if (opts.endMs)   params.set("endTime",   String(opts.endMs));

    const url = `${this.cfg.baseUrl}/api/v3/klines?${params}`;
    const raw = await this.httpGet<BinanceKlineDTO[]>(url);
    return raw.map(dto => CandleNormalizer.fromRestKline(opts.symbol, dto));
  }

  /**
   * Generator: auto-paginate qua Binance để lấy đủ candle từ `sinceMs`.
   * Mỗi lần loop lấy tối đa 1000 candle, dùng openTime của candle cuối
   * +1ms làm startTime lần sau.
   */
  async *fetchAllSince(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
    untilMs: number = Date.now(),
  ): AsyncGenerator<Candle[], void, void> {
    let cursor = sinceMs;
    while (cursor < untilMs) {
      const batch = await this.fetchKlines({
        symbol, timeframe,
        startMs: cursor,
        endMs:   untilMs,
        limit:   1000,
      });

      if (batch.length === 0) break;

      yield batch;

      const last = batch[batch.length - 1];
      cursor = last.openTime + 1;

      // Rate-limit: Binance cap 1200 req/min
      await sleep(80);
    }
  }

  /**
   * High-level: fetch + upsert vào DB, return số candle mới insert/update.
   * Dùng cho backfill job.
   */
  async backfill(
    symbol: string,
    timeframe: Timeframe,
    sinceMs: number,
  ): Promise<number> {
    let total = 0;
    for await (const batch of this.fetchAllSince(symbol, timeframe, sinceMs)) {
      total += await this.repo.upsertBatch(batch);
      this.logger.info("backfill.batch", {
        symbol, timeframe, count: batch.length,
        firstOpenTime: batch[0].openTime,
        lastOpenTime:  batch[batch.length - 1].openTime,
      });
    }
    return total;
  }

  private async httpGet<T>(url: string, attempt = 0): Promise<T> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 10_000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return await res.json() as T;
    } catch (err) {
      if (attempt < (this.cfg.maxRetries ?? 3)) {
        await sleep(Math.min(2 ** attempt * 500, 4000));
        return this.httpGet(url, attempt + 1);
      }
      throw err;
    }
  }
}
```

### 6.4 Sequence — backfill 1 năm candle 1h

```
Client              REST Adapter        Binance            Postgres
  │                      │                 │                    │
  │  backfill(BTC,1h,t0) │                 │                    │
  ├─────────────────────▶│                 │                    │
  │                      │ GET /klines     │                    │
  │                      ├────────────────▶│                    │
  │                      │◀────── 1000 ────│                    │
  │                      │                 │                    │
  │                      │ upsertBatch(1000)                    │
  │                      ├────────────────────────────────────▶│
  │                      │◀────────────── ok (1000) ───────────│
  │                      │                 │                    │
  │                      │ GET /klines?start=cursor+1          │
  │                      ├────────────────▶│                    │
  │                      │◀────── 1000 ────│                    │
  │                      │  ...loop...      │                    │
  │                      │                 │                    │
  │◀──── total = 8760 ───│                 │                    │
```

---

## 7. WebSocket Adapter — Realtime Data

### 7.1 Endpoint Binance

```
wss://stream.binance.com:9443/stream?streams=
  btcusdt@kline_1m/
  btcusdt@kline_5m/
  btcusdt@kline_15m/
  btcusdt@kline_1h/
  btcusdt@kline_4h/
  btcusdt@kline_1d
```

Subscribes **1 stream per (symbol, timeframe)** cần theo dõi. Khi user mở chart → frontend gọi REST subscribe → service gửi lệnh SUBSCRIBE qua WS.

### 7.2 Event payload (`CandleClosed`) — đã chốt Tuần 1

```typescript
// Event Catalog — Event ID: MD.001
{
  "event": "CandleClosed",
  "version": "1.0",
  "timestamp": 1700000060000,          // thời điểm phát event (server clock)
  "payload": {
    "symbol": "BTCUSDT",
    "timeframe": "1h",
    "candle": {
      "openTime":  1700000400000,
      "closeTime": 1700003999999,
      "open":  42150.50,
      "high":  42200.00,
      "low":   42100.10,
      "close": 42180.75,
      "volume":      124.523,
      "quoteVolume": 5250100.42,
      "trades":      8421
    },
    "candleKey": "BTCUSDT@1h@1700000400000"
  }
}
```

> **Quy ước:** Event `CandleClosed` chỉ phát khi `k.x === true` (nến vừa đóng). Các update `k.x === false` (nến đang chạy) → publish event nội bộ `CandleUpdating` riêng (optional, dùng cho live tick) — KHÔNG đẩy ra frontend qua WS để giảm traffic.

### 7.3 Interface

```typescript
// src/adapters/BinanceWsAdapter.ts
import { EventEmitter } from "node:events";

export interface BinanceWsConfig {
  baseUrl: string;                // wss://stream.binance.com:9443
  streams: string[];              // ["btcusdt@kline_1m", ...]
  heartbeatMs?: number;           // default 30_000
  pingIntervalMs?: number;        // default 3 * 60_000 (Binance yêu cầu ping mỗi 3 phút)
}

export interface IBinanceWsAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  unsubscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  on(event: "CandleClosed", listener: (c: Candle) => void): this;
  on(event: "CandleUpdating", listener: (c: Candle) => void): this;
  on(event: "status", listener: (s: ConnectionStatus) => void): this;
}

export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "closed"; reason: string };
```

### 7.4 Implementation sketch

```typescript
// src/adapters/BinanceWsAdapter.ts
import WebSocket from "ws";
import { Candle } from "../domain/Candle";
import { Timeframe, TIMEFRAME_TO_BINANCE } from "../domain/Timeframe";
import { CandleNormalizer, BinanceKlineWSMessage } from "./CandleNormalizer";
import { ReconnectStrategy } from "../realtime/ReconnectStrategy";
import { HeartbeatMonitor } from "../realtime/HeartbeatMonitor";

export class BinanceWsAdapter extends EventEmitter implements IBinanceWsAdapter {
  private ws: WebSocket | null = null;
  private subscribed = new Set<string>();
  private reconnect: ReconnectStrategy;
  private heartbeat: HeartbeatMonitor;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: BinanceWsConfig,
    private readonly logger: Logger,
  ) {
    super();
    this.reconnect = new ReconnectStrategy({
      initialMs: 1_000,
      maxMs: 30_000,
      multiplier: 2,
      jitterRatio: 0.2,
    });
    this.heartbeat = new HeartbeatMonitor({
      timeoutMs: cfg.heartbeatMs ?? 30_000,
      onTimeout: () => {
        this.logger.warn("ws.heartbeat.timeout", { streams: this.subscribed });
        this.ws?.terminate();   // force reconnect
      },
    });
  }

  async connect(): Promise<void> {
    const url = this.buildUrl();
    this.emit("status", { state: "connecting" });
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.reconnect.reset();
      this.heartbeat.start();
      this.startPing();
      // resubscribe tất cả stream đã có trước đó (sau reconnect)
      if (this.subscribed.size > 0) {
        this.sendSubscribe([...this.subscribed]);
      } else {
        // initial: subscribe tất cả stream từ config
        this.subscribed = new Set(this.cfg.streams);
        this.sendSubscribe([...this.subscribed]);
      }
      this.emit("status", { state: "connected", since: Date.now() });
    });

    this.ws.on("message", (data) => this.handleMessage(data));

    this.ws.on("pong", () => this.heartbeat.beat());

    this.ws.on("close", (code, reason) => {
      this.heartbeat.stop();
      this.stopPing();
      const reasonStr = reason.toString() || `code ${code}`;
      this.logger.warn("ws.closed", { code, reason: reasonStr });
      this.scheduleReconnect(reasonStr);
    });

    this.ws.on("error", (err) => {
      this.logger.error("ws.error", { message: err.message });
      // ws sẽ tự emit 'close' ngay sau 'error'
    });
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;  // ignore non-JSON
    }

    if (msg.e === "kline") {
      this.heartbeat.beat();
      const kmsg = msg as BinanceKlineWSMessage;
      const candle = CandleNormalizer.fromWsKline(kmsg);
      if (kmsg.k.x) {
        this.emit("CandleClosed", candle);
      } else {
        this.emit("CandleUpdating", candle);
      }
    }
    // ignore other event types
  }

  async subscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const stream = `${symbol.toLowerCase()}@kline_${TIMEFRAME_TO_BINANCE[timeframe]}`;
    if (this.subscribed.has(stream)) return;
    this.subscribed.add(stream);
    this.sendSubscribe([stream]);
  }

  async unsubscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const stream = `${symbol.toLowerCase()}@kline_${TIMEFRAME_TO_BINANCE[timeframe]}`;
    if (!this.subscribed.has(stream)) return;
    this.subscribed.delete(stream);
    this.sendUnsubscribe([stream]);
  }

  private sendSubscribe(streams: string[]) {
    this.send({ method: "SUBSCRIBE", params: streams, id: Date.now() });
  }
  private sendUnsubscribe(streams: string[]) {
    this.send({ method: "UNSUBSCRIBE", params: streams, id: Date.now() });
  }
  private send(payload: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(reason: string) {
    const delay = this.reconnect.next();
    this.emit("status", { state: "reconnecting", attempt: this.reconnect.attempt, nextRetryMs: delay });
    setTimeout(() => {
      this.logger.info("ws.reconnect", { attempt: this.reconnect.attempt, delay });
      this.connect().catch(err => {
        this.logger.error("ws.reconnect.failed", { err: err.message });
        this.scheduleReconnect(reason);
      });
    }, delay);
  }

  private startPing() {
    this.pingTimer = setInterval(() => this.ws?.ping(), this.cfg.pingIntervalMs ?? 180_000);
  }
  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private buildUrl(): string {
    if (this.subscribed.size === 0 && this.cfg.streams.length > 0) {
      const streams = this.cfg.streams.join("/");
      return `${this.cfg.baseUrl}/stream?streams=${streams}`;
    }
    const streams = [...this.subscribed].join("/");
    return `${this.cfg.baseUrl}/stream?streams=${streams}`;
  }

  async disconnect(): Promise<void> {
    this.reconnect.stop();
    this.heartbeat.stop();
    this.stopPing();
    this.ws?.close(1000, "client_disconnect");
  }
}
```

---

## 8. Reconnect Strategy & Heartbeat

### 8.1 Exponential Backoff với jitter

```typescript
// src/realtime/ReconnectStrategy.ts
export interface ReconnectConfig {
  initialMs: number;       // 1000
  maxMs: number;           // 30000
  multiplier: number;      // 2
  jitterRatio: number;     // 0.2  → ±20% ngẫu nhiên
}

export class ReconnectStrategy {
  attempt = 0;
  private stopped = false;

  constructor(private readonly cfg: ReconnectConfig) {}

  /** Trả về số ms chờ trước lần retry kế tiếp. */
  next(): number {
    if (this.stopped) throw new Error("reconnect stopped");
    const base = Math.min(
      this.cfg.initialMs * this.cfg.multiplier ** this.attempt,
      this.cfg.maxMs
    );
    const jitter = base * this.cfg.jitterRatio * (Math.random() * 2 - 1);
    this.attempt++;
    return Math.max(0, Math.floor(base + jitter));
  }

  reset() { this.attempt = 0; }
  stop()  { this.stopped = true; }
}
```

**Bảng giá trị delay (không jitter):**

| Attempt | Delay (ms) |
|---------|-----------:|
| 1       | 1 000      |
| 2       | 2 000      |
| 3       | 4 000      |
| 4       | 8 000      |
| 5       | 16 000     |
| 6       | 30 000 (cap) |
| 7+      | 30 000 (cap) |

### 8.2 Heartbeat Monitor

```typescript
// src/realtime/HeartbeatMonitor.ts
export interface HeartbeatConfig {
  timeoutMs: number;       // 30_000 — nếu không có message trong khoảng này → coi như chết
  onTimeout: () => void;
}

export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastBeat = Date.now();

  constructor(private readonly cfg: HeartbeatConfig) {}

  start() {
    this.lastBeat = Date.now();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastBeat > this.cfg.timeoutMs) {
        this.cfg.onTimeout();
      }
    }, Math.floor(this.cfg.timeoutMs / 3));   // check 3 lần trong 1 window
  }

  beat() { this.lastBeat = Date.now(); }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

> **Lưu ý:** Binance chính thức khuyến nghị client gửi `ping` mỗi 3 phút. Kết hợp `ping` (client-side) + heartbeat (server message) để cover cả 2 chiều.

---

## 9. SocketGateway — đẩy ra Frontend

### 9.1 Wire protocol — đã chốt Tuần 1

```typescript
// Client → Server
{
  "type": "subscribe",
  "symbol": "BTCUSDT",
  "timeframes": ["1m", "1h", "4h", "1d"]
}

{
  "type": "unsubscribe",
  "symbol": "BTCUSDT",
  "timeframes": ["1m"]
}

// Server → Client
{
  "type": "CandleClosed",
  "version": "1.0",
  "timestamp": 1700000060000,
  "payload": { /* CandleClosed payload xem mục 7.2 */ }
}

{
  "type": "error",
  "code": "INVALID_TIMEFRAME",
  "message": "Timeframe '2w' is not supported"
}

{
  "type": "subscribed",
  "symbol": "BTCUSDT",
  "timeframes": ["1m", "1h"]
}
```

### 9.2 Implementation

```typescript
// src/realtime/SocketGateway.ts
import { Server as IOServer, Socket } from "socket.io";
import { IBinanceWsAdapter } from "../adapters/BinanceWsAdapter";
import { Candle } from "../domain/Candle";
import { SUPPORTED_TIMEFRAMES, Timeframe } from "../domain/Timeframe";

export class SocketGateway {
  private readonly io: IOServer;
  /** Track client subscription để cleanup khi client disconnect. */
  private clientSubs = new Map<string, Set<string>>();  // socketId → set<streamKey>

  constructor(
    private readonly port: number,
    private readonly wsAdapter: IBinanceWsAdapter,
    private readonly logger: Logger,
  ) {
    this.io = new IOServer(port, {
      cors: { origin: process.env.CORS_ORIGINS?.split(",") ?? "*" },
      pingInterval: 25_000,
      pingTimeout:  20_000,
    });
  }

  start(): void {
    // Wire nội bộ: adapter → gateway
    this.wsAdapter.on("CandleClosed", (candle) => this.broadcast(candle));

    this.io.on("connection", (socket) => {
      this.logger.info("client.connected", { id: socket.id });
      this.clientSubs.set(socket.id, new Set());

      socket.on("subscribe", async (msg) => {
        try {
          this.validateSubscribeMsg(msg);
          for (const tf of msg.timeframes) {
            const streamKey = `${msg.symbol.toLowerCase()}@${tf}`;
            this.clientSubs.get(socket.id)!.add(streamKey);
            await this.wsAdapter.subscribe(msg.symbol, tf as Timeframe);
          }
          socket.emit("subscribed", {
            symbol: msg.symbol,
            timeframes: msg.timeframes,
          });
        } catch (err: any) {
          socket.emit("error", { code: "SUBSCRIBE_FAILED", message: err.message });
        }
      });

      socket.on("unsubscribe", async (msg) => {
        try {
          for (const tf of msg.timeframes) {
            await this.wsAdapter.unsubscribe(msg.symbol, tf as Timeframe);
            this.clientSubs.get(socket.id)?.delete(
              `${msg.symbol.toLowerCase()}@${tf}`
            );
          }
        } catch (err: any) {
          socket.emit("error", { code: "UNSUBSCRIBE_FAILED", message: err.message });
        }
      });

      socket.on("disconnect", async () => {
        const subs = this.clientSubs.get(socket.id);
        if (subs && subs.size > 0) {
          // Lưu ý: KHÔNG unsubscribe ở BinanceAdapter ngay,
          // vì có thể client khác vẫn cần. Logic ref-count xem mục 9.3.
        }
        this.clientSubs.delete(socket.id);
      });
    });
  }

  private broadcast(candle: Candle) {
    const streamKey = `${candle.symbol.toLowerCase()}@${candle.timeframe}`;
    const room = `candles:${streamKey}`;
    // Gửi tới tất cả client đang ở trong room này
    this.io.to(room).emit("CandleClosed", {
      type: "CandleClosed",
      version: "1.0",
      timestamp: Date.now(),
      payload: {
        symbol:    candle.symbol,
        timeframe: candle.timeframe,
        candle: {
          openTime:    candle.openTime,
          closeTime:   candle.closeTime,
          open:        candle.open,
          high:        candle.high,
          low:         candle.low,
          close:       candle.close,
          volume:      candle.volume,
          quoteVolume: candle.quoteVolume,
          trades:      candle.trades,
        },
        candleKey: `${candle.symbol}@${candle.timeframe}@${candle.openTime}`,
      },
    });
  }

  private validateSubscribeMsg(msg: any) {
    if (!msg?.symbol || typeof msg.symbol !== "string")
      throw new Error("symbol required");
    if (!Array.isArray(msg.timeframes) || msg.timeframes.length === 0)
      throw new Error("timeframes required");
    if (msg.timeframes.length > 4)
      throw new Error("max 4 timeframes per subscribe");
    for (const tf of msg.timeframes) {
      if (!SUPPORTED_TIMEFRAMES.includes(tf))
        throw new Error(`Timeframe '${tf}' is not supported`);
    }
  }
}
```

### 9.3 Ref-count cho subscription (quan trọng)

Nếu 2 client cùng subscribe `BTCUSDT@1h`, ta chỉ gửi 1 lệnh SUBSCRIBE tới Binance. Khi client đầu tiên disconnect, KHÔNG unsubscribe Binance vì client thứ 2 vẫn cần.

```
Client A subscribe BTCUSDT@1h → refCount = 1, gửi SUBSCRIBE
Client B subscribe BTCUSDT@1h → refCount = 2, KHÔNG gửi SUBSCRIBE
Client A disconnect           → refCount = 1, KHÔNG gửi UNSUBSCRIBE
Client B disconnect           → refCount = 0, gửi UNSUBSCRIBE
```

Pseudocode trong `BinanceWsAdapter`:

```typescript
private refCount = new Map<string, number>();

async subscribe(symbol: string, tf: Timeframe) {
  const stream = streamKey(symbol, tf);
  const prev = this.refCount.get(stream) ?? 0;
  this.refCount.set(stream, prev + 1);
  if (prev === 0) {
    this.subscribed.add(stream);
    this.sendSubscribe([stream]);
  }
}

async unsubscribe(symbol: string, tf: Timeframe) {
  const stream = streamKey(symbol, tf);
  const prev = this.refCount.get(stream) ?? 0;
  if (prev <= 1) {
    this.refCount.delete(stream);
    this.subscribed.delete(stream);
    this.sendUnsubscribe([stream]);
  } else {
    this.refCount.set(stream, prev - 1);
  }
}
```

---

## 10. Wiring (DI container)

```typescript
// src/container.ts
import { BinanceRestAdapter } from "./adapters/BinanceRestAdapter";
import { BinanceWsAdapter }   from "./adapters/BinanceWsAdapter";
import { SocketGateway }      from "./realtime/SocketGateway";
import { PostgresCandleRepository } from "./adapters/PostgresCandleRepository";
import { pool } from "./db";

export function buildContainer(env: Env) {
  const repo = new PostgresCandleRepository(pool, env.LOGGER);

  const rest = new BinanceRestAdapter(
    { baseUrl: env.BINANCE_REST_URL, timeoutMs: 10_000, maxRetries: 3 },
    repo,
    env.LOGGER,
  );

  const ws = new BinanceWsAdapter(
    {
      baseUrl: env.BINANCE_WS_URL,
      streams: env.INITIAL_STREAMS.split(","),
      heartbeatMs: 30_000,
      pingIntervalMs: 180_000,
    },
    env.LOGGER,
  );

  const gateway = new SocketGateway(env.WS_PORT, ws, env.LOGGER);

  return { repo, rest, ws, gateway };
}
```

```typescript
// src/server.ts
import { buildContainer } from "./container";

async function main() {
  const { rest, ws, gateway } = buildContainer(process.env);

  // 1. Backfill dữ liệu lịch sử (chạy 1 lần khi boot)
  await rest.backfill("BTCUSDT", "1h", Date.now() - 365 * 86_400_000);

  // 2. Bắt đầu nhận realtime
  await ws.connect();

  // 3. Mở cổng cho client
  gateway.start();

  // 4. Persist realtime candle xuống DB
  ws.on("CandleClosed", (candle) => repo.upsert(candle));

  process.on("SIGTERM", async () => {
    await ws.disconnect();
    process.exit(0);
  });
}

main().catch(err => {
  console.error("fatal", err);
  process.exit(1);
});
```

---

## 11. Testing plan

| Test                                | Type   | Mục đích                                                  |
|-------------------------------------|--------|-----------------------------------------------------------|
| `CandleNormalizer.fromRestKline`    | unit   | Convert Binance DTO đúng, đủ field, đúng type             |
| `CandleNormalizer.fromWsKline`      | unit   | Convert WS message đúng                                  |
| `BinanceRestAdapter.fetchKlines`    | unit   | Build URL đúng, parse response đúng (mock `fetch`)         |
| `BinanceRestAdapter.fetchAllSince`  | unit   | Pagination loop dừng đúng khi cursor ≥ untilMs            |
| `BinanceRestAdapter.backfill`       | integ  | Insert đúng vào Postgres (dùng testcontainers)           |
| `ReconnectStrategy.next`            | unit   | Đúng giá trị exponential + jitter + cap                   |
| `ReconnectStrategy` với mock WS     | unit   | Sau N lần fail thì backoff cap, sau `reset()` thì về 0    |
| `HeartbeatMonitor.timeout`          | unit   | Nếu không có message trong N ms → gọi onTimeout           |
| `BinanceWsAdapter` parse kline      | unit   | Chỉ emit `CandleClosed` khi `k.x === true`                |
| `BinanceWsAdapter` reconnect        | integ  | Ngắt socket → tự reconnect, resubscribe stream cũ         |
| `SocketGateway.subscribe` validate  | unit   | Reject timeframe không hỗ trợ, reject > 4 timeframe       |
| `SocketGateway` broadcast           | integ  | Chỉ client trong room mới nhận CandleClosed               |
| `SocketGateway` ref-count           | unit   | 2 client subscribe cùng stream → 1 SUBSCRIBE tới Binance  |

---

## 12. Acceptance criteria (Definition of Done)

Module được coi là "xong" khi:

- [ ] `BinanceRestAdapter` fetch được candle từ Binance public API không cần auth.
- [ ] `backfill("BTCUSDT", "1h", now - 365 days)` insert đủ ~8760 candle vào DB.
- [ ] `BinanceWsAdapter` kết nối tới Binance và nhận được candle mới.
- [ ] Khi socket Binance đóng → tự reconnect với exponential backoff (1s → 30s cap).
- [ ] Khi không có message trong 30s → coi như chết, force reconnect.
- [ ] Chỉ emit `CandleClosed` cho candle đã đóng (`k.x === true`).
- [ ] `SocketGateway` đẩy đúng payload `CandleClosed` theo Event Catalog.
- [ ] Frontend mở 4 chart subscribe 4 timeframe → cả 4 đều nhận candle.
- [ ] Ref-count: 5 client subscribe cùng stream → Binance chỉ nhận 1 SUBSCRIBE.
- [ ] Tất cả unit test pass, coverage ≥ 80% cho normalizer + reconnect strategy.
- [ ] Không có reference trực tiếp tới Binance API trong code Frontend (AC-03).
- [ ] Tất cả thao tác với Binance đều qua `BinanceAdapter` (AC-02).

---

## 13. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Binance rate-limit (1200 req/min) | Backfill sleep 80ms giữa các batch; dùng generator để pause/resume |
| Binance trả field khác format giờ | Normalizer là 1 chỗ duy nhất convert; có unit test cho mọi edge case |
| WS reconnect loop vô hạn nếu Binance down | Log + metric `ws.reconnect.attempt`; expose health endpoint; giữ cap 30s |
| Client leak memory khi disconnect | `clientSubs.delete(socketId)` trong `disconnect` handler |
| Nhiều client subscribe trùng stream | Ref-count map (mục 9.3) |
| Clock skew giữa server ↔ Binance | Dùng `server clock` cho `event.timestamp`, dùng `candle.openTime` từ Binance để phân biệt candle |
| Schema thay đổi giữa Tuần 2 | Normalizer là 1 file, nếu schema đổi chỉ sửa 1 chỗ |

---

## 14. Out of scope (Tuần 2)

- Order book / trade-by-trade streaming (chỉ có candle).
- Futures / Margin data.
- User data stream (account balance) — đồ án không cần (Out of Scope: Live Trading).
- Aggregate trade stream.
- Authentication (API key) — chỉ dùng public endpoint.

---

## 15. Implementation — Boot Flow & REST API

Phần này phản ánh implementation thực tế (Tuần 2) trong
`backend/src/modules/market-data/`. Nó *bổ sung* chứ không thay thế các
mục 1–14 ở trên.

### 15.1 Sequence khi service start (`MarketDataService.start`)

```
server.ts
  └─ buildMarketDataContainer()
        ├─ PostgresCandleRepository (Prisma, dùng cặp symbolId/timeframeId cache)
        ├─ BinanceRestAdapter (retry, timeout 10s, max 3 retry, no auth)
        ├─ BinanceWsAdapter (Node `WebSocket`, ref-count, ping 180s)
        └─ ... services khác
  └─ socketGateway.start()        // chỉ attach socket.io handlers
  └─ persister.start()            // subscribe CandleClosed → upsert DB
  └─ marketData.service.start()   // chạy async, không block HTTP listen
        │
        ├─ 1. SymbolSyncService.syncSymbols()
        │     · GET /api/v3/exchangeInfo
        │     · Filter: quoteAsset=USDT && status=TRADING && spotTradingAllowed
        │     · upsert vào `symbols`, deactivate symbol không còn trên Binance
        │
        ├─ 2. DefaultChartSeeder.seedIfEmpty()
        │     · Upsert 6 timeframe (1m/5m/15m/1h/4h/1d) vào `timeframes`
        │     · Nếu `chart_configs` rỗng → tạo 4 pane mặc định
        │         (BTCUSDT × [1m, 1h, 4h, 1d], chartIndex 0..3)
        │     · Nếu không tìm thấy BTCUSDT, fallback symbol active đầu tiên
        │
        ├─ 3. loadActiveChartConfigs() → ChartConfig[]
        │     · Đọc `chart_configs` ORDER BY chart_index ASC
        │
        ├─ 4. BackfillService.backfillInitial(chartConfigs)
        │     · Với mỗi chart: rest.fetchLatest(symbol, tf, 1000)
        │       → repo.upsertBatch (Idempotent, key (symbolId, timeframeId, openTime))
        │     · Sleep 80ms giữa các chart để tránh rate-limit
        │
        ├─ 5. wireWsToEventBus()
        │     · ws.on("CandleClosed") →
        │           · eventBus.publish("market-data.candle.closed", candle)
        │           · repo.upsert(candle) (fire-and-forget với log lỗi)
        │     · ws.on("CandleUpdating") → eventBus.publish("market-data.candle.updating")
        │
        ├─ 6. ws.connect()              // mở WS, resubscribe sau reconnect
        │
        └─ 7. ws.subscribe(symbol, tf)  // ref-count = 1 cho mỗi default stream
```

**Lưu ý:**
- Boot **không block** HTTP — `marketData.service.start()` chạy async;
  endpoint `/api/health` lên ngay tức thì.
- Backfill là "best-effort": nếu 1 chart fail (rate-limit, timeout),
  các chart còn lại vẫn tiếp tục. Lỗi được log rõ (`market-data.backfill.failed`).
- Nếu DB rỗng (fresh deploy) lần đầu chạy chưa sync symbols xong,
  `PostgresCandleRepository.resolveIds()` sẽ throw — chỉ xảy ra khi
  client gọi REST trước khi boot xong. Frontend nên `GET /api/health`
  hoặc đợi `subscribe` WS succeed.

### 15.2 REST API (`/api/candles/...`)

| Method | Path                          | Body / Query                                         | Trả về                                  |
|--------|-------------------------------|------------------------------------------------------|-----------------------------------------|
| GET    | `/api/candles`                | `?symbol=BTCUSDT&timeframe=1h&from=&to=&limit=500`   | `{ success, data: Candle[] }`           |
| POST   | `/api/candles/load-more`      | `{ symbol, timeframe, beforeMs, limit? }`             | `{ success, data: { inserted, candles } }` |
| GET    | `/api/candles/chart-configs`  | —                                                    | `{ success, data: ChartConfig[] }`      |

**Validation:** mọi input đều qua `zod`. Lỗi trả về HTTP 400 với shape:

```json
{ "success": false, "error": "INVALID_QUERY", "details": [...] }
```

**`load-more` flow:**

```
Frontend scroll xuống, hết data hiển thị
    │
    ▼ POST /api/candles/load-more
Body: { symbol: "BTCUSDT", timeframe: "1h", beforeMs: <openTime của candle cũ nhất>, limit: 1000 }
    │
    ▼ BackfillService.loadMore()
    │
    ├─ BinanceRestAdapter.fetchKlines({symbol, timeframe, endMs: beforeMs, limit})
    │       │
    │       └─ CandleNormalizer.fromRestKline() → Candle[]
    │
    ├─ PostgresCandleRepository.upsertBatch()
    │
    └─ return candles[] (sorted ASC, FE merge vào chart)
```

Frontend gọi lặp lại cho đến khi response rỗng (`inserted: 0`) → đã chạm
"đáy" lịch sử Binance có thể trả.

### 15.3 Socket.IO protocol (`SocketGateway`)

**Client → server:**

```json
{ "type": "subscribe",   "symbol": "BTCUSDT", "timeframes": ["1m", "1h"] }
{ "type": "unsubscribe", "symbol": "BTCUSDT", "timeframes": ["1m"] }
```

**Server → client:**

```json
{ "type": "subscribed",   "symbol": "BTCUSDT", "timeframes": ["1m"] }
{ "type": "unsubscribed", "symbol": "BTCUSDT", "timeframes": ["1m"] }
{
  "type": "CandleClosed",
  "version": "1.0",
  "timestamp": 1700000060000,
  "payload": {
    "symbol": "BTCUSDT", "timeframe": "1h",
    "candle": { "openTime": ..., "closeTime": ..., "open": ..., "high": ...,
                "low": ..., "close": ..., "volume": ..., "quoteVolume": ..., "trades": ... },
    "candleKey": "BTCUSDT@1h@1700000400000"
  }
}
{ "type": "error", "code": "INVALID_TIMEFRAME", "message": "..." }
```

**Ref-count (critical):** nếu 5 client cùng subscribe `BTCUSDT@1h`,
Binance chỉ nhận **1 SUBSCRIBE**. Lệnh UNSUBSCRIBE tới Binance chỉ được
gửi khi client cuối cùng rời đi. Logic ref-count nằm trong
`BinanceWsAdapter.subscribe/unsubscribe` (xem `refCount: Map<string, number>`).

### 15.4 Cây thư mục thực tế

```
backend/src/modules/market-data/
├── domain/
│   ├── Candle.ts                    # Internal Candle + candleKey + candleRoom
│   ├── Timeframe.ts                 # Union, Binance map, getStreamKey, helpers
│   ├── ChartConfig.ts               # Chart projection (chartIndex 0..3)
│   ├── CandleRepository.port.ts     # Port interface
│   └── events.ts                    # Event names + CandleClosedEvent schema
├── application/
│   ├── SymbolSyncService.ts         # exchangeInfo → upsert symbols
│   ├── DefaultChartSeeder.ts        # Seed timeframe + 4 ChartConfig
│   ├── BackfillService.ts           # backfillInitial + loadMore
│   └── MarketDataService.ts         # Orchestrator (start/stop/subscribe)
├── infrastructure/
│   ├── BinanceRestAdapter.ts        # fetchKlines + fetchExchangeInfo
│   ├── BinanceWsAdapter.ts          # WS + ref-count + reconnect + heartbeat
│   ├── CandleNormalizer.ts          # Binance DTO → Candle
│   ├── PostgresCandleRepository.ts  # Prisma-backed impl
│   └── ReconnectStrategy.ts         # Exponential backoff + jitter
├── realtime/
│   ├── HeartbeatMonitor.ts          # WS dead-detection
│   ├── SocketGateway.ts             # Socket.IO handlers + broadcast
│   └── CandlePersister.ts           # EventBus → repo (cầu nối)
├── presentation/
│   ├── market-data.routes.ts        # REST endpoints + zod
│   └── chart-config-loader.ts       # Prisma helper
├── container.ts                     # DI wiring
└── index.ts                         # Public exports
```

### 15.5 Event catalog (đồng bộ với `docs/Solution.md` §7)

| Event name                       | Publisher              | Subscribers                                        |
|---------------------------------|------------------------|----------------------------------------------------|
| `market-data.candle.closed`     | BinanceWsAdapter       | `CandlePersister` (DB), các module khác (Strategy, …) |
| `market-data.candle.updating`   | BinanceWsAdapter       | optional (live tick UI nếu cần)                    |
| `market-data.ws.status`         | BinanceWsAdapter       | logger, dashboard                                  |
| `market-data.backfill.progress` | BackfillService        | logger                                             |
| `market-data.symbols.synced`    | SymbolSyncService      | logger                                             |

Downstream consumer `Strategy`/`Backtest`/`Search` subscribe
`market-data.candle.closed` qua `getEventBus()` — không bao giờ gọi trực
tiếp `BinanceWsAdapter` (giữ đúng rule "Module không biết Binance").

### 15.6 Acceptance criteria (bổ sung cho Tuần 2)

- [x] Service start: load symbols từ Binance `/exchangeInfo` → upsert
      `symbols` (filter USDT, status TRADING, spot allowed)
- [x] Service start: upsert 6 timeframe + 4 ChartConfig mặc định nếu rỗng
- [x] Service start: backfill 1000 candle mới nhất cho mỗi ChartConfig
- [x] Service start: connect WS, subscribe từng default stream (ref-count=1)
- [x] Realtime: WS → `market-data.candle.closed` → upsert DB + broadcast room
- [x] Socket.IO: client subscribe → ref-count + join room
- [x] `GET /api/candles` query từ DB (symbol + timeframe + range)
- [x] `POST /api/candles/load-more` mở rộng lịch sử về phía trước (1000/batch)
- [x] `GET /api/candles/chart-configs` trả 4 ChartConfig đang active
- [x] Reconnect: WS đóng → backoff 1s→30s cap; heartbeat 30s timeout
- [x] Graceful shutdown: `SIGTERM` → `service.stop()` → ws.disconnect()

### 15.7 Out of scope (Tuần 3+)

- IndicatorService (RSI, MA, …) — module riêng, consume `CandleClosed`.
- BacktestService — đọc candles từ DB qua `CandleRepository.query()`
- Frontend MultiChart — đã consume Socket.IO + REST ở trên.
