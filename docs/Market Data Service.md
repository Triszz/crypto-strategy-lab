# Market Data Service — Specification

**Owner:** Bảo
**Layer:** `domain` → `application` → `infrastructure` → `realtime` → `presentation`
**Trạng thái:** Đang phát triển (Tuần 2) — Reconciliation (§15) đã implement; cần integration test cho outage.

---

## Mục lục

| # | Mục | Mô tả ngắn |
|---|---|---|
| [1](#1-tổng-quan) | Tổng quan | Phạm vi, trách nhiệm, ngoài phạm vi |
| [2](#2-nguyên-tắc-thiết-kế-architectural-drivers) | Nguyên tắc thiết kế | 6 architectural drivers ưu tiên |
| [3](#3-kiến-trúc-c4-level-2--container) | Kiến trúc | C4 Level 2 — Container diagram |
| [4](#4-cấu-trúc-thư-mục) | Cấu trúc thư mục | Layout module + dependency rule |
| [5](#5-domain) | Domain | Timeframe, Candle, Repository port, Events |
| [6](#6-application-services) | Application Services | Sync / Seeder / MarketDataService |
| [7](#7-infrastructure) | Infrastructure | REST / WS / Normalizer / Postgres |
| [8](#8-realtime) | Realtime | Persister + SocketGateway |
| [9](#9-presentation) | Presentation | REST endpoints + zod validation |
| [10](#10-event-bus--chi-tiết) | Event Bus | Wiring, catalog, payload schema |
| [11](#11-socketio-protocol) | Socket.IO Protocol | Client↔Server message, tick semantics |
| [12](#12-boot-flow) | Boot Flow | Thứ tự khởi động từ container → WS |
| [13](#13-luồng-dữ-liệu-3-chiều) | Luồng dữ liệu 3 chiều | REST / Load-more / Realtime |
| [14](#14-prisma-schema-mô-tả) | Prisma Schema | 4 bảng chính + lý do chọn type |
| [15](#15-edge-cases--giải-pháp) | Edge Cases & Giải pháp | 3 tình huống + Reconciliation |
| [16](#16-phụ-thuộc-external) | Phụ thuộc external | Bảng swap-point |
| [17](#17-logging--observability) | Logging & Observability | Log prefixes + sự kiện chính |
| [18](#18-câu-hỏi-mở--chưa-quyết) | Câu hỏi mở | Known limitations / TBD |
| [19](#19-definition-of-done-market-data-module) | Definition of Done | Checklist hoàn thành |

---

## 1. Tổng quan

Market Data Service là module **duy nhất** trong hệ thống được phép giao tiếp trực tiếp với Binance. Mọi candle realtime hay lịch sử đều phải đi qua module này — đây là điểm chốt để các module khác (Strategy, Backtest, Search, Frontend) có thể giả lập dữ liệu qua `EventBus` mà không cần biết Binance.

**Trách nhiệm cốt lõi:**

| Trách nhiệm | Mô tả |
|---|---|
| Kết nối Binance | REST (`/api/v3/klines`, `/api/v3/exchangeInfo`) + WebSocket (`/stream`) |
| Chuẩn hoá dữ liệu | Binance DTO → internal `Candle` qua `CandleNormalizer` |
| Lưu trữ | Historical + realtime candle xuống PostgreSQL qua `CandleRepository` port |
| Phát event | `CandleClosed` / `CandleUpdating` lên `EventBus` nội bộ |
| Broadcast realtime | Đẩy updates tới frontend qua Socket.IO rooms |
| Tự phục hồi | Reconnect WS với exponential backoff (1s → 30s) + heartbeat watchdog (30s) |

**Ngoài phạm vi (Out of Scope):**

- Tính indicator (RSI, MA, MACD…) — thuộc Strategy / Indicator module.
- Logic trading / signal — thuộc Strategy Engine.
- News / Sentiment — module riêng.
- Order book / trade-by-trade / Futures / Margin — không nằm trong MVP.
- Authentication API key — chỉ dùng public endpoints của Binance.

---

## 2. Nguyên tắc thiết kế (Architectural Drivers)

Các quyết định kiến trúc được chốt theo 6 driver ưu tiên:

1. **Realtime** — phải stream candle trong vòng 1 giây sau khi Binance emit; latency là KPI quan trọng nhất.
2. **Reliability** — không được mất candle quá nhiều; mất kết nối phải reconnect và fill gap trong giới hạn chấp nhận được (xem Section 15).
3. **Modifiability** — domain layer là pure TypeScript, không phụ thuộc Prisma / Binance; Infrastructure layer swap được (Postgres → In-memory để test).
4. **Observability** — mọi hành động (sync, backfill, reconnect, persist) đều qua logger với structured fields, có thể grep theo `market-data.*` prefix.
5. **Reproducibility** — cùng 1 tập candle REST phải luôn cho cùng DB state (idempotent upsert).
6. **Backpressure-friendly** — WS read loop không bao giờ block trên network/DB call; persist là fire-and-forget.

---

## 3. Kiến trúc (C4 Level 2 — Container)

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React)                            │
│   RealtimeDashboard — 4 chart panes (BTCUSDT × 1m/1h/4h/1d)       │
│   InfiniteScrollHistory — load older candles on demand              │
└────────────────────────────┬───────────────────────────────────────┘
                             │ Socket.IO + REST (HTTPS)
┌────────────────────────────▼───────────────────────────────────────┐
│                        BACKEND (Node.js)                            │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  MarketData      │    │  REST API        │    │ SocketGateway │ │
│  │  Service         │───▶│  /api/candles    │    │ (Socket.IO)   │ │
│  │  (orchestrator)  │    │  /api/candles/   │    │               │ │
│  └────────┬─────────┘    │   load-more      │    └───────┬───────┘ │
│           │              └────────┬─────────┘            │         │
│           │                       │                       │         │
│           │                       ▼                       │         │
│           │              ┌─────────────────────┐          │         │
│           │              │ BinanceRestAdapter  │          │         │
│           │              │ (historical data)   │          │         │
│           │              └─────────────────────┘          │         │
│           │                                               │         │
│           ▼                                               │         │
│  ┌────────────────────┐      ┌─────────────────────┐      │         │
│  │ BinanceWsAdapter   │─────▶│ CandleNormalizer    │      │         │
│  │ (ref-count +       │      │ (DTO → Candle)      │      │         │
│  │  reconnect +       │      └─────────────────────┘      │         │
│  │  heartbeat)        │                                  │         │
│  └─────────┬──────────┘                                  │         │
│            │                                             │         │
│            │ publish "CandleClosed"                      │         │
│            ▼                                             │         │
│  ┌────────────────────┐      ┌─────────────────────┐      │         │
│  │ EventBus (in-proc) │─────▶│ CandlePersister     │      │         │
│  │                    │      │ (subscribe → upsert)│      │         │
│  └─────────┬──────────┘      └─────────────────────┘      │         │
│            │                                              │         │
│            │ publish                                      │         │
│            ▼                                             │         │
│  ┌────────────────────┐                                  │         │
│  │ PostgresCandleRepo │◀──── (Prisma) ────────────────────┘         │
│  │ (Port: impl)       │                                             │
│  └────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────┘
            │ WebSocket (wss://stream.binance.com)
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                         BINANCE                                    │
│   REST API              │        WebSocket Stream                 │
│   /api/v3/klines        │        /stream?streams=btcusdt@...      │
│   /api/v3/exchangeInfo  │        (combined multi-stream)          │
└───────────────────────────────────────────────────────────────────┘
```

**Đặc tả ranh giới:**

- **MarketDataService** là facade duy nhất. Mọi module khác (Strategy, Backtest, Search, Frontend SocketGateway) **không** import `BinanceWsAdapter` / `BinanceRestAdapter` trực tiếp — chúng chỉ giao tiếp qua `EventBus` (subscribe event) hoặc qua REST endpoint.
- **Repository Port** (`CandleRepository`) cho phép swap implementation (In-memory khi test, Postgres khi prod).
- **EventBus** là contract giữa Market Data và phần còn lại — payload schema versioned (`CANDLE_CLOSED_EVENT_VERSION`).

---

## 4. Cấu trúc thư mục

```
backend/src/modules/market-data/
├── core/                              # 🆕 Core types & interfaces (Provider pattern)
│   ├── types.ts                       # Candle, Timeframe, ChartConfig types
│   ├── events.ts                      # WsConnectionStatus, event types
│   └── ports.ts                       # MarketDataProvider interface
│
├── domain/                            # Legacy domain types (kept for compatibility)
│   ├── Candle.ts                      # Candle type + helpers (candleKey, candleRoom)
│   ├── Timeframe.ts                   # Timeframe type + Binance mappings
│   ├── ChartConfig.ts                 # Chart config type
│   ├── CandleRepository.port.ts       # Repository interface
│   └── events.ts                      # Legacy event definitions
│
├── providers/                         # 🆕 Exchange implementations
│   └── binance/
│       ├── BinanceProvider.ts         # Implements MarketDataProvider (unified facade)
│       ├── BinanceRestClient.ts       # REST API client (historical data)
│       ├── BinanceWsClient.ts         # WebSocket client (realtime streams)
│       ├── BinanceNormalizer.ts       # Binance DTO → internal Candle
│       └── ReconnectStrategy.ts       # Exponential backoff với jitter
│
├── services/                          # 🆕 Business logic (provider-agnostic)
│   ├── MarketDataService.ts           # Orchestrator (boot + subscribe/release)
│   ├── SymbolSyncService.ts           # Sync symbols từ exchange
│   ├── DefaultChartSeeder.ts          # Seed 6 timeframes + 4 default charts
│   ├── BackfillService.ts             # Historical data backfill + load-more
│   └── ReconciliationService.ts       # Reconnect + Periodic gap-fill
│
├── storage/                           # 🆕 Persistence layer
│   └── PostgresCandleRepository.ts    # Prisma-backed persistence + caches
│
├── realtime/                          # Socket.IO layer
│   ├── HeartbeatMonitor.ts            # Dead connection detection (30s timeout)
│   ├── SocketGateway.ts               # Socket.IO handlers + room broadcast
│   └── CandlePersister.ts             # EventBus → repository bridge
│
├── presentation/
│   ├── market-data.routes.ts          # REST endpoints + zod validation
│   └── chart-config-loader.ts         # Prisma helper cho chart configs
│
├── container.ts                       # DI wiring (composition root)
└── index.ts                           # Public exports
```

**Quy tắc phụ thuộc (Dependency Rule) - Provider Pattern:**

- `core` → không phụ thuộc gì cả (zero dependency trong module).
- `providers` → phụ thuộc `core` (implement MarketDataProvider interface) + third-party libs.
- `services` → phụ thuộc `core` (sử dụng MarketDataProvider interface), KHÔNG phụ thuộc `providers`.
- `storage` → phụ thuộc `domain` (implement CandleRepository port) + Prisma.
- `realtime` → phụ thuộc `core` + `services`.
- `presentation` → phụ thuộc `services`.

**Quy tắc phụ thuộc (Dependency Rule):**

- `domain` → không phụ thuộc gì cả (zero dependency trong module).
- `application` → chỉ phụ thuộc `domain` + shared (`Logger`, `EventBus`).
- `infrastructure` → phụ thuộc `domain` (để implement port) + third-party (`@prisma/client`, `node:events`).
- `realtime` → phụ thuộc `infrastructure` + shared (`EventBus`).
- `presentation` → phụ thuộc `application` (gọi `MarketDataService`, `BackfillService`).

---

## 5. Domain

### 5.1 Timeframe

Union type định nghĩa các khung thời gian được hỗ trợ:

- **Supported** (6): `1m`, `5m`, `15m`, `1h`, `4h`, `1d` — khai báo trong DB `timeframes` table.
- **Default** (4): `1m`, `1h`, `4h`, `1d` — dùng để seed 4 chart panes mặc định.

Wire format (Binance interval string) **là identity mapping** với internal code, nên type `Timeframe` được dùng thẳng làm literal khi gọi Binance API.

Helpers:

- `getBinanceStreamName(symbol, timeframe)` → `"btcusdt@kline_1h"` (format cho combined stream).
- `getStreamKey(symbol, timeframe)` → `"btcusdt@1h"` (format cho Socket.IO room).
- `parseBinanceInterval(interval)` → throw nếu interval không supported.
- `timeframeToMs(timeframe)` → milliseconds của 1 candle (vd: `1h` = 3_600_000).

### 5.2 Candle

Internal representation. Không bao giờ expose Binance DTO ra ngoài module.

Các field:

- `symbol: string` — `"BTCUSDT"` (uppercase, theo DB).
- `timeframe: Timeframe`.
- `openTime: number` — epoch ms.
- `closeTime: number` — epoch ms.
- `open / high / low / close: number` — giá (số thực).
- `volume: number` — base asset volume.
- `quoteVolume: number` — quote asset volume.
- `trades: number` — số lệnh trade trong candle.

Helpers:

- `candleKey(candle)` → `"BTCUSDT@1h@1700000400000"` — dùng trong log, dedup key khi cần.
- `candleRoom(candle)` → `"candles:btcusdt@1h"` — Socket.IO room name.

### 5.3 CandleRepository (Port)

Interface hexagonal — Market Data application không bao giờ reach vào Prisma trực tiếp.

Các method:

- `upsert(candle)` — INSERT ON CONFLICT UPDATE theo unique key `(symbolId, timeframeId, openTime)`.
- `upsertBatch(candles)` — `createMany({ skipDuplicates: true })`, trả về count inserted.
- `query({ symbol, timeframe, fromMs?, toMs?, limit? })` — `WHERE openTime BETWEEN from AND to`, ORDER BY openTime ASC, LIMIT (max 1000).
- `getLatestOpen(symbol, timeframe)` — `ORDER BY openTime DESC LIMIT 1`, trả `null` nếu rỗng.
- `deleteAll()` — wipe toàn bộ candles (chỉ dùng khi re-backfill).

### 5.4 ChartConfig

Projection từ DB `chart_configs` table:

- `chartIndex: number` — 0..3 (4 panes cố định).
- `symbol: string`.
- `timeframe: Timeframe`.
- `updatedAt: Date`.

Active variant thêm field `streamKey` (cached) — dùng trong WebSocket ref-count.

### 5.5 Events

Event catalog định nghĩa trong `domain/events.ts`:

- `MARKET_DATA_EVENTS.CANDLE_CLOSED` — `"market-data.candle.closed"`.
- `MARKET_DATA_EVENTS.CANDLE_UPDATING` — `"market-data.candle.updating"`.

Mỗi event có payload schema cố định + version field. Hiện tại `CANDLE_CLOSED_EVENT_VERSION = "1.0"` — bất kỳ thay đổi breaking nào phải bump version, không được silent.

---

## 6. Application Services

### 6.1 SymbolSyncService

Mục đích: đồng bộ `symbols` table từ Binance `/exchangeInfo`.

Quy trình:

1. Gọi `BinanceRestAdapter.fetchExchangeInfo()`.
2. Filter: `quoteAsset === "USDT" && status === "TRADING" && isSpotTradingAllowed`.
3. Load existing symbols một lần, build Map.
4. Process filtered list theo chunk 50 (tránh overwhelm connection pool — quan trọng vì chạy sau PgBouncer ở chế độ transaction pooling).
5. Mỗi symbol → `prisma.symbol.upsert(...)` (idempotent).
6. Symbol nào đang active trong DB nhưng không còn trong upstream → `updateMany({ isActive: false })`.

Output: `{ fetched, inserted, updated (reactivated), deactivated }`.

**Đặc điểm:** Không dùng transaction dài — mỗi upsert là 1 round-trip ngắn, OK với PgBouncer transaction pooling.

### 6.2 DefaultChartSeeder

Mục đích: bootstrap idempotent cho lần chạy đầu.

Quy trình:

1. **Ensure timeframes** — trong 1 transaction, upsert 6 row (`code`, `label`, `seconds`, `isActive`); ngoài transaction, deactivate bất kỳ `timeframes.code` nào không nằm trong supported list.
2. **Ensure chart configs** — nếu `chart_configs` rỗng → chọn `BTCUSDT` (hoặc symbol active đầu tiên theo alphabet nếu BTCUSDT chưa có), tạo 4 row cho 4 default timeframes (`1m, 1h, 4h, 1d`).
3. Nếu đã có → return existing rows (không touch).

Output: `{ timeframeCount, chartConfigs[] }`.

**Đặc điểm:** Idempotent — gọi nhiều lần không gây side effect. Re-running an toàn.

### 6.3 BackfillService

Mục đích: kéo candle lịch sử từ Binance REST, persist idempotent.

Ba entrypoint:

**`backfillInitial(charts)`** — kéo N candle mới nhất mỗi chart (không quan tâm DB):

- Với mỗi chart trong `chartConfigs`: gọi `rest.fetchLatest(symbol, timeframe, min(initialCandles, 1000))`.
- Mặc định `initialCandles = 1000` → kéo 1000 candle gần nhất.
- Persist bằng `repo.upsertBatch(...)` → idempotent upsert.
- Sleep 80ms giữa các chart (Binance rate limit: 1200 req/min).
- Fail-soft: lỗi ở 1 chart không chặn chart khác; log error + tiếp tục.

Output: `BackfillProgress[]` — per-chart `{ chartIndex, symbol, timeframe, candles, batches, durationMs }`.

**`backfillMissing(charts)`** — incremental fill từ `dbLatest+1` đến `now` (dùng cho boot):

- Với mỗi chart: gọi `repo.getLatestOpen(symbol, timeframe)`.
- Nếu DB rỗng (`latest === null`) → fallback về `fetchLatest(initialCandles)` (giống `backfillInitial`).
- Ngược lại: tính `fromMs = latest.openTime + 1`, `untilMs = Date.now()`, rồi `for await batch of rest.fetchSince(...)` → `repo.upsertBatch` cho mỗi batch.
- Skip với log `market-data.backfill-missing.already-fresh` nếu `fromMs >= untilMs`.
- Sleep 80ms giữa các chart, tận dụng throttle 80ms sẵn có trong `fetchSince`.
- **Retention trim** (sau khi fill, kể cả khi fill fail): `repo.trimToLatest(symbol, timeframe, maxCandlesPerChart)`. Mặc định giữ 100 candle/chart — xem `MAX_CANDLES_PER_CHART` trong `env.ts`. Set `0` để tắt trim.

Output: `BackfillProgress[]` cùng shape với `backfillInitial` + field `trimmed` (số row bị xóa).

**`trimToLatest(symbol, timeframe, keepCount)`** (repo) — retention SQL:

- `DELETE FROM candles WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY open_time DESC) AS rn FROM candles WHERE symbol_id = ? AND timeframe_id = ?) ranked WHERE rn > keepCount)`.
- Single statement, race-safe.
- Cần cast `::uuid` vì Prisma truyền param dạng `text`.

**`loadMore(symbol, timeframe, beforeMs, limit)`** — gọi khi user scroll:

- Gọi `rest.fetchKlines({ symbol, timeframe, endMs: beforeMs, limit })`.
- Persist + return candles sorted ASC by openTime.
- **Log removed** — quá verbose khi user scroll (mỗi scroll 1 log).

Limit clamp: `1 <= limit <= 1000`.

### 6.4 MarketDataService (Orchestrator)

Mục đích: top-level facade, gọi 1 lần lúc boot, quản lý lifecycle. Sau refactor, service phụ thuộc vào **MarketDataProvider interface** thay vì concrete Binance adapters.

**Constructor signature (sau refactor):**

```typescript
constructor(
  private readonly provider: MarketDataProvider,     // ✅ Interface, not BinanceWsAdapter
  private readonly repo: CandleRepository,            // ✅ Interface
  private readonly symbolSync: SymbolSyncService,
  private readonly chartSeeder: DefaultChartSeeder,
  private readonly backfill: BackfillService,
  private readonly reconciliation: ReconciliationService,
  private readonly logger: Logger,
) {}
```

#### `start()` — boot sequence (theo đúng thứ tự)

1. **`symbolSync.syncSymbols()`** — đồng bộ symbols.
2. **`chartSeeder.seedIfEmpty()`** — seed timeframes + default charts.
3. **`loadActiveChartConfigs()`** — đọc 4 chart panes từ DB (sắp xếp theo `chartIndex`).
4. **`backfill.backfillMissing(chartConfigs)`** — incremental catch-up:
   - `repo.getLatestOpen(...)` mỗi chart.
   - Nếu rỗng → fallback `fetchLatest(initialCandles)`.
   - Ngược lại → `provider.fetchCandles(...)` với range → `repo.upsertBatch` mỗi batch.
   - DB cũ được giữ nguyên — không wipe.
   - Sau fill: `repo.trimToLatest(symbol, timeframe, MAX_CANDLES_PER_CHART=100)` mỗi chart.
5. **`wireEvents()`** — đăng ký listener từ provider lên EventBus + persistence (xem §10).
6. **`provider.connect()`** — mở WS.
7. **`provider.subscribe(...)` × 4** — subscribe 4 default streams.
8. **`reconciliation.startPeriodic()`** — khởi động periodic gap-fill timer.

Trả về `{ symbols, defaults, chartConfigs }` cho caller log/debug.

**Thứ tự quan trọng:** `wireEvents()` phải chạy **trước** `provider.connect()` để không miss candle close đầu tiên emit ngay khi stream mở.

#### `stop()` — shutdown

1. `reconciliation.stopPeriodic()` — dừng periodic timer.
2. Unwire event handlers.
3. `provider.disconnect()` — gửi close frame 1000, drain, cleanup.
4. WS error trong lúc shutdown → log warn, không rethrow.

#### `ensureSubscribed(symbol, timeframe)` / `releaseSubscription(...)`

Lazy subscribe — gọi từ `SocketGateway` khi client browser yêu cầu stream mà Market Data chưa có. Ref-count trong provider đảm bảo không double-subscribe.

---

## 7. Infrastructure

### 7.1 BinanceProvider (Unified Facade)

**File:** `providers/binance/BinanceProvider.ts`

**Architecture:** `BinanceProvider extends EventEmitter` và implements `MarketDataProvider` interface.

Provider là **unified facade** kết hợp `BinanceRestClient` (historical data) và `BinanceWsClient` (realtime streams). Services chỉ phụ thuộc vào `MarketDataProvider` interface, không biết concrete Binance implementation.

**Event forwarding:**

```typescript
export class BinanceProvider extends EventEmitter implements MarketDataProvider {
  private rest: BinanceRestClient;
  private ws: BinanceWsClient;
  
  constructor(config: { logger: Logger }) {
    super();
    this.rest = new BinanceRestClient(config);
    this.ws = new BinanceWsClient(config);
    
    // Forward WebSocket events với normalized names
    this.ws.on("CandleClosed", (candle: Candle) => {
      this.emit("candle:closed", candle);
    });
    
    this.ws.on("CandleUpdating", (candle: Candle) => {
      this.emit("candle:updating", candle);
    });
    
    this.ws.on("status", (status) => {
      this.emit("status", status);
    });
  }
  
  // REST delegation
  async fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]> {
    return this.rest.fetchKlines(opts);
  }
  
  async fetchSymbols() {
    return this.rest.fetchExchangeInfo();
  }
  
  // WebSocket delegation
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
```

### 7.2 BinanceRestClient

**File:** `providers/binance/BinanceRestClient.ts`

Endpoint:

- `GET /api/v3/klines` — params `symbol`, `interval`, `startTime?`, `endTime?`, `limit?` (max 1000).
- `GET /api/v3/exchangeInfo` — metadata.

Method exposed:

- `fetchLatest(symbol, timeframe, limit)` — gọi `klines` không có time range, Binance trả về `limit` candle mới nhất.
- `fetchKlines({ symbol, timeframe, endMs, limit })` — fetch candle cũ hơn `endMs`.
- `fetchSince(symbol, timeframe, fromMs, untilMs)` — fetch theo range mở (dùng cho §15.4 Reconciliation).
- `fetchExchangeInfo()` — cho SymbolSync.

**Retry & rate-limit:**

- Timeout: 10 giây / request.
- Max retries: 3.
- Retry on: HTTP 429, 5xx, AbortError.
- Delay: exponential backoff (500ms → 1000ms → 2000ms), cap 4000ms.
- Rate-limit: sleep 80ms giữa các requests ở BackfillService level (client không tự throttle — caller chịu trách nhiệm).

### 7.3 CandleNormalizer

**File:** `providers/binance/BinanceNormalizer.ts`

Điểm duy nhất biết Binance format. Mọi conversion Binance DTO → internal `Candle` đều qua đây.

REST kline là tuple 12 phần tử (index 0..11) — parse theo index.

WS kline là object `{ e, E, s, k: { t, T, i, o, c, h, l, v, q, n, x } }` — `x` flag cho biết candle đã đóng.

Class chỉ có static method, không có state:

- `fromRestKline(symbol, dto, timeframeHint?)` — parse 1 row.
- `fromRestKlines(symbol, rows, timeframe)` — parse batch.
- `fromWsKline(msg)` — parse WS message; interval từ `k.i` phải thuộc `SUPPORTED_TIMEFRAMES` (throw nếu không).

### 7.4 BinanceWsClient

**File:** `providers/binance/BinanceWsClient.ts`

**Architecture:** `BinanceWsClient extends EventEmitter` — sử dụng **Node.js EventEmitter** để publish events internal.

Endpoint:

`wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/btcusdt@kline_1h/btcusdt@kline_4h/btcusdt@kline_1d`

Dùng combined multi-stream format (Node `WebSocket` built-in từ undici).

#### Event System — EventEmitter vs EventBus

**BinanceWsAdapter → MarketDataService:** dùng **EventEmitter** (Node.js built-in).

```typescript
// BinanceWsAdapter extends EventEmitter
export class BinanceWsAdapter extends EventEmitter {
  private handleClose(code: number, reason: string): void {
    this.emit("status", { state: "closed", reason: reasonStr });
    // ↑ EventEmitter.emit() — gọi tất cả listeners sync
  }
}

// MarketDataService subscribe
this.wsAdapter.on("status", onStatus);
this.wsAdapter.on("CandleClosed", onClosed);
this.wsAdapter.on("CandleUpdating", onUpdating);
```

**MarketDataService → Modules khác (Strategy, Backtest, Search, Frontend):** dùng **EventBus** (custom wrapper, publish domain events).

```typescript
// MarketDataService publish ra EventBus
const onClosed = (candle: Candle): void => {
  this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_CLOSED, candle);
  // ↑ EventBus.publish() — broadcast ra toàn app
};

this.wsAdapter.on("CandleClosed", onClosed);
```

**Lý do tách 2 layer:**
- **EventEmitter** = Internal communication giữa adapter và service (tight coupling, cùng module).
- **EventBus** = Domain events broadcast ra ngoài module (loose coupling, contract ổn định).

#### Lifecycle

- **`connect()`** — resolve khi WS open + initial subscriptions flush. Nếu đang connecting → trả promise cũ (idempotent).
- **`disconnect()`** — set `stopped = true`, gửi close frame 1000, drain tối đa 1s, emit status `closed`.
- **Reconnect** — `scheduleReconnect()` sau `handleClose()`. Nếu connect fail → recursive với attempt tăng dần.

#### WebSocket Event Handling

**3 listeners chính:**

```typescript
ws.addEventListener("message", (event) => {
  void this.handleMessage(event.data);
  // Parse → emit CandleClosed / CandleUpdating
});

ws.addEventListener("close", (event) => {
  this.handleClose(code, reason);
  // ← Được gọi SAU error event (nếu có lỗi)
  //   Xử lý reconnect ở đây
});

ws.addEventListener("error", (event) => {
  // ← Được gọi TRƯỚC close event
  //   Chỉ log, KHÔNG reconnect (vì close sẽ lo)
  const message = extractErrorMessage(event) ?? "unknown";
});
```

**Flow khi có lỗi:**

```
Error xảy ra (network timeout / server close / ...)
  ↓
1. Fire "error" event  ← Log error, không xử lý reconnect
  ↓
2. Runtime close socket
  ↓
3. Fire "close" event  ← handleClose() → scheduleReconnect()
```

**Kết luận:** Chỉ cần xử lý reconnect ở **close event** — error event luôn theo sau bởi close event.

#### Ref-count

`Map<streamKey, count>`. Mỗi lần `subscribe()`:

1. Tăng count.
2. Chỉ gửi SUBSCRIBE message lên Binance khi `prev === 0` (lần đầu có subscriber).
3. Ngược lại: không gửi gì (stream đã được Binance stream sẵn).

Mỗi lần `unsubscribe()`:

1. Nếu `count <= 1` → xóa khỏi map + gửi UNSUBSCRIBE.
2. Ngược lại: chỉ giảm count.

Ref-count **persist qua reconnect** — không bị clear khi WS disconnect. Khi reconnect, `buildUrl()` đọc lại `activeStreams()` từ map → URL chứa đúng các stream đang được subscriber dùng → Binance tự động stream trở lại.

Xem chi tiết hơn ở §15.

#### Events emit (qua EventEmitter)

- `CandleClosed` — `k.x === true` (candle đã đóng).
- `CandleUpdating` — `k.x === false` (candle đang hình thành, fire ~1 lần/giây).
- `status` — connection lifecycle (`{ state: "connected" | "closed" | "reconnecting", ... }`).
- `ready` — first open sau connect.

**Semantics:**

- `CandleUpdating` → pure in-memory, **KHÔNG persist** vào DB (chỉ broadcast).
- `CandleClosed` → persist vào DB (fire-and-forget trong `MarketDataService.onClosedPersist`) + publish ra EventBus.

#### ReconnectStrategy

Exponential backoff với jitter:

- `initialMs = 1000`, `maxMs = 30000`, `multiplier = 2`, `jitterRatio = 0.2`.

Sequence:

```
Attempt 1 → 1000ms ±20%   (800-1200ms)
Attempt 2 → 2000ms ±20%   (1600-2400ms)
Attempt 3 → 4000ms ±20%   (3200-4800ms)
Attempt 4 → 8000ms ±20%
Attempt 5 → 16000ms ±20%
Attempt 6+ → 30000ms (capped)
```

`reset()` được gọi khi connect thành công → attempt về 1.

### 7.5 HeartbeatMonitor

**File:** `realtime/HeartbeatMonitor.ts`

*(thuộc realtime layer, nhưng được compose trong BinanceWsClient)*

- Timeout: **30 giây** không có message → coi như chết (silent drop).
- Check interval: 10 giây (timeout / 3).
- Khi timeout → gọi `ws.close()` → trigger `handleClose` → `scheduleReconnect`.

Lý do cần: TCP half-open hoặc proxy im lặng có thể làm WS "connected" nhưng không nhận được message nữa — phải có watchdog.

### 7.6 PostgresCandleRepository

**File:** `storage/PostgresCandleRepository.ts`

Implement `CandleRepository` port bằng Prisma.

**Hai cache in-memory:**

- `symbolCache: Map<symbol, symbolId>`.
- `timeframeCache: Map<timeframe, timeframeId>`.

Lý do: trong hot loop của `upsertBatch` (1000 candle), không muốn query `symbols` / `timeframes` cho mỗi candle. Cache được warm 1 lần bằng `loadIdMaps()`, sau đó mọi lookup là O(1).

**Coalescing resolve:** nếu nhiều `resolveIds` call đồng thời (vd: WS burst + REST batch cùng lúc), chỉ 1 `loadIdMaps` chạy — các caller khác await cùng promise.

**Method notes:**

- `upsert(candle)` — dùng compound unique key `(symbolId, timeframeId, openTime)`. BigInt cho openTime/closeTime, Decimal cho giá (precision 24/10 cho OHLC, 32/10 cho volume).
- `upsertBatch(candles)` — gom distinct pairs, resolveIds cho mỗi pair (cache warm), sau đó 1 `createMany({ skipDuplicates: true })`.
- `query` — BigIntFilter cho openTime range, limit clamp 1000.
- `getLatestOpen` — 1 query, ORDER BY openTime DESC LIMIT 1.
- `deleteAll` — `deleteMany({})`. **Chỉ dùng trong `clearAndBackfill` lúc boot.**

---

## 8. Realtime

### 8.1 CandlePersister

Bridge giữa `EventBus` và repository. Subscribe `MARKET_DATA_EVENTS.CANDLE_CLOSED`, gọi `repo.upsert(candle)` cho mỗi event.

Đặc điểm: **fire-and-forget** — không block WS read loop trên DB latency. Nếu persist fail → log error, emit metric, không retry ngay (recovery xem §15).

### 8.2 SocketGateway

Lắng nghe Socket.IO connection từ frontend. Forward subscribe/unsubscribe xuống `MarketDataService.ensureSubscribed` / `releaseSubscription`. Broadcast candle events tới các room tương ứng (`candles:{symbol}@{timeframe}`).

Subscribe **2** listener trên `MarketDataProvider`:

- `candle:closed` → broadcast `{type: "CandleClosed", ...payload}` tới room.
- `candle:updating` → broadcast `{type: "CandleUpdating", ...payload}` tới cùng room (xem §11.3).

Cả hai dùng cùng payload shape (`CandleClosedEventPayload`), nên client phân biệt qua `event` name trong dispatch.

Room key dùng `candleRoom({ symbol, timeframe })` chuẩn hoá lowercase symbol để match với key `MarketDataService` dùng khi join client vào room lúc subscribe.

---

## 9. Presentation

### 9.1 REST API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/candles` | Query candles theo `(symbol, timeframe, from?, to?, limit?)` |
| POST | `/api/candles/load-more` | Fetch candles cũ hơn `beforeMs` (infinite scroll) |
| GET | `/api/candles/chart-configs` | Lấy 4 chart panes hiện tại |
| PUT | `/api/candles/chart-configs` | Cập nhật 1 chart pane |

Tất cả endpoint validate input qua `zod` schema → reject 400 nếu invalid.

**Auto-backfill rule:** `GET /api/candles` — nếu DB trả về < threshold (10), tự động gọi `BackfillService.loadMore(symbol, timeframe, now, 100)` rồi re-query. **Chỉ fill candle mới nhất**, KHÔNG fill gap ở giữa (xem §15).

---

## 10. Event Bus — chi tiết

### 10.1 Wiring — Hai layer event riêng biệt

**Layer 1: BinanceWsClient → BinanceProvider (EventEmitter)**

```typescript
// BinanceWsClient extends EventEmitter
export class BinanceWsClient extends EventEmitter {
  private handleMessage(data: string) {
    const candle = CandleNormalizer.fromWsKline(kmsg);
    if (kmsg.k.x) {
      this.emit("CandleClosed", candle);  // ← EventEmitter.emit()
    } else {
      this.emit("CandleUpdating", candle);
    }
  }
  
  private handleClose(code: number, reason: string) {
    this.emit("status", { state: "closed", reason });
  }
}
```

**Layer 2: BinanceProvider → MarketDataService (EventEmitter normalization)**

```typescript
// BinanceProvider normalizes event names
export class BinanceProvider extends EventEmitter {
  constructor() {
    // Forward with normalized names
    this.ws.on("CandleClosed", (candle) => {
      this.emit("candle:closed", candle);  // ← Normalized name
    });
    
    this.ws.on("CandleUpdating", (candle) => {
      this.emit("candle:updating", candle);
    });
    
    this.ws.on("status", (status) => {
      this.emit("status", status);
    });
  }
}
```

**Layer 3: MarketDataService → Modules khác (EventBus)**

`MarketDataService.wireEvents()` đăng ký **3 listener** trên `MarketDataProvider`:

```typescript
// 1. candle:closed → publish ra EventBus (cho Strategy, Backtest, Search)
const onClosed = (candle: Candle): void => {
  this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_CLOSED, candle);
};
this.provider.on("candle:closed", onClosed);  // ← EventEmitter.on()

// 2. candle:updating → publish ra EventBus (cho Strategy live tick)
const onUpdating = (candle: Candle): void => {
  this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_UPDATING, candle);
};
this.provider.on("candle:updating", onUpdating);

// 3. candle:closed → persist vào DB (fire-and-forget, latency-sensitive)
const onClosedPersist = (candle: Candle): void => {
  void this.repo.upsert(candle);
};
this.provider.on("candle:closed", onClosedPersist);
```

**Lý do tách 2 listener cho `candle:closed`:**

- **EventBus publish** — cho các consumer khác (Strategy, Backtest, Search, SocketGateway).
- **Direct persist** — concern của Market Data, làm thẳng trong service để giảm hop (không qua EventBus vì latency-sensitive).

**Reconnect status wiring:**

```typescript
// MarketDataService.wireEvents()
const onStatus = (status: WsConnectionStatus): void => {
  if (status.state === "reconnecting") {
    this.reconnecting = true;
  }
  if (status.state === "connected" && this.reconnecting) {
    // Edge: reconnecting → connected → trigger gap-fill
    this.reconnecting = false;
    void this.reconciliation.reconcileAll("reconnect");
  }
};
this.provider.on("status", onStatus);
```

### 10.2 EventEmitter vs EventBus — So sánh

| Aspect | EventEmitter (Node.js) | EventBus (custom) |
|--------|------------------------|-------------------|
| **Scope** | Internal communication (adapter ↔ service) | Domain events (service → modules) |
| **Usage** | `this.emit()` / `on()` / `off()` | `eventBus.publish()` / `subscribe()` |
| **Coupling** | Tight (cùng module) | Loose (cross-module contract) |
| **Implementation** | `import { EventEmitter } from "node:events"` | Wrapper around EventEmitter + error isolation |
| **Versioning** | Không có (internal) | Có version field (`CANDLE_CLOSED_EVENT_VERSION = "1.0"`) |
| **Error handling** | Throw nếu listener fail | Catch + log (NFR-018: event failure isolation) |

### 10.3 Event catalog

| Event name | Publisher | Channel | Subscribers |
|---|---|---|---|
| `market-data.candle.closed` | MarketDataService (via EventBus) | In-process EventBus | Strategy, Backtest, Search, SocketGateway |
| `market-data.candle.updating` | MarketDataService (via EventBus) | In-process EventBus | Strategy, Search (live tick) |
| `market-data.ws.status` | BinanceWsAdapter (via EventEmitter) | EventEmitter internal | MarketDataService (reconnect reconciliation) |
| `market-data.backfill.progress` | BackfillService | In-process EventBus | Logger |
| `market-data.symbols.synced` | SymbolSyncService | In-process EventBus | Logger |

**Internal events (EventEmitter, không qua EventBus):**

| Event | Emitter | Listener | Purpose |
|-------|---------|----------|---------|
| `CandleClosed` | BinanceWsAdapter | MarketDataService | Trigger EventBus publish + persist |
| `CandleUpdating` | BinanceWsAdapter | MarketDataService | Trigger EventBus publish |
| `status` | BinanceWsAdapter | MarketDataService | Reconnect reconciliation trigger |
| `ready` | BinanceWsAdapter | MarketDataService | First connect ack |

### 10.4 Payload schema — `CandleClosedEvent` / `CandleUpdatingEvent`

Cả hai event wire shape giống nhau, version `"1.0"`:

- `event: "CandleClosed"` hoặc `"CandleUpdating"`.
- `version: "1.0"` — constant.
- `timestamp: number` — server clock lúc publish (ms epoch).
- `payload.symbol`, `payload.timeframe`.
- `payload.candle` — subset của `Candle` (openTime, closeTime, OHLC, volume, quoteVolume, trades).
- `payload.candleKey` — pre-computed `BTCUSDT@1h@1700000400000` để consumer không phải tự build.

Semantics phân biệt qua `event` name và nguồn gốc:

- `CandleUpdating` — Binance WS flag `k.x === false`, fire ~mỗi giây khi nến đang hình thành. **Pure in-memory**, không bao giờ đi xuống DB (chỉ `CandleClosed` mới persist).
- `CandleClosed` — Binance WS flag `k.x === true`, fire đúng 1 lần khi nến vừa đóng. Được persist qua `MarketDataService.onClosedPersist` (fire-and-forget).

### 10.5 Flow đầy đủ — từ Binance đến Consumer

```
┌─────────────────────────────────────────────────────────┐
│ Binance WS stream                                       │
│ → JSON message (k.x = true/false)                       │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ BinanceWsClient.handleMessage()                         │
│  ├─ Parse → BinanceNormalizer.fromWsKline()             │
│  ├─ if (k.x === true):                                  │
│  │    this.emit("CandleClosed", candle)  ← EventEmitter │
│  └─ else:                                               │
│       this.emit("CandleUpdating", candle)               │
└──────────────────┬──────────────────────────────────────┘
                   │ (EventEmitter internal)
                   ▼
┌─────────────────────────────────────────────────────────┐
│ BinanceProvider (event normalization)                   │
│  ├─ on("CandleClosed") → emit("candle:closed")         │
│  └─ on("CandleUpdating") → emit("candle:updating")     │
└──────────────────┬──────────────────────────────────────┘
                   │ (EventEmitter, normalized names)
                   ▼
┌─────────────────────────────────────────────────────────┐
│ MarketDataService (3 listeners)                         │
│                                                         │
│ 1. on("candle:closed") → EventBus.publish(...)         │
│    ├─ Publish MARKET_DATA_EVENTS.CANDLE_CLOSED         │
│    └─ Consumer: Strategy, Backtest, Search, Socket     │
│                                                         │
│ 2. on("candle:updating") → EventBus.publish(...)       │
│    ├─ Publish MARKET_DATA_EVENTS.CANDLE_UPDATING       │
│    └─ Consumer: Strategy (live signal), SocketGateway  │
│                                                         │
│ 3. on("candle:closed") → repo.upsert(candle)           │
│    └─ Fire-and-forget persist (không qua EventBus)     │
└─────────────────────────────────────────────────────────┘
```

---

## 11. Socket.IO Protocol

### 11.1 Client → Server

- `{ type: "subscribe", symbol, timeframes }` — yêu cầu subscribe 1 symbol × N timeframes.
- `{ type: "unsubscribe", symbol, timeframes }`.

### 11.2 Server → Client

- `{ type: "subscribed", symbol, timeframes }` — ack.
- `{ type: "unsubscribed", symbol, timeframes }` — ack.
- `{ type: "error", code, message }`.
- `{ type: "CandleClosed", version, timestamp, payload }` — broadcast tới room `candles:{symbol}@{timeframe}`.
- `{ type: "CandleUpdating", version, timestamp, payload }` — broadcast tới cùng room `candles:{symbol}@{timeframe}`. Cùng payload shape với `CandleClosed`, chỉ khác `event` name. Phát ~mỗi giây khi nến đang hình thành.

Room-based: Socket.IO chỉ push candle tới client đã subscribe room đó — tiết kiệm bandwidth.

### 11.3 Realtime tick semantics — cây quyết định cho frontend

Khi nhận được một event, client phân loại theo `event`:

```
onCandleClosed / onCandleUpdating(event)
  │
  ├─ list = candlesData[event.payload.timeframe] ?? []
  ├─ incoming = rawToLocal(event.payload.candle, tf)
  │
  ├─ last = list[list.length - 1]
  │
  ├─ last.openTime === incoming.openTime
  │    → thay thế phần tử cuối (in-place update) ──── chart vẫn ở candle hiện tại,
  │                                                   chỉ OHLC/volume nhảy
  │
  └─ last.openTime < incoming.openTime
       → append + cap 100 ──────────────────────────── nến đã đóng, sang cửa sổ mới,
                                                       last CandleUpdating của nến cũ chính là
                                                       CandleClosed tiếp theo, idempotent
```

Nhánh 1 xảy ra trong 2 trường hợp:

- **Cập nhật trong nến đang mở** — mọi `CandleUpdating` đến khi `openTime` vẫn = openTime của nến forming, sẽ vào nhánh 1.
- **Cập nhật ngay sau khi nến đóng** — `CandleClosed` push với cùng `openTime` của nến vừa đóng, vào nhánh 1 (idempotent với CandleUpdating cuối cùng đã đẩy về close tương ứng).

Nhánh 2 xảy ra khi `incoming.openTime` lớn hơn phần tử cuối — nghĩa là bước sang cửa sổ mới (boundary 1m/15m/4h/1d). `append + cap 100` đảm bảo list không phình vô hạn.

**Quy ước quan trọng:**

- Cả `CandleUpdating` lẫn `CandleClosed` đều idempotent — áp dụng cùng logic `updateCandleList`, không cần tách handler.
- KHÔNG bao giờ fetch lại REST/DB cho mỗi tick — toàn bộ vòng đời nến sống trong RAM phía backend và Socket.IO.
- Nếu disconnect trong lúc nến đang mở, reconnect sẽ tự động re-subscribe (client gọi `subscribe` lại) và nhận tick mới ngay khi Binance đẩy về.

---

## 12. Boot Flow

```
Server start
  │
  ├─ buildMarketDataContainer() (DI wiring)
  │     ├─ BinanceProvider (BinanceRestClient + BinanceWsClient)
  │     ├─ PostgresCandleRepository
  │     ├─ BackfillService
  │     ├─ SymbolSyncService
  │     ├─ DefaultChartSeeder
  │     ├─ ReconciliationService
  │     ├─ MarketDataService
  │     ├─ SocketGateway
  │     └─ CandlePersister
  │
  ├─ initSocketServer() (Socket.IO singleton)
  ├─ socketGateway.start() (attach handlers)
  ├─ persister.start() (subscribe EventBus → DB)
  │
  └─ marketDataService.start() (async, không block HTTP listen)
        │
        ├─ 1. SymbolSyncService.syncSymbols()
        │      → Binance /exchangeInfo → Prisma upsert × N
        │
        ├─ 2. DefaultChartSeeder.seedIfEmpty()
        │      → Upsert 6 timeframes
        │      → Nếu chart_configs rỗng → seed 4 chart panes
        │
        ├─ 3. loadActiveChartConfigs()
        │      → SELECT 4 rows theo chartIndex ASC
        │
        ├─ 4. backfill.backfillMissing(chartConfigs)
        │      ├─ repo.getLatestOpen() mỗi chart
        │      ├─ empty DB → fetchLatest(100) fallback
        │      ├─ else → provider.fetchCandles(range) + upsertBatch
        │      └─ trimToLatest(MAX_CANDLES_PER_CHART=100) mỗi chart
        │         (DB cũ giữ nguyên, KHÔNG wipe, nhưng cap về 100/chart)
        │
        ├─ 5. wireEvents()
        │      → on("candle:closed") → EventBus.publish
        │      → on("candle:updating") → EventBus.publish
        │      → on("candle:closed") → repo.upsert (fire-and-forget)
        │
        ├─ 5b. socketGateway.start()
        │      → on("candle:closed") → io.to(room).emit(...)
        │      → on("candle:updating") → io.to(room).emit(...)
        │      (phải chạy TRƯỚC provider.connect() để không miss tick đầu tiên)
        │
        ├─ 6. provider.connect() (mở WS)
        │
        ├─ 7. provider.subscribe(...) × 4
        │      → btcusdt@kline_1m, 1h, 4h, 1d
        │
        └─ 8. reconciliation.startPeriodic()
              → Periodic gap-fill timer
```

**Tính idempotent:** re-run `start()` (vd: test) an toàn. SymbolSync + ChartSeeder đều idempotent; `clearAndBackfill` đảm bảo fresh data.

---

## 13. Luồng dữ liệu 3 chiều

### Chiều 1 — REST query (đọc từ DB)

```
Frontend GET /api/candles?symbol=BTCUSDT&timeframe=1h&limit=500
  │
  ├─► market-data.routes.ts
  │     zod validate → 400 nếu invalid
  │
  ├─► PostgresCandleRepository.query()
  │     WHERE symbolId, timeframeId, openTime range
  │     ORDER BY openTime ASC
  │     LIMIT (max 1000)
  │
  ├─► Auto-backfill: nếu rows.length < 10
  │     → BackfillService.loadMore(symbol, tf, now, 100)
  │     → provider.fetchCandles(...) → repo.upsertBatch
  │     → re-query
  │
  └─► res.json({ success: true, data: candles })
```

### Chiều 2 — Load more (infinite scroll)

```
Frontend POST /api/candles/load-more
  body: { symbol, timeframe, beforeMs, limit }
  │
  ├─► BackfillService.loadMore(symbol, tf, beforeMs, limit)
  │     provider.fetchCandles({ endMs: beforeMs, limit })
  │     → Binance trả candle cũ nhất trước beforeMs
  │     BinanceNormalizer.fromRestKlines()
  │     PostgresCandleRepository.upsertBatch()
  │
  └─► res.json({ inserted, candles: sorted ASC })
       → Frontend splice vào chart
```

### Chiều 3 — Realtime WebSocket

```
Binance WS stream
  │
  ├─► BinanceWsClient.handleMessage()
  │     JSON parse → isWrappedMessage → kmsg
  │
  ├─► heartbeat.beat() (reset watchdog timer)
  │
  ├─► BinanceNormalizer.fromWsKline(kmsg)
  │
  ├─► if (kmsg.k.x === true):
  │     emit("CandleClosed", candle)
  │       └─► BinanceProvider.emit("candle:closed", candle)
  │             ├─► EventBus.publish("CANDLE_CLOSED")
  │             │      → Strategy / Backtest / Search / Frontend nhận
  │             └─► repo.upsert(candle) (async, không block)
  │
  └─► else:
        emit("CandleUpdating", candle)
          └─► BinanceProvider.emit("candle:updating", candle)
                └─► EventBus.publish("CANDLE_UPDATING")
                      → Frontend update chart (chưa đóng)
```

---

## 14. Prisma Schema (mô tả)

Các bảng chính trong schema:

- **`symbols`** — `(id, symbol UNIQUE, baseAsset, quoteAsset, isActive)`. Relationship 1-N với `candles`.
- **`timeframes`** — `(id, code UNIQUE, label, seconds, isActive)`. Relationship 1-N với `candles` và `chart_configs`.
- **`chart_configs`** — `(id, chartIndex UNIQUE, pair, timeframeId FK)`. Hard-cap 4 row (chartIndex 0..3) do unique constraint.
- **`candles`** — `(id, symbolId FK, timeframeId FK, openTime BigInt, closeTime BigInt, open/high/low/close Decimal(24,10), volume/quoteVolume Decimal(32,10), trades Int)`. Compound unique `(symbolId, timeframeId, openTime)`. Index `(symbolId, timeframeId, openTime DESC)` cho query range nhanh.

Lý do chọn `BigInt` cho time: epoch ms trong `number` chỉ chính xác đến 2^53 - 1, đủ cho 100 năm tới nhưng Prisma prefer BigInt để consistent với PostgreSQL `bigint`.

Lý do chọn `Decimal` cho giá: tránh floating-point rounding (quan trọng cho financial data).

---

## 15. Edge Cases & Giải pháp

> **Trạng thái: ✅ ĐÃ IMPLEMENT (Tuần 2).** Xem §15.5 để biết thông số cấu hình.

### 15.1 Tình huống A — Candle đang hình thành, bị ngắt giữa chừng (NO GAP)

**Mô tả:**

- Candle `12:00` đang stream (x=false, `CandleUpdating`).
- 12:00:15 — WS disconnect.
- 12:00:30 — WS reconnect.
- 12:01:00 — Binance emit close cho candle `12:00` (x=true).

**Phân tích:**

Sau reconnect, Binance tiếp tục stream candle `12:00` (vẫn đang mở trên Binance) với `x=false`. Khi candle thực sự đóng lúc 12:01:00, Binance emit với `x=true` → adapter emit `CandleClosed` → `repo.upsert` thành công.

**Kết luận:** ✅ Không có gap. Tất cả candle đều được upsert đầy đủ vì candle đang hình thành **vẫn còn open** khi WS reconnect — Binance không drop state.

**Hành động cần thiết:** Không — behavior hiện tại đã đúng.

### 15.2 Tình huống B — Candle đóng NGAY TRONG khoảng disconnect (GAP THẬT)

**Mô tả:**

- 12:59:30 — WS disconnect.
- 13:00:00 — candle 1h `12:00-13:00` đóng trên Binance. ❌ MISSED.
- 13:00:00 — candle 1h `13:00-14:00` bắt đầu.
- 13:00:30 — WS reconnect.
- 13:01:00 — adapter emit `CandleUpdating` cho candle `13:00`.

**Phân tích:**

- WS reconnect **chỉ stream từ thời điểm hiện tại**, không phát lại candle đã đóng.
- Candle `12:00-13:00` không bao giờ được emit `CandleClosed`.
- DB vẫn giữ bản ghi cũ của candle `12:00` (open/close từ trước disconnect) — **stale data**.
- Query sau này sẽ trả candle `12:00` với `close` không phản ánh giá đóng thật tại 13:00:00.

**Kết luận:** ❌ GAP THẬT. DB sai lệch với Binance.

**Tác động:**

- Strategy / Backtest sử dụng candle close sẽ có signal sai.
- Chart frontend hiển thị candle `12:00` với close không khớp giá thật.
- Auto-backfill ở REST chỉ fill candle **mới nhất** (từ `now`), không fill gap giữa.

### 15.3 Tình huống C — Mất kết nối dài (nhiều candle lỡ)

**Mô tả:**

- Outage 5 phút với timeframe 1m.
- 5 candle (12:00, 12:01, 12:02, 12:03, 12:04) đều bị MISSED.
- Khi reconnect, chỉ stream tiếp candle `12:05` đang mở.

**Phân tích:** Cùng bản chất với Tình huống B, nhưng scale lớn hơn. DB có **chuỗi stale candles** liên tiếp.

### 15.4 Giải pháp đã implement

Service chịu trách nhiệm: `application/ReconciliationService.ts`. Được inject vào `MarketDataService` qua `container.ts`.

#### 15.4.1 Giải pháp 1 — Reconnect Reconciliation

**Trigger:** mỗi khi `wsAdapter` chuyển trạng thái `reconnecting → connected`. Lần `connected` đầu tiên sau boot **bị bỏ qua** vì `clearAndBackfill` đã populate DB — chỉ các reconnect THẬT mới trigger.

**Cơ chế (per active stream, throttled 100ms giữa stream):**

```
1. dbLatest = await repo.getLatestOpen(symbol, timeframe)
2. tfMs = timeframeToMs(timeframe)
3. lastClosedOpenTime = floor(now / tfMs) * tfMs - tfMs
     // openTime của candle cuối cùng đã đóng (loại trừ candle đang mở)
4. if (dbLatest === null) → skip "empty_db"
     // boot backfill lo case này; reconcile không phù hợp fetch từ đầu
5. if (dbLatest.openTime >= lastClosedOpenTime) → skip "no_gap"
6. fromMs = dbLatest.openTime + 1
   untilMs = lastClosedOpenTime   // Binance endTime inclusive
7. for await batch of rest.fetchSince(symbol, timeframe, fromMs, untilMs):
     fetched += batch.length
     upserted += await repo.upsertBatch(batch)
     // fetchSince đã có 80ms throttle giữa batch
   // hard cap MAX_REST_CALLS_PER_RUN = 50 (~ 50_000 candle / 1 stream)
8. sanity check: getLatestOpen sau reconcile → log nếu vẫn stale
```

**Code path:**

- `MarketDataService.wireReconnectReconciliation()` đăng ký listener `wsAdapter.on("status", ...)`.
- Theo dõi cờ `reconnecting` → chỉ fire khi edge `reconnecting → connected`.
- Gọi `reconciliation.reconcileAll("reconnect")` (fire-and-forget, log kết quả).

#### 15.4.2 Giải pháp 2 — Periodic Reconciliation

**Trigger:** `setInterval` mỗi `RECONCILE_INTERVAL_MS` (default **60_000 ms**).

**Cơ chế:** giống §15.4.1, gọi qua `reconciliation.reconcileAll("periodic")`.

**Coalescing:**

- Periodic tick có cờ `runningPeriodic` → skip nếu tick trước còn chạy.
- Per-stream `Promise` map → 2 trigger đồng thời (reconnect + periodic) cho cùng stream share promise.

**Lifecycle:**

- `startPeriodic()` được gọi trong `MarketDataService.start()` SAU khi `wsAdapter.connect()` xong.
- `stopPeriodic()` được gọi trong `MarketDataService.stop()`.

#### 15.4.3 Lưu ý thiết kế

- **Idempotent:** `upsertBatch` (`createMany({ skipDuplicates: true })`) — chạy nhiều lần không tạo duplicate.
- **Per-stream lock:** `Map<streamKey, Promise<ReconciliationResult>>` — coalesce mọi trigger đồng thời.
- **Hard cap:** `MAX_REST_CALLS_PER_RUN = 50` (~ 50_000 candle / 1 stream). Gap lớn hơn sẽ bị log `market-data.reconcile.too-large` + dừng; periodic tick kế tiếp sẽ tiếp tục.
- **Burst protection:** sleep 100ms giữa các stream trong `reconcileAll`. Trong mỗi stream, `fetchSince` đã có 80ms throttle giữa batch.
- **Empty DB guard:** nếu `dbLatest === null`, skip — boot backfill lo case này, không fetch 1000+ candle ngay khi reconnect.

### 15.5 Cấu hình

| Env var | Default | Ý nghĩa |
|---|---|---|
| `RECONCILE_ON_RECONNECT` | `true` | Bật/tắt §15.4.1. Nếu `false`, chỉ periodic chạy. |
| `RECONCILE_INTERVAL_MS` | `60000` | Interval cho §15.4.2. `0` = tắt periodic (chỉ reconnect). |
| `MAX_CANDLES_PER_CHART` | `100` | Retention cap — số candle tối đa giữ lại mỗi (symbol, timeframe). Áp dụng sau `backfillMissing` ở boot. Set `0` để tắt trim. |

Test override: `buildMarketDataContainer({ reconcileIntervalMs: 1000, reconcileOnReconnect: false })`.

### 15.6 Log events

Service emit các structured log sau (prefix `market-data.reconcile.*`):

| Event | Khi nào | Fields chính |
|---|---|---|
| `market-data.reconcile.periodic.started` | Periodic timer khởi động | `intervalMs` |
| `market-data.reconcile.periodic.disabled` | `intervalMs <= 0` | `intervalMs` |
| `market-data.reconcile.periodic.disabled-by-config` | `enabled = false` | — |
| `market-data.reconcile.periodic.stopped` | Periodic timer dừng | — |
| `market-data.reconcile.periodic.filled` | Periodic tick có stream được fill | `streams`, `total` |
| `market-data.reconcile.periodic.skipped-overlap` | Periodic tick bị skip vì tick trước còn chạy | — |
| `market-data.reconcile.reconnect-triggered` | Edge `reconnecting → connected` | `since` |
| `market-data.reconcile.reconnect-filled` | Reconnect fill xong | `streams`, `totalFetched`, `totalUpserted` |
| `market-data.reconcile.coalesced` | Reuse promise đang chạy | `stream`, `trigger` |
| `market-data.reconcile.start` | Bắt đầu 1 stream gap-fill | `trigger`, `stream`, `fromMs`, `untilMs`, `gapCandles` |
| `market-data.reconcile.complete` | Fill xong 1 stream | `trigger`, `stream`, `fetched`, `upserted`, `batches`, `durationMs`, `dbLatestOpenTime`, `stillStale` |
| `market-data.reconcile.no-gap` | DB đã caught-up (log bị tắt trong code) | — |
| `market-data.reconcile.skip-empty-db` | DB rỗng, skip | `stream`, `trigger` |
| `market-data.reconcile.too-large` | Vượt MAX_REST_CALLS_PER_RUN | `stream`, `trigger`, `batches` |
| `market-data.reconcile.failed` | Exception trong runReconcile | `trigger`, `stream`, `err` |

### 15.7 Kịch bản sau khi giải pháp implement

| Tình huống | Trước fix | Sau fix |
|---|---|---|
| A — candle đang mở, disconnect giữa chừng | ✅ OK | ✅ OK (không đổi) |
| B — candle đóng đúng lúc disconnect | ❌ GAP vĩnh viễn | ✅ Fill ngay khi reconnect (Reconnect Reconciliation) |
| C — outage dài, nhiều candle lỡ | ❌ GAP dài | ✅ Fill batch ngay khi reconnect, hoặc trong vòng 60s (Periodic) |

### 15.8 Out-of-band gap — các kịch bản biên

Hai trường hợp sau không tạo gap trong luồng WS bình thường, nhưng cần hiểu rõ để đánh giá đúng hành vi của hệ thống:

1. **Binance maintenance/downtime** — Binance ngừng stream trong 1h, không có message nào trên WS. Khi Binance phục hồi → WS reconnect → Reconnect Reconciliation fill các candle đã đóng trong khoảng downtime.
2. **DB outage kéo dài** — WS vẫn stream nhưng persist fail liên tục. Cần alerting (qua logger error rate) + reconciliation job quét DB đối chiếu Binance.

Cả hai trường hợp đã được giải quyết tự động bằng Reconnect + Periodic Reconciliation (§15.4) — không cần xử lý riêng ngoài hai cơ chế đã mô tả ở §15.4.

---

## 16. Phụ thuộc external

| Dependency | Vai trò | Swap được? |
|---|---|---|
| Binance REST API | Source historical candles + exchange info | ✅ Có (qua `MarketDataProvider` interface) |
| Binance WebSocket | Source realtime candles | ✅ Có (qua `MarketDataProvider` interface) |
| PostgreSQL | Persist candles + metadata | ✅ Có (qua `CandleRepository` port) |
| Prisma Client | ORM cho PostgreSQL | ✅ Có (chỉ trong `storage`, không leak ra services) |
| Socket.IO | Push realtime tới frontend | ✅ Có (qua `SocketGateway`) |
| EventBus (in-proc) | Contract giữa Market Data và modules khác | ⚠️ Không (đây là contract ổn định) |

**Provider Pattern benefits:**
- `BinanceProvider` implements `MarketDataProvider` interface.
- Services phụ thuộc vào interface, không phụ thuộc concrete Binance classes.
- Swap provider bằng cách thay đổi 1 dòng trong `container.ts`:
  ```typescript
  const provider = new OkxProvider({ logger });  // thay vì BinanceProvider
  ```
- Mọi dependency external đều **đằng sau interface** trong services layer — không bao giờ để Binance DTO / Prisma client lọt ra ngoài.

---

## 17. Logging & Observability

Mọi log đều dùng `Logger` (pino) với prefix `market-data.*` để grep dễ:

- `market-data.start` — boot bắt đầu.
- `market-data.start.complete` — boot hoàn tất.
- `market-data.symbols.fetched` / `synced` — sync symbols.
- `market-data.timeframes.seeded` / `chart-config.seeded` — seed.
- `market-data.charts.loaded` — đọc chart configs.
- `market-data.backfill-missing.empty-db` / `backfill-missing.already-fresh` / `backfill-missing.complete` / `backfill-missing.failed` — incremental catch-up lúc boot.
- `market-data.backfill-missing.trim-failed` — retention trim lỗi.
- `market-data.backfill.complete` — backfill initial (ít dùng).
- `market-data.backfill.failed` — backfill chart fail.
- `market-data.persist.failed` — persist candle lỗi (gồm `candleKey` + `err.message`).
- `market-data.stop` / `market-data.stop.ws-error` — shutdown.

**Logs đã tắt (too verbose):**
- ❌ `market-data.backfill.load-more` — mỗi lần user scroll 1 log (quá nhiều).
- ❌ `market-data.reconcile.no-gap` — periodic tick liên tục log khi không có gap (noise).

WebSocket log ở adapter (prefix `binance.ws.*`):

- `binance.ws.connecting` / `connected` / `closed` / `error` / `heartbeat.timeout` / `reconnect.failed` / `parse.failed`.

ReconnectStrategy không log trực tiếp — emit thông qua status event để caller log.

Log events cho Reconciliation xem §15.6.

---

## 18. Câu hỏi mở / chưa quyết

1. **Persist on disconnect boundary:** khi WS disconnect, candle đang mở có nên được mark "stale" trong DB không? Hiện tại KHÔNG — chỉ persist khi nhận `CandleClosed`. Nếu cần, có thể thêm flag `isStale` set khi heartbeat timeout.
2. **Rate-limit coordination:** nếu nhiều module cùng gọi Binance REST (Backfill + Periodic Reconciliation + REST auto-backfill), cần shared rate limiter. Hiện tại chưa có.
3. **Multi-symbol fanout:** hiện chỉ support BTCUSDT default. Khi mở rộng symbol, ref-count vẫn work nhưng số stream tăng tuyến tính — cần check giới hạn Binance (1024 stream / connection).
4. **Backpressure:** nếu DB chậm, fire-and-forget persist có thể pile up promise → memory leak. Cần bound queue size + drop oldest.

Các câu hỏi trên đều **chưa implement** — ghi nhận để cân nhắc khi mở rộng.

---

## 19. Definition of Done (Market Data module)

Module được coi là "xong" khi:

- [x] Boot sequence chạy thành công, DB có 6 timeframes + 4 chart panes + ~4000 candles (1000 × 4).
- [x] WS realtime stream 4 default charts, frontend nhận được `CandleClosed` qua Socket.IO.
- [x] REST API `/candles` và `/load-more` trả data đúng + auto-backfill khi DB rỗng.
- [x] Symbol sync chạy mỗi boot, không crash khi Binance đổi symbol list.
- [x] Reconnect tự động khi WS drop (test bằng cách disable network).
- [x] **Giải pháp edge case §15 implement + test:** reconnect fill gap, periodic fill gap (`ReconciliationService`).
- [ ] Test integration: simulate outage 5 phút → verify DB fill đầy đủ sau reconnect.
- [ ] Load test: 100 client subscribe cùng stream → không duplicate SUBSCRIBE message.
- [ ] Memory profiling trong 24h stream — không có leak.

---

## 20. Multi-Symbol Support — Frontend Symbol Switching

> **Trạng thái:** TUẦN 3 — ĐÃ SPEC, ĐANG IMPLEMENT

### 20.1 Mục tiêu

Cho phép user chọn symbol khác (ETHUSDT, BNBUSDT, ...) từ frontend dashboard → reset 4 charts → fetch + subscribe realtime cho symbol mới.

### 20.2 Backend support hiện tại

✅ Backend ĐÃ SẴN SÀNG — không cần thay đổi:

- `BinanceWsAdapter` hỗ trợ multi-symbol stream qua ref-count mechanism.
- `BinanceRestAdapter.fetchLatest` / `fetchKlines` accept bất kỳ symbol nào.
- `PostgresCandleRepository` query theo `(symbol, timeframe)` pair — không hardcode BTCUSDT.
- `SocketGateway` broadcast theo room `candles:{symbol}@{timeframe}` — dynamic symbol.

### 20.3 Frontend changes required

#### State additions

```
selectedSymbol: string            // "BTCUSDT" | "ETHUSDT" | ...
availableSymbols: string[]        // ["BTCUSDT", "ETHUSDT", "BNBUSDT", ...]
isChangingSymbol: boolean         // Loading state khi đổi symbol
```

#### UI component

**Location:** Header section của `RealtimeDashboard`, bên trái timeframe dropdowns.

**Component:** Dropdown selector (styled giống timeframe dropdown).

**Options:** 8-10 major USDT pairs (BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, MATICUSDT).

**Visual state:**
- Default: `BTCUSDT` selected.
- Hover: highlight, cursor pointer.
- Active (đang đổi): disable dropdown + spinner icon.
- After change: flash success (optional).

#### Symbol change flow

```
User clicks new symbol
  ↓
1. Set isChangingSymbol = true
  ↓
2. Unsubscribe WebSocket cho 4 charts (old symbol)
   → socket.emit("unsubscribe", { symbol: oldSymbol, timeframes: [tf0, tf1, tf2, tf3] })
  ↓
3. Clear candle data state
   → setCandleData({})    // Wipe tất cả keys
  ↓
4. Update selectedSymbol state
   → setSelectedSymbol(newSymbol)
  ↓
5. useEffect với dependency [selectedSymbol] trigger:
   a. Fetch historical data cho 4 charts
      → Promise.all([
           api.fetchCandles(newSymbol, timeframes[0], 100),
           api.fetchCandles(newSymbol, timeframes[1], 100),
           api.fetchCandles(newSymbol, timeframes[2], 100),
           api.fetchCandles(newSymbol, timeframes[3], 100),
         ])
   b. Subscribe WebSocket cho 4 charts (new symbol)
      → socket.emit("subscribe", { symbol: newSymbol, timeframes: [...] })
  ↓
6. Charts auto-rerender với data mới (candleData state updated)
  ↓
7. Set isChangingSymbol = false
```

#### Edge cases

**Race condition:** user đổi symbol 2 lần nhanh (BTCUSDT → ETHUSDT → BNBUSDT).
- **Solution:** disable dropdown khi `isChangingSymbol = true`. Queue không cần thiết vì user không thể click.

**WebSocket subscription overlap:** unsubscribe chưa xong, subscribe đã gửi.
- **Solution:** backend ref-count xử lý — unsubscribe giảm count, subscribe tăng count. Nếu stream đang active cho chart khác, không ảnh hưởng.

**Stale candle data:** sau clear, nhận được 1 tick cuối từ old symbol (latency).
- **Solution:** check `event.payload.symbol === selectedSymbol` trước khi update candleData. Drop event nếu không match.

**Historical fetch fail:** 1 trong 4 API call lỗi.
- **Solution:** fail-soft — chart nào lỗi show empty + error badge. Các chart khác vẫn render. Retry button (optional).

#### Memory cleanup

**Old candle data:** `setCandleData({})` clear toàn bộ — JS GC tự dọn.

**WebSocket listeners:** không cần remove listener vì `SocketGateway` broadcast theo room — client auto unsubscribe khi emit `unsubscribe`.

### 20.4 Implementation checklist

- [ ] Add symbol state (`selectedSymbol`, `availableSymbols`, `isChangingSymbol`) vào `RealtimeDashboard`.
- [ ] Build UI dropdown component (styled theo design_sense palette).
- [ ] Implement `handleSymbolChange(newSymbol)` function:
  - [ ] Unsubscribe old symbol (4 timeframes).
  - [ ] Clear `candleData` state.
  - [ ] Update `selectedSymbol`.
- [ ] Update `useEffect` dependency array: thêm `selectedSymbol`.
- [ ] Add symbol guard trong WebSocket message handler: `if (payload.symbol !== selectedSymbol) return;`.
- [ ] Update all `fetchCandles` / `socket.emit` calls: replace hardcoded `"BTCUSDT"` bằng `selectedSymbol`.
- [ ] Test scenario:
  - [ ] Đổi BTCUSDT → ETHUSDT → verify 4 charts load ETHUSDT data.
  - [ ] Đổi symbol khi đang nhận realtime tick → verify không có stale data từ old symbol.
  - [ ] Đổi timeframe SAU KHI đổi symbol → verify vẫn work (symbol + timeframe independent).

### 20.5 Backend changes

**KHÔNG CẦN THAY ĐỔI** — backend architecture đã hỗ trợ multi-symbol từ đầu. Chỉ frontend cần adapt.

### 20.6 Testing notes

**Manual test:**
1. Boot backend + frontend.
2. Default dashboard shows BTCUSDT × 4 timeframes.
3. Click symbol dropdown → chọn ETHUSDT.
4. Verify:
   - 4 charts clear trong ~200ms.
   - 4 charts load lại ETHUSDT historical candles.
   - Realtime tick cho ETHUSDT stream vào (check DevTools Network → WS frame).
   - KHÔNG còn BTCUSDT tick nào (check console log).
5. Đổi timeframe của 1 chart → verify chart đó fetch ETHUSDT data cho timeframe mới, 3 chart kia giữ nguyên.
6. Đổi lại về BTCUSDT → verify reset + load lại.

**Load test:** chưa cần thiết ở giai đoạn này — backend đã test ref-count stability (§15 reconciliation test cover điều này gián tiếp).

### 20.7 Known limitations

- **Symbol list hardcoded:** `availableSymbols` là array tĩnh trong frontend. Nếu muốn dynamic (fetch từ `/api/symbols`), cần thêm endpoint + query lúc mount. Không làm trong scope này.
- **No symbol search:** dropdown chỉ list 8-10 coins phổ biến. Nếu cần search bar (type "SOL" → filter), làm sau.
- **No persistence:** reload page → về lại BTCUSDT default. Nếu cần persist user choice (localStorage / query param), làm sau.

---