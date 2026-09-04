# Market Data Service Documentation

**Status:** ✅ Implemented  
**Author:** System Design  
**Date:** 2026-09-04  
**Version:** 2.0 (Refactored with Provider Pattern)

---

## Overview

Market Data module quản lý việc fetch, store, và stream real-time candlestick data từ cryptocurrency exchanges. Module này đã được refactor để support nhiều exchanges thông qua Provider Pattern.

### Core Features

✅ **Multi-exchange support** - Provider pattern cho phép swap exchanges dễ dàng  
✅ **Real-time streaming** - WebSocket cho live candle updates  
✅ **Historical backfill** - Tự động load historical data khi khởi động  
✅ **Data reconciliation** - Sync WebSocket data với REST API để đảm bảo consistency  
✅ **Symbol management** - Sync exchange symbols to database  
✅ **Chart configuration** - Multi-timeframe chart configs with persistence  
✅ **Socket.IO gateway** - Broadcast real-time data to frontend clients  

---

## Architecture

### Folder Structure

```
backend/src/modules/market-data/
  ├── core/                           # Core types & interfaces
  │   ├── types.ts                    # Candle, Timeframe, ChartConfig types
  │   ├── events.ts                   # Event types (CandleClosed, CandleUpdating, etc.)
  │   └── ports.ts                    # MarketDataProvider & CandleRepository interfaces
  │
  ├── providers/                      # Exchange implementations
  │   └── binance/
  │       ├── BinanceProvider.ts      # Unified provider (implements MarketDataProvider)
  │       ├── BinanceRestClient.ts    # REST API client
  │       ├── BinanceWsClient.ts      # WebSocket client
  │       ├── BinanceNormalizer.ts    # Data normalization
  │       └── ReconnectStrategy.ts    # Exponential backoff reconnection
  │
  ├── services/                       # Business logic (exchange-agnostic)
  │   ├── MarketDataService.ts        # Main orchestrator service
  │   ├── BackfillService.ts          # Historical data backfill
  │   ├── ReconciliationService.ts    # REST ↔ WS data sync
  │   ├── SymbolSyncService.ts        # Exchange symbols sync
  │   └── DefaultChartSeeder.ts       # Default chart config seeder
  │
  ├── realtime/                       # Socket.IO layer
  │   ├── SocketGateway.ts            # Socket.IO event broadcasting
  │   ├── CandlePersister.ts          # Persist real-time candles to DB
  │   └── HeartbeatMonitor.ts         # WebSocket connection health monitoring
  │
  ├── storage/                        # Persistence layer
  │   └── PostgresCandleRepository.ts # Postgres repository implementation
  │
  ├── presentation/                   # HTTP layer
  │   ├── market-data.routes.ts       # REST API routes
  │   └── chart-config-loader.ts      # Load chart configs from file
  │
  ├── container.ts                    # Dependency injection container
  └── index.ts                        # Public exports
```

### Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│           (HTTP Routes, Socket.IO Gateway)                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  MarketDataService → BackfillService                         │
│                   → ReconciliationService                    │
│                   → SymbolSyncService                        │
│                   → DefaultChartSeeder                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Core Interfaces                           │
│           MarketDataProvider (interface)                     │
│           CandleRepository (interface)                       │
└─────────────────────────────────────────────────────────────┘
                            ↑
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────────────┐  ┌────────────────┐  ┌──────────────┐
│BinanceProvider│  │PostgresRepo    │  │MockProvider  │
│(Infrastructure│  │(Infrastructure)│  │  (Testing)   │
└───────────────┘  └────────────────┘  └──────────────┘
```

---

## Core Interfaces

### 1. MarketDataProvider Interface

**File:** `core/ports.ts`

Interface chính định nghĩa contract cho mọi exchange provider.

```typescript
export interface MarketDataProvider {
  // ===== REST Operations =====
  fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]>;
  fetchSymbols(): Promise<ExchangeSymbol[]>;
  
  // ===== WebSocket Lifecycle =====
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // ===== Stream Management =====
  subscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  unsubscribe(symbol: string, timeframe: Timeframe): Promise<void>;
  
  // ===== Event Emitter =====
  on(event: "candle:closed", listener: (c: Candle) => void): void;
  on(event: "candle:updating", listener: (c: Candle) => void): void;
  on(event: "status", listener: (s: WsConnectionStatus) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  
  // ===== State Inspection =====
  isConnected(): boolean;
  activeStreams(): string[];
}
```

**Key Benefits:**
- Exchange-agnostic - Services depend on interface, not concrete Binance classes
- Testable - Easy to mock for unit tests
- Swappable - Change provider in container without touching business logic

### 2. CandleRepository Interface

**File:** `core/ports.ts`

Interface cho candle persistence operations.

```typescript
export interface CandleRepository {
  upsert(candle: Candle): Promise<void>;
  upsertBatch(candles: Candle[]): Promise<number>;
  query(q: CandleQuery): Promise<Candle[]>;
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;
  deleteAll(): Promise<void>;
  trimToLatest(symbol: string, timeframe: Timeframe, keepCount: number): Promise<number>;
}
```

---

## Implementation Details

### BinanceProvider (Unified Facade)

**File:** `providers/binance/BinanceProvider.ts`

Implements `MarketDataProvider` interface bằng cách compose REST client và WebSocket client.

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
  
  // Delegate to REST client
  async fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]> {
    return this.rest.fetchKlines(opts);
  }
  
  async fetchSymbols() {
    return this.rest.fetchExchangeInfo();
  }
  
  // Delegate to WebSocket client
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

**Key Responsibilities:**
- Compose REST and WebSocket clients
- Normalize event names (Binance-specific → provider-agnostic)
- Implement `MarketDataProvider` interface

---

### BinanceRestClient

**File:** `providers/binance/BinanceRestClient.ts`

Handles HTTP requests to Binance REST API.

```typescript
export class BinanceRestClient {
  private baseUrl = "https://api.binance.com";
  
  async fetchKlines(opts: FetchCandlesOptions): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol: opts.symbol.toUpperCase(),
      interval: opts.timeframe,
      limit: String(opts.limit || 500),
    });
    
    if (opts.startMs) params.append("startTime", String(opts.startMs));
    if (opts.endMs) params.append("endTime", String(opts.endMs));
    
    const url = `${this.baseUrl}/api/v3/klines?${params}`;
    const response = await pRetry(() => fetch(url), {
      retries: 3,
      onFailedAttempt: (err) => {
        this.logger.warn("binance-rest.retry", { attempt: err.attemptNumber });
      },
    });
    
    if (!response.ok) {
      throw new ExternalServiceError("BINANCE_KLINE_FETCH_FAILED", ...);
    }
    
    const raw = await response.json();
    return raw.map((k: any[]) => BinanceNormalizer.normalizeKline(k));
  }
  
  async fetchExchangeInfo(): Promise<ExchangeSymbol[]> {
    const url = `${this.baseUrl}/api/v3/exchangeInfo`;
    const response = await fetch(url);
    const data = await response.json();
    
    return data.symbols.map((s: any) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      status: s.status,
      isSpotTradingAllowed: s.isSpotTradingAllowed,
    }));
  }
}
```

**Features:**
- Retry logic với `p-retry`
- Error handling với custom `ExternalServiceError`
- Data normalization qua `BinanceNormalizer`

---

### BinanceWsClient

**File:** `providers/binance/BinanceWsClient.ts`

Manages WebSocket connections và stream subscriptions.

**Key Features:**
- Ref-counted subscriptions (nhiều consumers share cùng stream)
- Auto-reconnect với exponential backoff
- Heartbeat monitoring
- Event emitter cho `CandleClosed`, `CandleUpdating`, `status`

```typescript
export class BinanceWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, number>(); // stream key → ref count
  private reconnectStrategy = new ReconnectStrategy();
  
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    const url = `wss://stream.binance.com:9443/ws`;
    this.ws = new WebSocket(url);
    
    this.ws.on("open", () => {
      this.emit("status", { state: "connected", since: Date.now() });
      this.reconnectStrategy.reset();
    });
    
    this.ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.e === "kline") {
        const candle = BinanceNormalizer.normalizeKline(msg.k);
        const event = msg.k.x ? "CandleClosed" : "CandleUpdating";
        this.emit(event, candle);
      }
    });
    
    this.ws.on("close", () => {
      this.emit("status", { state: "disconnected" });
      this.handleReconnect();
    });
  }
  
  async subscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const streamKey = `${symbol.toLowerCase()}@kline_${timeframe}`;
    
    // Ref-counted subscription
    const currentCount = this.subscriptions.get(streamKey) || 0;
    this.subscriptions.set(streamKey, currentCount + 1);
    
    // Only subscribe to Binance if first subscriber
    if (currentCount === 0) {
      this.ws?.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: [streamKey],
        id: Date.now(),
      }));
    }
  }
  
  async unsubscribe(symbol: string, timeframe: Timeframe): Promise<void> {
    const streamKey = `${symbol.toLowerCase()}@kline_${timeframe}`;
    const currentCount = this.subscriptions.get(streamKey) || 0;
    
    if (currentCount <= 1) {
      this.subscriptions.delete(streamKey);
      
      // Only unsubscribe from Binance if last subscriber
      this.ws?.send(JSON.stringify({
        method: "UNSUBSCRIBE",
        params: [streamKey],
        id: Date.now(),
      }));
    } else {
      this.subscriptions.set(streamKey, currentCount - 1);
    }
  }
  
  private handleReconnect(): void {
    const delay = this.reconnectStrategy.nextDelay();
    this.emit("status", { state: "reconnecting", retryAfterMs: delay });
    
    setTimeout(() => {
      void this.connect();
    }, delay);
  }
}
```

---

### MarketDataService (Main Orchestrator)

**File:** `services/MarketDataService.ts`

Service chính orchestrate tất cả market data operations.

```typescript
export class MarketDataService {
  constructor(
    private readonly provider: MarketDataProvider,     // ✅ Interface dependency
    private readonly repo: CandleRepository,
    private readonly reconciliation: ReconciliationService,
    private readonly symbolSync: SymbolSyncService,
    private readonly chartSeeder: DefaultChartSeeder,
    private readonly backfill: BackfillService,
    private readonly logger: Logger,
  ) {}
  
  async start() {
    this.logger.info("market-data.start");
    
    // 1. Connect to exchange WebSocket
    await this.provider.connect();
    
    // 2. Sync symbols from exchange to DB
    const symbols = await this.symbolSync.syncSymbols();
    this.logger.info("symbols.synced", { count: symbols.length });
    
    // 3. Seed default charts if empty
    const defaults = await this.chartSeeder.seedIfEmpty();
    
    // 4. Load active chart configs
    const chartConfigs = await this.loadActiveChartConfigs();
    this.logger.info("charts.loaded", { count: chartConfigs.length });
    
    // 5. Backfill historical data for each chart
    for (const chart of chartConfigs) {
      await this.backfill.backfillChart(chart);
    }
    
    // 6. Wire event handlers
    this.provider.on("status", this.handleStatus.bind(this));
    this.provider.on("candle:closed", this.handleCandleClosed.bind(this));
    
    // 7. Subscribe to real-time streams
    for (const chart of chartConfigs) {
      await this.provider.subscribe(chart.symbol, chart.timeframe);
      this.logger.info("stream.subscribed", { 
        symbol: chart.symbol, 
        timeframe: chart.timeframe 
      });
    }
    
    // 8. Start periodic reconciliation
    this.reconciliation.startPeriodic();
    
    return { symbols, defaults, chartConfigs };
  }
  
  async stop() {
    this.reconciliation.stopPeriodic();
    await this.provider.disconnect();
    this.logger.info("market-data.stopped");
  }
  
  /**
   * Lazy subscribe for dynamic client requests (via SocketGateway).
   */
  async ensureSubscribed(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.provider.subscribe(symbol, timeframe);
  }
  
  async releaseSubscription(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.provider.unsubscribe(symbol, timeframe);
  }
  
  private handleStatus(status: WsConnectionStatus): void {
    if (status.state === "connected") {
      // Trigger reconciliation after reconnect
      void this.reconciliation.reconcileAll("reconnect");
    }
  }
  
  private handleCandleClosed(candle: Candle): void {
    this.logger.debug("candle.closed", {
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      openTime: new Date(candle.openTime).toISOString(),
    });
  }
}
```

---

### BackfillService

**File:** `services/BackfillService.ts`

Backfill historical candles khi app khởi động.

```typescript
export class BackfillService {
  constructor(
    private readonly provider: MarketDataProvider,     // ✅ Interface dependency
    private readonly repo: CandleRepository,
    private readonly logger: Logger,
  ) {}
  
  async backfillChart(chart: ChartConfig): Promise<void> {
    const { symbol, timeframe } = chart;
    
    // Check latest candle in DB
    const latestCandle = await this.repo.getLatestOpen(symbol, timeframe);
    
    let startMs: number;
    if (latestCandle) {
      // Resume from last candle + 1 interval
      startMs = latestCandle.openTime + this.timeframeToMs(timeframe);
    } else {
      // Fresh backfill: 1000 candles ago
      startMs = Date.now() - (this.timeframeToMs(timeframe) * 1000);
    }
    
    const endMs = Date.now();
    
    this.logger.info("backfill.start", {
      symbol,
      timeframe,
      fromMs: startMs,
      toMs: endMs,
    });
    
    // Fetch in batches of 500 (Binance limit)
    const BATCH_SIZE = 500;
    let currentStartMs = startMs;
    
    while (currentStartMs < endMs) {
      const candles = await this.provider.fetchCandles({
        symbol,
        timeframe,
        startMs: currentStartMs,
        endMs,
        limit: BATCH_SIZE,
      });
      
      if (candles.length === 0) break;
      
      // Batch insert
      const count = await this.repo.upsertBatch(candles);
      this.logger.info("backfill.batch", {
        symbol,
        timeframe,
        count,
        lastOpenTime: candles[candles.length - 1].openTime,
      });
      
      // Move to next batch
      currentStartMs = candles[candles.length - 1].openTime + this.timeframeToMs(timeframe);
      
      // Rate limit
      await sleep(100);
    }
    
    this.logger.info("backfill.complete", { symbol, timeframe });
  }
}
```

---

### ReconciliationService

**File:** `services/ReconciliationService.ts`

Ensures WebSocket data consistency với REST API data.

**Why Reconciliation?**
- WebSocket có thể miss messages (network hiccup, reconnect gap)
- REST API là source of truth
- Reconciliation fill gaps và fix inconsistencies

```typescript
export class ReconciliationService {
  private intervalHandle: NodeJS.Timeout | null = null;
  
  constructor(
    private readonly provider: MarketDataProvider,     // ✅ Interface dependency
    private readonly repo: CandleRepository,
    private readonly logger: Logger,
  ) {}
  
  startPeriodic(): void {
    // Run every 5 minutes
    this.intervalHandle = setInterval(() => {
      void this.reconcileAll("periodic");
    }, 5 * 60 * 1000);
  }
  
  stopPeriodic(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  
  async reconcileAll(reason: string): Promise<void> {
    this.logger.info("reconciliation.start", { reason });
    
    // Get active streams from provider
    const activeStreams = this.provider.activeStreams();
    
    for (const streamKey of activeStreams) {
      const { symbol, timeframe } = this.parseStreamKey(streamKey);
      await this.reconcileStream(symbol, timeframe);
    }
    
    this.logger.info("reconciliation.complete", { streams: activeStreams.length });
  }
  
  private async reconcileStream(symbol: string, timeframe: Timeframe): Promise<void> {
    // Fetch last 100 candles from REST API (source of truth)
    const restCandles = await this.provider.fetchCandles({
      symbol,
      timeframe,
      limit: 100,
    });
    
    // Fetch from DB
    const dbCandles = await this.repo.query({
      symbol,
      timeframe,
      limit: 100,
    });
    
    // Find missing or different candles
    const restMap = new Map(restCandles.map(c => [c.openTime, c]));
    const dbMap = new Map(dbCandles.map(c => [c.openTime, c]));
    
    const toUpsert: Candle[] = [];
    
    for (const [openTime, restCandle] of restMap) {
      const dbCandle = dbMap.get(openTime);
      
      if (!dbCandle) {
        // Missing in DB
        toUpsert.push(restCandle);
      } else if (this.candlesDiffer(restCandle, dbCandle)) {
        // Different values (DB might have stale data)
        toUpsert.push(restCandle);
      }
    }
    
    if (toUpsert.length > 0) {
      await this.repo.upsertBatch(toUpsert);
      this.logger.warn("reconciliation.fixed", {
        symbol,
        timeframe,
        count: toUpsert.length,
      });
    }
  }
  
  private candlesDiffer(a: Candle, b: Candle): boolean {
    return (
      a.open !== b.open ||
      a.high !== b.high ||
      a.low !== b.low ||
      a.close !== b.close ||
      a.volume !== b.volume
    );
  }
}
```

---

### SocketGateway (Real-time Broadcasting)

**File:** `realtime/SocketGateway.ts`

Broadcast real-time candle updates to Socket.IO clients.

```typescript
export class SocketGateway {
  constructor(
    private readonly provider: MarketDataProvider,     // ✅ Interface dependency
    private readonly service: MarketDataService,
    private readonly logger: Logger,
  ) {
    this.setupEventForwarding();
  }
  
  private setupEventForwarding(): void {
    // Forward provider events to Socket.IO clients
    this.provider.on("candle:closed", (candle: Candle) => {
      socketIO.to(`chart:${candle.symbol}:${candle.timeframe}`).emit("candle:closed", {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        candle,
      });
    });
    
    this.provider.on("candle:updating", (candle: Candle) => {
      socketIO.to(`chart:${candle.symbol}:${candle.timeframe}`).emit("candle:updating", {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        candle,
      });
    });
    
    this.provider.on("status", (status: WsConnectionStatus) => {
      socketIO.emit("ws:status", status);
    });
  }
  
  /**
   * Called when a client subscribes to a chart.
   */
  async handleClientSubscribe(socket: Socket, payload: { symbol: string; timeframe: Timeframe }): Promise<void> {
    const { symbol, timeframe } = payload;
    const room = `chart:${symbol}:${timeframe}`;
    
    // Join Socket.IO room
    await socket.join(room);
    
    // Lazy-subscribe to provider stream (ref-counted)
    await this.service.ensureSubscribed(symbol, timeframe);
    
    this.logger.info("socket.subscribed", { socketId: socket.id, symbol, timeframe });
  }
  
  async handleClientUnsubscribe(socket: Socket, payload: { symbol: string; timeframe: Timeframe }): Promise<void> {
    const { symbol, timeframe } = payload;
    const room = `chart:${symbol}:${timeframe}`;
    
    // Leave Socket.IO room
    await socket.leave(room);
    
    // Check if any other clients are still in this room
    const roomSize = socketIO.sockets.adapter.rooms.get(room)?.size || 0;
    
    if (roomSize === 0) {
      // No more clients - release provider stream
      await this.service.releaseSubscription(symbol, timeframe);
      this.logger.info("socket.unsubscribed.released", { symbol, timeframe });
    }
  }
}
```

---

## HTTP API Routes

**File:** `presentation/market-data.routes.ts`

### GET `/api/market-data/candles`

Fetch historical candles.

**Query params:**
- `symbol` (required): e.g. "BTCUSDT"
- `timeframe` (required): e.g. "1m", "5m", "1h", "1d"
- `limit` (optional): Max candles to return (default: 100)
- `beforeMs` (optional): Fetch candles before this timestamp (for pagination)

**Response:**
```json
{
  "candles": [
    {
      "symbol": "BTCUSDT",
      "timeframe": "1m",
      "openTime": 1725465600000,
      "open": 58123.45,
      "high": 58234.56,
      "low": 58100.00,
      "close": 58200.00,
      "volume": 123.456,
      "closeTime": 1725465659999
    }
  ],
  "hasMore": true
}
```

### GET `/api/market-data/symbols`

Get available trading symbols.

**Response:**
```json
{
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "baseAsset": "BTC",
      "quoteAsset": "USDT",
      "status": "TRADING"
    }
  ]
}
```

### GET `/api/market-data/chart-configs`

Get active chart configurations.

**Response:**
```json
{
  "configs": [
    {
      "chartIndex": 0,
      "symbol": "BTCUSDT",
      "timeframe": "1m",
      "isActive": true
    }
  ]
}
```

### PUT `/api/market-data/chart-configs/:chartIndex`

Update a chart configuration.

**Request body:**
```json
{
  "symbol": "ETHUSDT",
  "timeframe": "5m"
}
```

---

## Socket.IO Events

### Client → Server

#### `chart:subscribe`

Subscribe to real-time candle updates.

```typescript
socket.emit("chart:subscribe", {
  symbol: "BTCUSDT",
  timeframe: "1m"
});
```

#### `chart:unsubscribe`

Unsubscribe from candle updates.

```typescript
socket.emit("chart:unsubscribe", {
  symbol: "BTCUSDT",
  timeframe: "1m"
});
```

### Server → Client

#### `candle:closed`

New candle completed.

```typescript
socket.on("candle:closed", (event) => {
  console.log(event.candle); // { symbol, timeframe, openTime, open, high, low, close, volume }
});
```

#### `candle:updating`

Current candle being updated (real-time tick).

```typescript
socket.on("candle:updating", (event) => {
  console.log(event.candle); // Partial candle (not yet closed)
});
```

#### `ws:status`

WebSocket connection status change.

```typescript
socket.on("ws:status", (status) => {
  console.log(status); // { state: "connected" | "reconnecting" | "disconnected" }
});
```

---

## Container Wiring

**File:** `container.ts`

Dependency injection container setup.

```typescript
export function buildMarketDataContainer(overrides = {}) {
  const logger = overrides.logger ?? rootLogger;
  const prisma = getPrismaClient();
  
  // 🔑 Instantiate provider (swap here to change exchange)
  const provider = new BinanceProvider({ logger });
  
  // Instantiate repository
  const repo = new PostgresCandleRepository(prisma, logger);
  
  // Build services with interfaces (not concrete implementations)
  const backfill = new BackfillService(provider, repo, logger);
  const symbolSync = new SymbolSyncService(prisma, provider, logger);
  const chartSeeder = new DefaultChartSeeder(prisma, logger);
  const reconciliation = new ReconciliationService(provider, repo, logger);
  
  const service = new MarketDataService(
    provider,        // ✅ Interface dependency
    repo,            // ✅ Interface dependency
    reconciliation,
    symbolSync,
    chartSeeder,
    backfill,
    logger,
  );
  
  const socketGateway = new SocketGateway(provider, service, logger);
  const persister = new CandlePersister(repo, logger);
  const router = buildMarketDataRouter({ repo, backfill, logger });
  
  return {
    provider,
    repo,
    service,
    socketGateway,
    persister,
    router,
  };
}
```

**To swap exchange:**
```typescript
// Change from Binance to OKX (future)
const provider = process.env.EXCHANGE_PROVIDER === "okx"
  ? new OkxProvider({ logger })
  : new BinanceProvider({ logger });
```

---

## Testing

### Unit Tests with MockProvider

```typescript
import { MockProvider } from "../providers/mock/MockProvider";
import { MarketDataService } from "../services/MarketDataService";

describe("MarketDataService", () => {
  it("should connect to provider on start", async () => {
    const provider = new MockProvider();
    const connectSpy = jest.spyOn(provider, "connect");
    
    const service = new MarketDataService(
      provider,  // ✅ Easy to mock
      mockRepo,
      mockReconciliation,
      mockSymbolSync,
      mockChartSeeder,
      mockBackfill,
      mockLogger,
    );
    
    await service.start();
    
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});
```

---

## Configuration

### Environment Variables

```bash
# Exchange selection (future)
EXCHANGE_PROVIDER=binance  # or "okx", "bybit"

# WebSocket reconnect
WS_MAX_RECONNECT_DELAY_MS=30000

# Reconciliation interval
RECONCILIATION_INTERVAL_MS=300000  # 5 minutes

# Backfill batch size
BACKFILL_BATCH_SIZE=500

# Database retention
CANDLE_RETENTION_COUNT=1000  # Keep last 1000 candles per symbol+timeframe
```

---

## Performance Considerations

### Ref-counted Subscriptions

Multiple clients subscribing to the same `symbol + timeframe` **share the same WebSocket stream** from Binance.

```typescript
// Client A subscribes → Binance stream starts
await provider.subscribe("BTCUSDT", "1m");  // refCount = 1

// Client B subscribes → Reuses existing stream
await provider.subscribe("BTCUSDT", "1m");  // refCount = 2

// Client A unsubscribes → Stream still active
await provider.unsubscribe("BTCUSDT", "1m");  // refCount = 1

// Client B unsubscribes → Stream closes
await provider.unsubscribe("BTCUSDT", "1m");  // refCount = 0, unsubscribe from Binance
```

### Batch Inserts

Repository uses `upsertBatch()` để insert nhiều candles cùng lúc, reducing DB round-trips.

```typescript
// ❌ Bad: 500 DB queries
for (const candle of candles) {
  await repo.upsert(candle);
}

// ✅ Good: 1 DB query
await repo.upsertBatch(candles);
```

### Rate Limiting

BackfillService adds 100ms delay between batches để avoid hitting Binance rate limits.

---

## Error Handling

### ExternalServiceError

Custom error class cho external service failures (Binance API, WebSocket).

```typescript
try {
  const candles = await provider.fetchCandles({ ... });
} catch (err) {
  if (err instanceof ExternalServiceError) {
    // Log and retry
    logger.error("binance.fetch.failed", { code: err.code, message: err.message });
  }
}
```

### Reconnection Strategy

WebSocket auto-reconnects với exponential backoff:

```typescript
Attempt 1: 1s delay
Attempt 2: 2s delay
Attempt 3: 4s delay
Attempt 4: 8s delay
Attempt 5: 16s delay
Max: 30s delay
```

---

## Future Extensions

### Adding OKX Provider

```typescript
// providers/okx/OkxProvider.ts
export class OkxProvider extends EventEmitter implements MarketDataProvider {
  async fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]> {
    // Call OKX REST API
    const response = await fetch(`https://www.okx.com/api/v5/market/candles?...`);
    const data = await response.json();
    return data.data.map(OkxNormalizer.normalize);
  }
  
  async connect(): Promise<void> {
    // Connect to OKX WebSocket
    this.ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
  }
  
  // ... implement rest of interface
}

// container.ts - Swap provider
const provider = process.env.EXCHANGE_PROVIDER === "okx"
  ? new OkxProvider({ logger })
  : new BinanceProvider({ logger });
```

### Multi-Exchange Aggregation

```typescript
export class MultiExchangeProvider implements MarketDataProvider {
  private providers = new Map<string, MarketDataProvider>();
  
  constructor() {
    this.providers.set("binance", new BinanceProvider(...));
    this.providers.set("okx", new OkxProvider(...));
  }
  
  async fetchCandles(opts: FetchCandlesOptions & { exchange: string }) {
    const provider = this.providers.get(opts.exchange);
    return provider.fetchCandles(opts);
  }
}
```

---

## Troubleshooting

### WebSocket Disconnects Frequently

**Cause:** Network instability, firewall, or Binance maintenance.

**Solution:**
- Check `WS_MAX_RECONNECT_DELAY_MS` config
- Monitor `ws:status` events
- Enable debug logging: `LOG_LEVEL=debug`

### Missing Candles in Database

**Cause:** WebSocket missed messages during reconnect gap.

**Solution:**
- Reconciliation service runs every 5 minutes to fill gaps
- Manually trigger: `POST /api/market-data/reconcile`

### High Memory Usage

**Cause:** Too many candles in memory.

**Solution:**
- Enable database trimming: `CANDLE_RETENTION_COUNT=1000`
- Trim old candles: `POST /api/market-data/trim`

---

## References

- [Binance API Documentation](https://binance-docs.github.io/apidocs/spot/en/)
- [Provider Pattern](https://refactoring.guru/design-patterns/strategy)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)

---

## Change Log

### v2.0 (2026-09-04)
- ✅ Refactored to Provider Pattern
- ✅ Created `MarketDataProvider` and `CandleRepository` interfaces
- ✅ Implemented `BinanceProvider` as unified facade
- ✅ Reorganized folder structure (core, providers, services, realtime, storage)
- ✅ Updated all services to depend on interfaces, not concrete classes
- ✅ Added ref-counted subscription management
- ✅ Fixed frontend parallel candle loading

### v1.0 (2026-09-03)
- Initial implementation with direct Binance coupling
