# Market Data Module Refactoring Plan

**Status:** Proposed  
**Author:** System Design  
**Date:** 2026-09-04  
**Goal:** Decouple market data services from Binance-specific implementations to support multiple exchanges and improve testability.

---

## Current Problems

### Tight Coupling with Binance

```typescript
// ❌ Problem 1: MarketDataService knows concrete Binance classes
class MarketDataService {
  constructor(
    private readonly wsAdapter: BinanceWsAdapter,      // Binance-specific
    private readonly reconciliation: ReconciliationService,
  ) {}
}

// ❌ Problem 2: SocketGateway depends on Binance adapter
class SocketGateway {
  constructor(
    private readonly wsAdapter: BinanceWsAdapter,      // Binance-specific
    private readonly marketData: MarketDataService,
  ) {}
}

// ❌ Problem 3: BackfillService coupled to Binance REST
class BackfillService {
  constructor(
    private readonly restAdapter: BinanceRestAdapter, // Binance-specific
  ) {}
}

// ❌ Problem 4: ReconciliationService uses both adapters
class ReconciliationService {
  constructor(
    private readonly restAdapter: BinanceRestAdapter, // Binance-specific
    private readonly repo: PostgresCandleRepository,
    private readonly wsAdapter: BinanceWsAdapter,     // Binance-specific
  ) {}
}
```

### Impact

1. **Cannot swap exchanges** - Switching to OKX/Bybit/Kraken requires rewriting business logic
2. **Hard to test** - Tests must use real Binance adapters or complex mocks
3. **Violates dependency inversion** - High-level modules depend on low-level implementations
4. **Poor separation of concerns** - Business logic mixed with infrastructure details

---

## Proposed Solution: Provider Pattern

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (MarketDataService, BackfillService, ReconciliationService) │
│                          ↓ uses                              │
│                   MarketDataProvider                         │
│                     (interface)                              │
└─────────────────────────────────────────────────────────────┘
                            ↑ implements
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────────────┐  ┌────────────────┐  ┌──────────────┐
│BinanceProvider│  │  OkxProvider   │  │MockProvider  │
│               │  │   (future)     │  │  (testing)   │
└───────────────┘  └────────────────┘  └──────────────┘
```

### Benefits

✅ **Exchange agnostic** - Swap providers by changing container configuration  
✅ **Testable** - Mock `MarketDataProvider` interface, no Binance dependency  
✅ **SOLID principles** - Depend on abstractions, not implementations  
✅ **Clear boundaries** - Core business logic separated from infrastructure  
✅ **Future-proof** - Easy to add OKX, Bybit, Kraken providers  

---

## New Folder Structure

```
backend/src/modules/market-data/
  ├── core/                           # Core types & interfaces
  │   ├── types.ts                    # Candle, Timeframe, ChartConfig
  │   ├── events.ts                   # CandleClosed, CandleUpdating, WsConnectionStatus
  │   └── ports.ts                    # 🔑 MarketDataProvider, CandleRepository interfaces
  │
  ├── providers/                      # Exchange implementations
  │   ├── binance/
  │   │   ├── BinanceProvider.ts      # Implements MarketDataProvider
  │   │   ├── BinanceRestClient.ts    # Renamed from BinanceRestAdapter
  │   │   ├── BinanceWsClient.ts      # Renamed from BinanceWsAdapter
  │   │   └── BinanceNormalizer.ts    # Renamed from CandleNormalizer
  │   ├── okx/                        # Future: OKX support
  │   │   └── OkxProvider.ts
  │   └── mock/                       # For testing
  │       └── MockProvider.ts
  │
  ├── services/                       # Business logic (provider-agnostic)
  │   ├── MarketDataService.ts        # Orchestrates market data operations
  │   ├── BackfillService.ts          # Historical data backfill
  │   ├── ReconciliationService.ts    # Sync WS with REST
  │   └── SymbolSyncService.ts        # Sync exchange symbols to DB
  │
  ├── realtime/                       # Socket.IO layer
  │   ├── SocketGateway.ts            # Socket.IO event gateway
  │   ├── CandlePersister.ts          # Persist real-time candles
  │   └── HeartbeatMonitor.ts         # WS heartbeat monitoring
  │
  ├── storage/                        # Persistence layer
  │   ├── CandleRepository.ts         # Repository interface
  │   └── PostgresRepository.ts       # Postgres implementation
  │
  ├── routes.ts                       # HTTP routes
  └── container.ts                    # DI container
```

---

## Core Interfaces

### 1. MarketDataProvider Interface

**File:** `core/ports.ts`

```typescript
import type { Candle } from "./types";
import type { Timeframe } from "./types";
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
   * Fetch available trading symbols from exchange.
   * @returns Array of symbols with metadata
   */
  fetchSymbols(): Promise<ExchangeSymbol[]>;
  
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
  on(event: "candle:closed", listener: (c: Candle) => void): void;
  
  /**
   * Listen for updating candle events (candle in progress).
   */
  on(event: "candle:updating", listener: (c: Candle) => void): void;
  
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
   * @returns Array of stream keys (e.g. ["btcusdt@kline_1m", "ethusdt@kline_5m"])
   */
  activeStreams(): string[];
}

export interface FetchCandlesOptions {
  symbol: string;
  timeframe: Timeframe;
  startMs?: number;       // Inclusive start timestamp
  endMs?: number;         // Inclusive end timestamp
  limit?: number;         // Max candles to return
}

export interface ExchangeSymbol {
  symbol: string;         // e.g. "BTCUSDT"
  baseAsset: string;      // e.g. "BTC"
  quoteAsset: string;     // e.g. "USDT"
  status: string;         // e.g. "TRADING"
  isSpotTradingAllowed?: boolean;
}
```

### 2. CandleRepository Interface

**⚠️ IMPORTANT:** Use existing interface from `domain/CandleRepository.port.ts`

```typescript
export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

/**
 * Repository interface for candle persistence.
 * ✅ This matches the EXISTING implementation in PostgresCandleRepository
 */
export interface CandleRepository {
  /**
   * Insert or update a single candle.
   */
  upsert(candle: Candle): Promise<void>;
  
  /**
   * Bulk insert or update candles.
   * @returns Number of candles affected
   */
  upsertBatch(candles: Candle[]): Promise<number>;  // ✅ Actual method name
  
  /**
   * Query candles with flexible filters.
   * @returns Array of candles, ordered by openTime ASC
   */
  query(q: CandleQuery): Promise<Candle[]>;  // ✅ Actual method name
  
  /**
   * Find the most recent candle for a symbol+timeframe.
   */
  getLatestOpen(symbol: string, timeframe: Timeframe): Promise<Candle | null>;  // ✅ Actual method name
  
  /**
   * Delete all candles (used for cleanup on restart).
   */
  deleteAll(): Promise<void>;  // ✅ Already exists
  
  /**
   * Keep only the newest N candles and delete the rest.
   * @returns Number of rows deleted
   */
  trimToLatest(symbol: string, timeframe: Timeframe, keepCount: number): Promise<number>;  // ✅ Already exists
}
```

---

## Implementation Details

### BinanceProvider (Unified Facade)

**File:** `providers/binance/BinanceProvider.ts`

```typescript
import { EventEmitter } from "events";
import type { MarketDataProvider, FetchCandlesOptions } from "../../core/ports";
import type { Candle } from "../../core/types";
import type { Timeframe } from "../../core/types";
import { BinanceRestClient } from "./BinanceRestClient";
import { BinanceWsClient } from "./BinanceWsClient";
import type { Logger } from "../../../../shared/logger/logger";

/**
 * Binance implementation of MarketDataProvider.
 * 
 * Composes BinanceRestClient (historical data) and BinanceWsClient (real-time streams).
 * Normalizes Binance-specific event names to provider-agnostic names.
 */
export class BinanceProvider extends EventEmitter implements MarketDataProvider {
  private rest: BinanceRestClient;
  private ws: BinanceWsClient;
  
  constructor(config: { logger: Logger }) {
    super();
    this.rest = new BinanceRestClient(config);
    this.ws = new BinanceWsClient(config);
    
    // Forward WebSocket events with normalized names
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
  
  // ===== REST Delegation =====
  async fetchCandles(opts: FetchCandlesOptions): Promise<Candle[]> {
    return this.rest.fetchKlines(opts);
  }
  
  async fetchSymbols() {
    return this.rest.fetchExchangeInfo();
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
```

### MarketDataService (Refactored)

**File:** `services/MarketDataService.ts`

```typescript
import type { MarketDataProvider } from "../core/ports";
import type { CandleRepository } from "../core/ports";
import type { Timeframe } from "../core/types";
import type { Logger } from "../../../shared/logger/logger";

export class MarketDataService {
  constructor(
    private readonly provider: MarketDataProvider,     // ✅ Interface, not concrete class
    private readonly repo: CandleRepository,            // ✅ Interface
    private readonly reconciliation: ReconciliationService,
    private readonly symbolSync: SymbolSyncService,
    private readonly chartSeeder: DefaultChartSeeder,
    private readonly backfill: BackfillService,
    private readonly logger: Logger,
  ) {}
  
  async start() {
    this.logger.info("market-data.start");
    
    // Connect to exchange WebSocket
    await this.provider.connect();
    
    // Sync symbols from exchange
    const symbols = await this.symbolSync.syncSymbols();
    
    // Seed default charts if empty
    const defaults = await this.chartSeeder.seedIfEmpty();
    
    // Load active chart configs
    const chartConfigs = await this.loadActiveChartConfigs();
    
    // Backfill historical data for each chart
    for (const chart of chartConfigs) {
      await this.backfill.backfillChart(chart);
    }
    
    // Wire events
    this.provider.on("status", this.handleStatus.bind(this));
    this.provider.on("candle:closed", this.handleCandleClosed.bind(this));
    
    // Subscribe to real-time streams
    for (const chart of chartConfigs) {
      await this.provider.subscribe(chart.symbol, chart.timeframe);
    }
    
    // Start periodic reconciliation
    this.reconciliation.startPeriodic();
    
    return { symbols, defaults, chartConfigs };
  }
  
  async stop() {
    this.reconciliation.stopPeriodic();
    await this.provider.disconnect();
  }
  
  /**
   * Lazy subscribe for dynamic client subscriptions (via SocketGateway).
   */
  async ensureSubscribed(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.provider.subscribe(symbol, timeframe);
  }
  
  async releaseSubscription(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.provider.unsubscribe(symbol, timeframe);
  }
  
  private handleStatus(status: WsConnectionStatus): void {
    if (status.state === "reconnecting") {
      // Handle reconnection...
    }
    if (status.state === "connected") {
      void this.reconciliation.reconcileAll("reconnect");
    }
  }
  
  private handleCandleClosed(candle: Candle): void {
    // Handle closed candle event...
  }
}
```

### Container Wiring

**File:** `container.ts`

```typescript
import { BinanceProvider } from "./providers/binance/BinanceProvider";
import { PostgresRepository } from "./storage/PostgresRepository";
import { MarketDataService } from "./services/MarketDataService";
import { BackfillService } from "./services/BackfillService";
import { ReconciliationService } from "./services/ReconciliationService";
import { SymbolSyncService } from "./services/SymbolSyncService";
import { SocketGateway } from "./realtime/SocketGateway";
import { CandlePersister } from "./realtime/CandlePersister";

export function buildMarketDataContainer(overrides = {}) {
  const logger = overrides.logger ?? rootLogger;
  const prisma = getPrismaClient();
  
  // 🔑 Instantiate provider (swap to OkxProvider here if needed)
  const provider = new BinanceProvider({ logger });
  
  // Instantiate repository
  const repo = new PostgresRepository(prisma, logger);
  
  // Build services with interfaces
  const backfill = new BackfillService(
    provider,  // ✅ Pass interface
    repo,
    logger,
  );
  
  const symbolSync = new SymbolSyncService(
    prisma,
    provider,  // ✅ Pass interface
    logger,
  );
  
  const chartSeeder = new DefaultChartSeeder(prisma, logger);
  
  const reconciliation = new ReconciliationService(
    provider,  // ✅ Pass interface
    repo,
    logger,
  );
  
  const service = new MarketDataService(
    provider,        // ✅ Pass interface
    repo,            // ✅ Pass interface
    reconciliation,
    symbolSync,
    chartSeeder,
    backfill,
    logger,
  );
  
  const socketGateway = new SocketGateway(
    provider,  // ✅ Pass interface
    service,
  );
  
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

---

## Migration Plan

### Phase 1: Extract Interfaces (No Breaking Changes)

**Goal:** Create interfaces without modifying existing code.

**Tasks:**
- [ ] Create `core/types.ts` - Move `Candle`, `Timeframe`, `ChartConfig` types
- [ ] Create `core/events.ts` - Move event types (`WsConnectionStatus`, etc.)
- [ ] Create `core/ports.ts` - Define `MarketDataProvider` and `CandleRepository` interfaces
- [ ] Verify existing code still compiles

**Files to create:**
- `core/types.ts`
- `core/events.ts`
- `core/ports.ts`

**Impact:** Zero - No existing code changes

---

### Phase 2: Create BinanceProvider Wrapper

**Goal:** Implement provider interface without changing consumers.

**Tasks:**
- [ ] Create `providers/binance/` folder
- [ ] Move `BinanceRestAdapter.ts` → `providers/binance/BinanceRestClient.ts`
- [ ] Move `BinanceWsAdapter.ts` → `providers/binance/BinanceWsClient.ts`
- [ ] Move `CandleNormalizer.ts` → `providers/binance/BinanceNormalizer.ts`
- [ ] Create `providers/binance/BinanceProvider.ts` that wraps REST + WS clients
- [ ] Update exports in `index.ts` to expose both old and new APIs (compatibility layer)

**Files to create:**
- `providers/binance/BinanceProvider.ts`
- `providers/binance/BinanceRestClient.ts` (renamed)
- `providers/binance/BinanceWsClient.ts` (renamed)
- `providers/binance/BinanceNormalizer.ts` (renamed)

**Compatibility layer:**
```typescript
// index.ts - Temporary re-exports
export { BinanceRestAdapter } from "./infrastructure/BinanceRestAdapter"; // Deprecated
export { BinanceWsAdapter } from "./infrastructure/BinanceWsAdapter";     // Deprecated
export { BinanceProvider } from "./providers/binance/BinanceProvider";     // New
```

**Impact:** Low - Existing imports still work

---

### Phase 3: Refactor Services to Use Interfaces

**Goal:** Update business logic to depend on interfaces.

**Tasks:**
- [ ] Update `MarketDataService` constructor to accept `MarketDataProvider` interface
- [ ] Update `BackfillService` constructor to accept `MarketDataProvider` interface
- [ ] Update `ReconciliationService` constructor to accept `MarketDataProvider` interface
- [ ] Update `SymbolSyncService` constructor to accept `MarketDataProvider` interface
- [ ] Update `SocketGateway` constructor to accept `MarketDataProvider` interface
- [ ] Change event names from `"CandleClosed"` → `"candle:closed"`, `"CandleUpdating"` → `"candle:updating"`

**Files to modify:**
- `services/MarketDataService.ts`
- `services/BackfillService.ts`
- `services/ReconciliationService.ts`
- `services/SymbolSyncService.ts`
- `realtime/SocketGateway.ts`

**Impact:** Medium - Requires updating service constructors

---

### Phase 4: Extract Repository Interface

**Goal:** Decouple services from Postgres implementation.

**Tasks:**
- [ ] Create `storage/CandleRepository.ts` interface
- [ ] Move `PostgresCandleRepository.ts` → `storage/PostgresRepository.ts`
- [ ] Implement `CandleRepository` interface in `PostgresRepository`
- [ ] Update all services to accept `CandleRepository` interface

**Files to create:**
- `storage/CandleRepository.ts`
- `storage/PostgresRepository.ts` (renamed)

**Impact:** Medium - Requires updating service constructors

---

### Phase 5: Update Container Wiring

**Goal:** Wire dependencies using interfaces in DI container.

**Tasks:**
- [ ] Update `buildMarketDataContainer()` to instantiate `BinanceProvider`
- [ ] Pass `provider` interface to all services (not concrete adapters)
- [ ] Pass `repo` interface to all services (not concrete repository)
- [ ] Remove old adapter references from container return type

**Files to modify:**
- `container.ts`

**Impact:** High - Changes how dependencies are wired

---

### Phase 6: Reorganize Folder Structure

**Goal:** Move files to new locations.

**Tasks:**
- [ ] Create folder structure: `core/`, `providers/`, `services/`, `realtime/`, `storage/`
- [ ] Move `application/*.ts` → `services/`
- [ ] Move `infrastructure/Postgres*` → `storage/`
- [ ] Move `infrastructure/Binance*` → `providers/binance/`
- [ ] Update all import paths
- [ ] Delete empty `application/` and `infrastructure/` folders

**Impact:** High - Changes all import paths

---

### Phase 7: Remove Compatibility Layer

**Goal:** Remove deprecated exports and old adapters.

**Tasks:**
- [ ] Remove `BinanceRestAdapter` and `BinanceWsAdapter` re-exports from `index.ts`
- [ ] Verify no external modules import deprecated adapters
- [ ] Update documentation to reference `BinanceProvider`

**Impact:** High - Breaking change for external consumers

---

### Phase 8: Add Mock Provider for Testing

**Goal:** Create test-friendly mock provider.

**Tasks:**
- [ ] Create `providers/mock/MockProvider.ts`
- [ ] Implement `MarketDataProvider` interface with in-memory behavior
- [ ] Write example test using `MockProvider`
- [ ] Document usage in test files

**Files to create:**
- `providers/mock/MockProvider.ts`
- `tests/mock-provider.example.test.ts`

**Impact:** Low - Testing improvement

---

## Testing Strategy

### Unit Tests with MockProvider

```typescript
// tests/services/MarketDataService.test.ts
import { MockProvider } from "../../providers/mock/MockProvider";
import { MarketDataService } from "../../services/MarketDataService";

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

### Integration Tests with Real Provider

```typescript
// tests/integration/BinanceProvider.integration.test.ts
import { BinanceProvider } from "../../providers/binance/BinanceProvider";

describe("BinanceProvider Integration", () => {
  it("should fetch real candles from Binance", async () => {
    const provider = new BinanceProvider({ logger: testLogger });
    
    const candles = await provider.fetchCandles({
      symbol: "BTCUSDT",
      timeframe: "1m",
      limit: 10,
    });
    
    expect(candles).toHaveLength(10);
    expect(candles[0]).toHaveProperty("open");
    expect(candles[0]).toHaveProperty("high");
  });
});
```

---

## Future Extensions

### Adding OKX Provider

```typescript
// providers/okx/OkxProvider.ts
import { EventEmitter } from "events";
import type { MarketDataProvider } from "../../core/ports";

export class OkxProvider extends EventEmitter implements MarketDataProvider {
  // Implement interface using OKX API
  async fetchCandles(opts) {
    // Call OKX REST API
  }
  
  async connect() {
    // Connect to OKX WebSocket
  }
  
  // ... rest of interface
}

// container.ts - Swap provider via config
const providerType = process.env.EXCHANGE_PROVIDER || "binance";

const provider = providerType === "okx"
  ? new OkxProvider({ logger })
  : new BinanceProvider({ logger });
```

### Multi-Exchange Support

```typescript
// providers/MultiExchangeProvider.ts
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

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Breaking existing tests** | High | High | Run full test suite after each phase |
| **Import path errors** | Medium | High | Use TypeScript compiler to catch errors |
| **Event name mismatch** | Medium | Medium | Add compatibility layer during transition |
| **Performance regression** | Low | Medium | Benchmark before/after |
| **Incomplete migration** | Medium | High | Follow phased migration plan strictly |

---

## Success Criteria

✅ All services depend on `MarketDataProvider` interface, not `BinanceWsAdapter`  
✅ Tests can use `MockProvider` without real Binance connection  
✅ Container can swap providers via single line change  
✅ No breaking changes to HTTP API or Socket.IO events  
✅ Existing tests pass without modification (Phase 1-2)  
✅ New folder structure matches design:
  - `core/` - Types & interfaces
  - `providers/binance/` - Binance implementation
  - `services/` - Business logic
  - `realtime/` - Socket.IO layer
  - `storage/` - Database layer

---

## Open Questions

1. **Event naming convention:** Use `"candle:closed"` or `"candle.closed"` or keep `"CandleClosed"`?
   - **Decision:** Use `"candle:closed"` (colon separator is common in event-driven systems)

2. **Provider configuration:** Environment variable vs constructor config?
   - **Decision:** Container responsibility - use env var in container, pass to provider via constructor

3. **Backward compatibility:** Keep old `BinanceWsAdapter` exports for how long?
   - **Decision:** 1 release cycle with deprecation warnings, then remove

4. **Repository interface:** Should it include retention policy methods?
   - **Decision:** Yes - Add `deleteOlderThan(timestamp)` to interface

5. **Multi-provider routing:** Should `MarketDataService` support multiple exchanges simultaneously?
   - **Decision:** Not in initial refactor - Single provider per service instance

---

## Timeline Estimate

| Phase | Estimated Time | Risk |
|-------|---------------|------|
| Phase 1: Extract interfaces | 2 hours | Low |
| Phase 2: Create BinanceProvider | 4 hours | Medium |
| Phase 3: Refactor services | 6 hours | High |
| Phase 4: Extract repository | 3 hours | Medium |
| Phase 5: Update container | 2 hours | High |
| Phase 6: Reorganize folders | 3 hours | Medium |
| Phase 7: Remove compatibility | 1 hour | Low |
| Phase 8: Add MockProvider | 3 hours | Low |
| **Total** | **24 hours** | |

---

## References

- **Dependency Inversion Principle:** https://en.wikipedia.org/wiki/Dependency_inversion_principle
- **Provider Pattern:** Similar to Strategy Pattern - https://refactoring.guru/design-patterns/strategy
- **Hexagonal Architecture:** https://alistair.cockburn.us/hexagonal-architecture/
- **Repository Pattern:** https://martinfowler.com/eaaCatalog/repository.html

---

**Next Steps:**
1. Review this plan with team
2. Get approval for Phase 1-2 (low-risk, no breaking changes)
3. Create feature branch: `refactor/market-data-provider-pattern`
4. Start Phase 1 implementation
