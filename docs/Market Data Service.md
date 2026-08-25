# Market Data Service

**Owner:** Bảo

**Layer:** `domain` → `application` → `infrastructure` → `realtime` → `presentation`

---

## 1. Tổng quan

Market Data Service là module duy nhất giao tiếp với Binance. Nó chịu trách nhiệm:

| Trách nhiệm | Chi tiết |
|--------------|----------|
| Kết nối Binance | REST (`/api/v3/klines`, `/exchangeInfo`) + WebSocket |
| Chuẩn hóa dữ liệu | Binance DTO → internal `Candle` type qua `CandleNormalizer` |
| Lưu trữ | Historical candles xuống PostgreSQL qua `CandleRepository` |
| Phát event | `CandleClosed` trên EventBus nội bộ |
| Broadcast realtime | Đẩy updates tới frontend qua Socket.IO |
| Tự phục hồi | Reconnect với exponential backoff (1s→30s) + heartbeat watchdog (30s) |

---

## 2. Kiến trúc (C4 Level 2)

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                            │
│   RealtimeDashboard — 4 chart panes (BTCUSDT × 1m/1h/4h/1d)       │
└────────────────────────────┬───────────────────────────────────────┘
                             │ Socket.IO + REST
┌────────────────────────────▼───────────────────────────────────────┐
│                        BACKEND (Node.js)                            │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────┐  │
│  │ MarketData  │    │   REST API  │    │   SocketGateway       │  │
│  │  Service    │───▶│ /api/candles│    │ (Socket.IO rooms)    │  │
│  └──────┬──────┘    └──────┬──────┘    └──────────┬───────────┘  │
│         │                  │                        │               │
│         ├──────────────────┤                        │               │
│         ▼                  ▼                        │               │
│  ┌──────────────┐  ┌──────────────────┐          │               │
│  │  Postgres     │  │ BinanceRestAdapter│         │               │
│  │CandleRepository│ │ (historical)    │          │               │
│  └──────────────┘  └──────────────────┘          │               │
│                                                   │               │
│         ┌─────────────────────────────────────────┘               │
│         ▼                                                         │
│  ┌──────────────────┐    ┌─────────────────────┐                 │
│  │ BinanceWsAdapter │───▶│ CandleNormalizer     │                 │
│  │ (realtime)      │    │ (DTO → Candle)       │                 │
│  └────────┬─────────┘    └─────────────────────┘                 │
│           │                                                      │
└───────────▼──────────────────────────────────────────────────────┘
            │ WebSocket (wss://stream.binance.com)
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                         BINANCE                                    │
│   REST API              │        WebSocket Stream                 │
│   /api/v3/klines        │        /stream?streams=btcusdt@...    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. Thư mục

```
backend/src/modules/market-data/
├── domain/
│   ├── Candle.ts                    # Internal type + candleKey + candleRoom
│   ├── Timeframe.ts                 # Union type + Binance map + helpers
│   ├── ChartConfig.ts              # Chart projection (4 panes)
│   ├── CandleRepository.port.ts    # Repository interface (Port pattern)
│   └── events.ts                   # Event names + CandleClosedEvent schema
├── application/
│   ├── MarketDataService.ts        # Orchestrator (boot, subscribe/release)
│   ├── SymbolSyncService.ts        # Sync symbols từ Binance
│   ├── DefaultChartSeeder.ts       # Seed 6 timeframe + 4 ChartConfig
│   └── BackfillService.ts          # backfillInitial + loadMore
├── infrastructure/
│   ├── BinanceRestAdapter.ts       # Historical data (retry, rate-limit)
│   ├── BinanceWsAdapter.ts        # Realtime WS + ref-count + reconnect
│   ├── CandleNormalizer.ts        # Binance DTO → internal Candle
│   ├── PostgresCandleRepository.ts # Prisma-backed persistence
│   └── ReconnectStrategy.ts        # Exponential backoff + jitter
├── realtime/
│   ├── HeartbeatMonitor.ts         # Dead connection detection (30s)
│   ├── SocketGateway.ts           # Socket.IO handlers + broadcast
│   └── CandlePersister.ts         # EventBus → repo bridge
├── presentation/
│   ├── market-data.routes.ts      # REST endpoints + zod validation
│   └── chart-config-loader.ts    # Prisma helper
├── container.ts                   # DI wiring
└── index.ts                      # Public exports
```

---

## 4. Domain Types

### 4.1 Timeframe

```typescript
// backend/src/modules/market-data/domain/Timeframe.ts

export const SUPPORTED_TIMEFRAMES = [
  "1m", "5m", "15m", "1h", "4h", "1d",
] as const;

export const DEFAULT_TIMEFRAMES = ["1m", "1h", "4h", "1d"] as const;

export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export const TIMEFRAME_TO_BINANCE: Record<Timeframe, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};

export const TIMEFRAME_TO_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

export function getStreamKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol.toLowerCase()}@${timeframe}`;
  // Ví dụ: "btcusdt@1h"
}

export function getBinanceStreamName(symbol: string, timeframe: Timeframe): string {
  return `${symbol.toLowerCase()}@kline_${TIMEFRAME_TO_BINANCE[timeframe]}`;
  // Ví dụ: "btcusdt@kline_1h"
}
```

### 4.2 Candle

```typescript
// backend/src/modules/market-data/domain/Candle.ts

export interface Candle {
  symbol: string;       // "BTCUSDT"
  timeframe: Timeframe;
  openTime: number;     // epoch ms
  closeTime: number;    // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;  // volume * price
  trades: number;       // số lệnh trade trong candle
}

// Unique key: "BTCUSDT@1h@1700000400000"
export function candleKey(c: Pick<Candle, "symbol" | "timeframe" | "openTime">): string {
  return `${c.symbol}@${c.timeframe}@${c.openTime}`;
}

// Socket.IO room: "candles:btcusdt@1h"
export function candleRoom(c: Pick<Candle, "symbol" | "timeframe">): string {
  return `candles:${c.symbol.toLowerCase()}@${c.timeframe}`;
}
```

### 4.3 CandleRepository Port

```typescript
// backend/src/modules/market-data/domain/CandleRepository.port.ts

export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  fromMs?: number;  // inclusive
  toMs?: number;    // exclusive
  limit?: number;   // default 500, max 1000
}

export interface CandleRepository {
  upsert(candle: Candle): Promise<void>;
  upsertBatch(candles: Candle[]): Promise<number>;  // inserted count
  query(q: CandleQuery): Promise<Candle[]>;
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  deleteAll(): Promise<void>;
}
```

### 4.4 ChartConfig

```typescript
// backend/src/modules/market-data/domain/ChartConfig.ts

export interface ChartConfig {
  chartIndex: number;  // 0..3 (4 panes)
  symbol: string;      // "BTCUSDT"
  timeframe: Timeframe;
  updatedAt: Date;
}
```

---

## 5. Candle Normalizer

Điểm duy nhất biết Binance format.

```typescript
// backend/src/modules/market-data/infrastructure/CandleNormalizer.ts

// Binance REST kline format
export interface BinanceKlineDTO {
  0: number;  // openTime (ms)
  1: string;  // open
  2: string;  // high
  3: string;  // low
  4: string;  // close
  5: string;  // volume
  6: number;  // closeTime (ms)
  7: string;  // quoteVolume
  8: number;  // trades
}

// Binance WS kline message
export interface BinanceKlineWSMessage {
  e: "kline";
  E: number;
  s: string;
  k: {
    t: number;  // openTime
    T: number;  // closeTime
    i: string;  // interval (e.g. "1m")
    o: string; c: string; h: string; l: string;
    v: string; q: string; n: number;  // trades
    x: boolean;  // candle closed?
  };
}

export class CandleNormalizer {
  // REST → Candle (timeframe phải truyền vào)
  static fromRestKline(symbol, dto, timeframeHint?): Candle

  // REST batch → Candle[]
  static fromRestKlines(symbol, rows, timeframe): Candle[]

  // WS message → Candle (parse timeframe từ k.i)
  static fromWsKline(msg: BinanceKlineWSMessage): Candle
}
```

---

## 6. REST Adapter

### 6.1 Endpoints Binance

```
GET https://api.binance.com/api/v3/klines
  ?symbol=BTCUSDT
  &interval=1h
  &startTime=1700000000000     ← optional
  &endTime=1700100000000       ← optional
  &limit=500                   ← max 1000

GET https://api.binance.com/api/v3/exchangeInfo
  → Lấy danh sách symbols
```

### 6.2 Interface

```typescript
// backend/src/modules/market-data/infrastructure/BinanceRestAdapter.ts

export class BinanceRestAdapter {
  // Lấy N candle gần nhất (default 500)
  fetchLatest(symbol, timeframe, limit = 1000): Promise<Candle[]>

  // Lấy 1 batch klines
  fetchKlines(opts: FetchOptions): Promise<Candle[]>

  // Generator: paginate tự động từ sinceMs → untilMs
  // Mỗi batch tối đa 1000 candle, sleep 80ms giữa requests
  async *fetchSince(symbol, timeframe, sinceMs, untilMs): AsyncGenerator<Candle[]>

  // Lấy exchange info
  fetchExchangeInfo(): Promise<BinanceExchangeInfo>
}
```

### 6.3 Retry & Rate-limit

- Timeout: 10 giây
- Max retries: 3
- Retry on: HTTP 429, 5xx, AbortError
- Delay: exponential backoff (500ms → 1000ms → 2000ms), cap 4000ms
- Rate-limit: sleep 80ms giữa các requests (Binance: 1200 req/min)

---

## 7. WebSocket Adapter

### 7.1 Endpoint Binance

```
wss://stream.binance.com:9443/stream
  ?streams=btcusdt@kline_1m/btcusdt@kline_1h/btcusdt@kline_4h/btcusdt@kline_1d
```

### 7.2 Interface

```typescript
// backend/src/modules/market-data/infrastructure/BinanceWsAdapter.ts

export class BinanceWsAdapter extends EventEmitter {
  // Kết nối WS (auto-resubscribe sau reconnect)
  connect(): Promise<void>

  // Ngắt kết nối
  disconnect(): Promise<void>

  // Subscribe stream (ref-counted)
  subscribe(symbol, timeframe): Promise<void>

  // Unsubscribe stream (ref-counted)
  unsubscribe(symbol, timeframe): Promise<void>

  // Events
  on("CandleClosed", (c: Candle) => void)
  on("CandleUpdating", (c: Candle) => void)  // ~1s pulse
  on("status", (s: ConnectionStatus) => void)
  once("ready", () => void)
}

export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "closed"; reason: string };
```

### 7.3 Ref-count

Nhiều client subscribe cùng stream → chỉ gửi **1 SUBSCRIBE** tới Binance.

```typescript
// refCount: Map<streamKey, count>
// "btcusdt@1h" → 3 (3 client đang subscribe)

// subscribe("BTCUSDT", "1h")
//   refCount["btcusdt@1h"] = 2 → KHÔNG gửi SUBSCRIBE

// unsubscribe("BTCUSDT", "1h")
//   refCount["btcusdt@1h"] = 1 → KHÔNG gửi UNSUBSCRIBE

// unsubscribe cuối cùng
//   refCount["btcusdt@1h"] = 0 → gửi UNSUBSCRIBE
```

### 7.4 Reconnect Strategy

```typescript
// Exponential backoff với jitter
// initialMs: 1000, maxMs: 30000, multiplier: 2, jitterRatio: 0.2

Attempt 1 → 1000ms ±20%  (800-1200ms)
Attempt 2 → 2000ms ±20%  (1600-2400ms)
Attempt 3 → 4000ms ±20%  (3200-4800ms)
Attempt 4 → 8000ms ±20%
Attempt 5 → 16000ms ±20%
Attempt 6+ → 30000ms (capped)
```

### 7.5 Heartbeat Monitor

- Timeout: 30 giây không có message → coi như chết
- Check interval: 30s / 3 = 10 giây
- Khi timeout → gọi `ws.close()` → trigger reconnect

---

## 8. Repository Implementation

```typescript
// backend/src/modules/market-data/infrastructure/PostgresCandleRepository.ts

export class PostgresCandleRepository implements CandleRepository {
  // In-memory caches cho symbolId/timeframeId (tránh query lặp)
  private symbolCache = new Map<string, string>()
  private timeframeCache = new Map<Timeframe, string>()

  upsert(candle): Promise<void>
    // Upsert với unique key (symbolId, timeframeId, openTime)

  upsertBatch(candles): Promise<number>
    // createMany skipDuplicates → trả về số inserted

  query(q: CandleQuery): Promise<Candle[]>
    // WHERE symbolId, timeframeId, openTime range
    // ORDER BY openTime ASC
    // LIMIT

  getLatestOpen(symbol, timeframe): Promise<Candle | null>
    // ORDER BY openTime DESC LIMIT 1

  deleteAll(): Promise<void>
    // Xóa tất cả candles (dùng khi re-backfill)
}
```

---

## 9. Application Services

### 9.1 SymbolSyncService

```typescript
// Sync symbols từ Binance vào DB
syncSymbols(): Promise<{
  added: number;
  deactivated: number;
  total: number;
}>

// 1. GET /api/v3/exchangeInfo
// 2. Filter: quoteAsset=USDT, status=TRADING, isSpotTradingAllowed
// 3. Upsert vào symbols table
// 4. Deactivate symbols không còn trên Binance
```

### 9.2 DefaultChartSeeder

```typescript
// Seed database khi khởi động lần đầu
seedIfEmpty(): Promise<{
  timeframeCount: 6;
  chartConfigs: ChartConfig[];  // 4 panes: 1m, 1h, 4h, 1d
}>

// 1. Upsert 6 timeframe (1m/5m/15m/1h/4h/1d)
// 2. Nếu chart_configs rỗng → tạo 4 panes mặc định (BTCUSDT × default timeframes)
```

### 9.3 BackfillService

```typescript
// Backfill ban đầu (khi boot)
backfillInitial(charts: ChartConfig[]): Promise<BackfillProgress[]>
// Với mỗi chart: fetchLatest → upsertBatch (max 1000 candle)
// Sleep 80ms giữa các chart

// Load thêm historical data (khi user scroll)
loadMore(symbol, timeframe, beforeMs, limit): Promise<Candle[]>
// Fetch candle cũ hơn từ Binance
// Upsert vào DB
// Return candles (sorted ASC)
```

### 9.4 MarketDataService (Orchestrator)

```typescript
// Boot sequence (chạy async, không block HTTP)
async start(): Promise<MarketDataStartResult> {
  // 1. SymbolSyncService.syncSymbols()
  // 2. DefaultChartSeeder.seedIfEmpty()
  // 3. Load active chart configs
  // 4. Clear old candles + re-backfill
  // 5. wireWsToEventBus() — WS → EventBus
  // 6. wsAdapter.connect()
  // 7. wsAdapter.subscribe() cho mỗi default stream
}

async stop(): Promise<void>
// Ngắt WS, unwire event handlers
```

---

## 10. Event Bus

### 10.1 Event Catalog

| Event name | Publisher | Subscribers |
|------------|-----------|-------------|
| `market-data.candle.closed` | BinanceWsAdapter | CandlePersister (DB), Strategy, Backtest |
| `market-data.candle.updating` | BinanceWsAdapter | Frontend (optional live tick) |
| `market-data.ws.status` | BinanceWsAdapter | Logger |
| `market-data.backfill.progress` | BackfillService | Logger |
| `market-data.symbols.synced` | SymbolSyncService | Logger |

### 10.2 CandleClosedEvent Payload

```typescript
{
  event: "CandleClosed",
  version: "1.0",
  timestamp: 1700000060000,  // server clock
  payload: {
    symbol: "BTCUSDT",
    timeframe: "1h",
    candle: {
      openTime: 1700000400000,
      closeTime: 1700003999999,
      open: 42150.50,
      high: 42200.00,
      low: 42100.10,
      close: 42180.75,
      volume: 124.523,
      quoteVolume: 5250100.42,
      trades: 8421
    },
    candleKey: "BTCUSDT@1h@1700000400000"
  }
}
```

---

## 11. Socket.IO Protocol

### 11.1 Client → Server

```json
{ "type": "subscribe", "symbol": "BTCUSDT", "timeframes": ["1m", "1h"] }
{ "type": "unsubscribe", "symbol": "BTCUSDT", "timeframes": ["1m"] }
```

### 11.2 Server → Client

```json
{ "type": "subscribed", "symbol": "BTCUSDT", "timeframes": ["1m"] }
{ "type": "unsubscribed", "symbol": "BTCUSDT", "timeframes": ["1m"] }
{ "type": "error", "code": "SUBSCRIBE_FAILED", "message": "..." }

{
  "type": "CandleClosed",
  "version": "1.0",
  "timestamp": 1700000060000,
  "payload": { ... }
}
```

---

## 12. REST API

| Method | Path | Query / Body | Response |
|--------|------|--------------|----------|
| GET | `/api/candles` | `?symbol=BTCUSDT&timeframe=1h&from=&to=&limit=500` | `{ success, data: Candle[] }` |
| POST | `/api/candles/load-more` | `{ symbol, timeframe, beforeMs, limit? }` | `{ success, data: { inserted, candles } }` |
| GET | `/api/candles/chart-configs` | — | `{ success, data: ChartConfig[] }` |
| PUT | `/api/candles/chart-configs` | `{ chartIndex, symbol, timeframe }` | `{ success, data: ChartConfig[] }` |

### Auto-backfill

`GET /api/candles` có auto-backfill: nếu DB trả về < 10 candles, tự động fetch từ Binance và upsert.

---

## 13. Boot Flow

```
Server start
    │
    ├─ initSocketServer() — Socket.IO singleton
    │
    ├─ buildMarketDataContainer()
    │     │
    │     ├─ PostgresCandleRepository (Prisma)
    │     ├─ BinanceRestAdapter
    │     ├─ BinanceWsAdapter
    │     ├─ BackfillService
    │     ├─ SymbolSyncService
    │     ├─ DefaultChartSeeder
    │     ├─ MarketDataService
    │     ├─ SocketGateway
    │     └─ CandlePersister
    │
    ├─ socketGateway.start() — attach Socket.IO handlers
    ├─ persister.start() — subscribe EventBus → DB
    │
    └─ marketDataService.start() — async, non-blocking
          │
          ├─ SymbolSyncService.syncSymbols()
          ├─ DefaultChartSeeder.seedIfEmpty()
          ├─ loadActiveChartConfigs()
          ├─ deleteAll() + backfillInitial()
          ├─ wireWsToEventBus()
          ├─ wsAdapter.connect()
          └─ wsAdapter.subscribe() × 4 default streams
```

---

## 14. Prisma Schema

```prisma
model Candle {
  id          String   @id @default(uuid())
  symbolId    String
  timeframeId String
  openTime    BigInt   // epoch ms
  closeTime   BigInt
  open        Decimal  @db.Decimal(24, 10)
  high        Decimal  @db.Decimal(24, 10)
  low         Decimal  @db.Decimal(24, 10)
  close       Decimal  @db.Decimal(24, 10)
  volume      Decimal  @db.Decimal(32, 10)
  quoteVolume Decimal  @db.Decimal(32, 10)
  trades      Int

  @@unique([symbolId, timeframeId, openTime])
  @@index([symbolId, timeframeId, openTime(sort: Desc)])
  symbol   Symbol   @relation(...)
  timeframe Timeframe @relation(...)

  @@map("candles")
}

model Timeframe {
  id     String @id @default(uuid())
  code   String @unique  // "1m", "5m", "15m", "1h", "4h", "1d"
  label  String
  seconds Int
  isActive Boolean @default(true)
  candles    Candle[]
  chartConfigs ChartConfig[]

  @@map("timeframes")
}

model Symbol {
  id        String @id @default(uuid())
  symbol    String @unique  // "BTCUSDT"
  baseAsset String
  quoteAsset String
  isActive  Boolean @default(true)
  candles   Candle[]

  @@map("symbols")
}

model ChartConfig {
  id          String @id @default(uuid())
  chartIndex  Int    @unique  // 0..3
  pair        String @default("BTCUSDT")
  timeframeId String
  timeframe   Timeframe @relation(...)

  @@map("chart_configs")
}
```

---

## 15. Out of Scope

- Indicator computation (RSI, MA) — module riêng
- Trading logic — Strategy / Backtest modules
- News / Sentiment — News module
- Order book / trade-by-trade
- Futures / Margin data
- User authentication (API key) — chỉ public endpoints
