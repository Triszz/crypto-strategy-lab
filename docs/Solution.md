# Crypto Strategy Lab — Architecture Solution & Data Pipeline

**Version:** 1.0
**Team:** Trí (Leader), Bảo, Huy, Nhân
**Status:** Draft (Tuần 1 — Design Complete)

---

## 1. Architectural Goals & Constraints

### 1.1 Drivers (từ Requirements Spec)

| Driver          | Stakeholder Need                                                        | Architectural Consequence                                |
| --------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Modifiability   | Thêm strategy, indicator, exchange, news provider không sửa module khác | Plugin Registry, Adapter Pattern, Strategy Pattern       |
| Scalability     | Search/backtest mở rộng theo chiều ngang                                | Queue-based (BullMQ), event-driven decoupling            |
| Realtime        | Cập nhật candle, leaderboard, search progress tức thời                  | Socket.IO + EventBus nội bộ                              |
| Reliability     | Binance mất kết nối, worker chết không kéo sập hệ thống                 | Reconnect + backoff, isolation, retry, idempotent upsert |
| Observability   | Trader biết search/backtest/queue đang chạy                             | Worker status, search progress, system logs              |
| Reproducibility | Chạy lại experiment y hệt kết quả cũ                                    | Strategy versioning, immutable experiment                |

### 1.2 Architectural Style

* **Layered Architecture** (Presentation → Application → Domain → Infrastructure)
* **Modular Monolith** (1 backend, tách module rõ ràng) → dễ nâng cấp microservices sau
* **Event-Driven** giữa các module
* **Plugin Architecture** cho Strategy & Provider

---

## 2. System Context (C4 Level 1)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM CONTEXT DIAGRAM                          │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │      Trader      │
                    │   (Browser SPA)  │
                    └────────┬─────────┘
                             │ HTTPS / WSS
                             ▼
              ┌──────────────────────────────┐
              │                              │
              │      CRYPTO STRATEGY LAB     │
              │   (React + Node.js Backend)  │
              │                              │
              └──────┬───────────┬───────────┘
                     │           │
        ┌────────────┘           └────────────┐
        ▼                                     ▼

┌──────────────────┐                 ┌──────────────────┐
│   Binance API    │                 │ CryptoPanic API  │
│ REST + WebSocket │                 │      (News)      │
└──────────────────┘                 └──────────────────┘
        │                                     │
        └──────────────┬──────────────────────┘
                       ▼
              ┌──────────────────┐
              │    Gemini API    │
              │  (Sentiment AI)  │
              └──────────────────┘
```

---

## 3. Container Diagram (C4 Level 2)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           CONTAINER DIAGRAM                             │
└─────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────┐       ┌───────────────────────────┐
│      FRONTEND (React)     │       │      BACKEND (Node.js)    │
│                           │       │                           │
│ • Dashboard Shell         │       │ ┌───────────────────────┐ │
│ • MultiChart (4 pane)     │◀═REST═▶│ │      REST API        │ │
│ • Strategy Selector       │       │ │       (Express)       │ │
│ • Backtest UI             │◀═WSS═▶│ └───────────────────────┘ │
│ • Leaderboard             │       │                           │
│ • News/Sentiment          │       │ ┌───────────────────────┐ │
│ • Experiment History      │       │ │   Socket.IO Gateway   │ │
└───────────────────────────┘       │ └───────────────────────┘ │
                                    │                           │
                                    │ ┌───────────────────────┐ │
                                    │ │     BullMQ Workers    │ │
                                    │ │       (Backtest)      │ │
                                    │ └───────────────────────┘ │
                                    │                           │
                                    │ ┌───────────────────────┐ │
                                    │ │       Event Bus        │ │
                                    │ │  (Node EventEmitter)   │ │
                                    │ └───────────────────────┘ │
                                    └─────────────┬─────────────┘
                                                  │
                         ┌────────────────────────┼────────────────────────┐
                         ▼                        ▼                        ▼
                  ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
                  │  PostgreSQL  │        │    Redis     │        │   External   │
                  │  (Supabase)  │        │   (BullMQ)   │        │     APIs     │
                  │              │        │              │        │              │
                  │ • Candles    │        │ • Job Queue  │        │ • Binance    │
                  │ • Strategies │        │ • Cache      │        │ • CryptoPanic│
                  │ • Backtests  │        │              │        │ • Gemini     │
                  │ • News       │        │              │        │              │
                  └──────────────┘        └──────────────┘        └──────────────┘
```

---

## 4. Module Decomposition (Backend)

```text
backend/
└── src/
    ├── shared/                         ← Cross-cutting concerns
    │   ├── event-bus/                  ← In-process pub/sub
    │   ├── logger/                     ← Pino structured logger
    │   ├── errors/                     ← Domain error types
    │   └── types/                      ← Shared TS interfaces
    │
    ├── modules/
    │   ├── market-data/                ← Bảo
    │   │   ├── domain/
    │   │   │   ├── Candle.ts
    │   │   │   ├── Timeframe.ts
    │   │   │   └── CandleRepository.port.ts
    │   │   ├── adapters/
    │   │   │   ├── BinanceRestAdapter.ts
    │   │   │   ├── BinanceWsAdapter.ts
    │   │   │   └── CandleNormalizer.ts
    │   │   ├── realtime/
    │   │   │   ├── ReconnectStrategy.ts
    │   │   │   ├── HeartbeatMonitor.ts
    │   │   │   └── SocketGateway.ts
    │   │   └── application/
    │   │       ├── MarketDataService.ts
    │   │       └── BackfillUseCase.ts
    │   │
    │   ├── strategy/                   ← Trí
    │   │   ├── domain/
    │   │   │   ├── Strategy.ts          ← interface
    │   │   │   ├── Signal.ts
    │   │   │   ├── StrategyContext.ts
    │   │   │   └── StrategyRegistry.ts  ← Plugin Registry
    │   │   ├── strategies/
    │   │   │   ├── MovingAverageStrategy.ts
    │   │   │   ├── RsiStrategy.ts
    │   │   │   ├── BollingerStrategy.ts
    │   │   │   └── SupportResistanceStrategy.ts
    │   │   ├── combination/
    │   │   │   ├── CombinationEngine.ts
    │   │   │   └── WeightedCombiner.ts
    │   │   └── application/
    │   │       └── StrategyService.ts
    │   │
    │   ├── search/                     ← Trí
    │   │   ├── domain/
    │   │   │   ├── StrategyGenerator.ts ← interface
    │   │   │   ├── SearchController.ts
    │   │   │   └── StopCondition.ts
    │   │   ├── generators/
    │   │   │   ├── RandomGenerator.ts
    │   │   │   └── DomainGuidedGenerator.ts
    │   │   └── application/
    │   │       └── SearchService.ts
    │   │
    │   ├── backtest/                   ← Huy
    │   │   ├── domain/
    │   │   │   ├── Backtester.ts
    │   │   │   ├── Trade.ts
    │   │   │   └── Position.ts
    │   │   ├── application/
    │   │   │   ├── BacktestService.ts
    │   │   │   ├── BacktestJob.ts
    │   │   │   └── BacktestWorker.ts
    │   │   └── queue/
    │   │       └── BacktestQueue.ts
    │   │
    │   ├── evaluation/                 ← Nhân
    │   │   ├── domain/
    │   │   │   ├── Evaluator.ts
    │   │   │   └── Metrics.ts
    │   │   ├── metrics/
    │   │   │   ├── TotalReturn.ts
    │   │   │   ├── WinRate.ts
    │   │   │   ├── MaxDrawdown.ts
    │   │   │   └── OverallScore.ts
    │   │   └── application/
    │   │       └── EvaluationService.ts
    │   │
    │   ├── leaderboard/                ← Nhân
    │   │   ├── domain/
    │   │   │   └── Leaderboard.ts
    │   │   └── application/
    │   │       └── LeaderboardService.ts
    │   │
    │   ├── news/                       ← Nhân
    │   │   ├── domain/
    │   │   │   ├── NewsProvider.ts      ← interface
    │   │   │   └── NewsItem.ts
    │   │   ├── adapters/
    │   │   │   ├── CryptoPanicAdapter.ts
    │   │   │   └── NewsNormalizer.ts
    │   │   └── application/
    │   │       └── NewsCollectorService.ts
    │   │
    │   └── sentiment/                  ← Nhân
    │       ├── domain/
    │       │   ├── SentimentAnalyzer.ts ← interface
    │       │   └── SentimentResult.ts
    │       ├── adapters/
    │       │   └── GeminiAnalyzer.ts
    │       └── application/
    │           └── SentimentService.ts
    │
    └── api/                            ← Express routes
        ├── routes/
        │   ├── candles.routes.ts
        │   ├── strategies.routes.ts
        │   ├── search.routes.ts
        │   ├── backtest.routes.ts
        │   ├── leaderboard.routes.ts
        │   ├── experiments.routes.ts
        │   └── news.routes.ts
        └── middleware/
            ├── error-handler.ts
            └── request-logger.ts
```

---

## 5. Component Diagram — Strategy Engine (C4 Level 3)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    STRATEGY ENGINE COMPONENT DIAGRAM                    │
└─────────────────────────────────────────────────────────────────────────┘

          ┌───────────────────┐
          │  SearchController │
          │    (loop + stop)  │
          └─────────┬─────────┘
                    │ enqueue
                    ▼
          ┌───────────────────┐
          │   BullMQ Queue    │
          │  (backtest queue) │
          └─────────┬─────────┘
                    │ dispatch
                    ▼
          ┌───────────────────┐
          │   BacktestWorker  │
          │    (picks job)    │
          └─────────┬─────────┘
                    │ calls
                    ▼
          ┌───────────────────┐
          │   Combination     │
          │      Engine       │
          │   weighted vote   │
          └─────────┬─────────┘
                    │ invokes
                    ▼
          ┌───────────────────┐
          │  StrategyRegistry │
          │   lookup plugin   │
          └─────────┬─────────┘
                    │ delegate
        ┌───────────┼───────────┐
        ▼           ▼           ▼

   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │    MA    │ │   RSI    │ │ Bollinger│
   │ Strategy │ │ Strategy │ │ Strategy │
   └──────────┘ └──────────┘ └──────────┘
        │           │           │
        └───────────┴───────────┘
                    │
                    │ return Signal
                    ▼
          ┌───────────────────┐
          │    Backtester     │
          │    (simulates)    │
          └─────────┬─────────┘
                    │
                    │ emits "BacktestCompleted"
                    ▼
               [Event Bus]
```

---

## 6. Core Design Patterns

| Pattern                  | Applied To                                               | Benefit                              |
| ------------------------ | -------------------------------------------------------- | ------------------------------------ |
| **Strategy Pattern**     | `Strategy` interface + implementations                   | Pluggable strategy, hot-swap         |
| **Registry Pattern**     | `StrategyRegistry`                                       | Add strategy without changing engine |
| **Adapter Pattern**      | `BinanceAdapter`, `CryptoPanicAdapter`, `GeminiAnalyzer` | Vendor isolation                     |
| **Producer/Consumer**    | `BinanceWsAdapter` → EventBus → `SocketGateway`          | Decouple data source from consumers  |
| **Job Queue / Worker**   | BullMQ + BacktestWorker                                  | Horizontal scalability, isolation    |
| **Observer / Event Bus** | In-process Node EventEmitter                             | Low coupling between modules         |
| **Repository**           | `CandleRepository`, `StrategyRepository`                 | Testability, swap data source        |
| **Dependency Injection** | `container.ts` per module                                | Loose coupling, easy testing         |
| **Composite**            | `CompositeStrategy` combines base strategies             | Tree of strategies                   |
| **Factory**              | `StrategyFactory.fromConfig()`                           | Strategy instantiation from spec     |

---

## 7. Event Catalog (In-process + Realtime)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                            EVENT CATALOG                                │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────────────┬─────────────────────────┬──────────────────────┐
│ Event Name             │ Publisher               │ Subscribers          │
├────────────────────────┼─────────────────────────┼──────────────────────┤
│ CandleClosed           │ market-data             │ Frontend (WSS), DB   │
│ CandleUpdating         │ market-data (internal)  │ optional UI tick     │
│ StrategyGenerated      │ search                  │ queue producer       │
│ SearchStarted          │ search                  │ FE status            │
│ SearchProgress         │ search                  │ FE status            │
│ SearchStopped          │ search                  │ FE status            │
│ SearchCompleted        │ search                  │ FE status            │
│ BacktestQueued         │ search                  │ FE status            │
│ BacktestStarted        │ backtest worker        │ FE status            │
│ BacktestCompleted      │ backtest worker        │ evaluator, FE         │
│ BacktestFailed         │ backtest worker        │ FE error              │
│ StrategyEvaluated      │ evaluation              │ leaderboard, FE      │
│ LeaderboardUpdated     │ leaderboard             │ FE                   │
│ NewsCollected          │ news                    │ sentiment, FE        │
│ SentimentAnalyzed      │ sentiment               │ FE                   │
│ WorkerStatusChanged    │ workers                 │ FE status dashboard   │
└────────────────────────┴─────────────────────────┴──────────────────────┘

Payload convention (WebSocket):

{
  "event": "CandleClosed",
  "version": "1.0",
  "timestamp": 1700000060000,
  "payload": {
    /* event-specific */
  }
}
```

---

## 8. Data Pipeline — End-to-End Flow

### 8.1 Pipeline Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                     DATA PIPELINE (4 MAIN FLOWS)                        │
└─────────────────────────────────────────────────────────────────────────┘

(1) REALTIME MARKET DATA
<!-- 
Binance WebSocket
       │
       ▼
 WebSocket Client
       │
       ├── Connected ──────► Receive candles
       │                         │
       │                         ▼
       │                    Store/Process
       │
       └── Disconnected
              │
              ▼
        Exponential Backoff
              │
              ▼
           Reconnect
              │
              ▼
       REST API Backfill
              │
              ▼
       Missing candles?
          │         │
         Yes        No
          │         │
          ▼         ▼
       Insert    Continue WS
          │
          └──────────┘ -->

Binance WS
    │
    ▼
BinanceWsAdapter
    │
    ▼
CandleNormalizer
    │
    ▼
CandleRepository
    │
    └──▶ EventBus.publish("CandleClosed")
              │
              ▼
        SocketGateway.broadcast
              │
              ▼
           Frontend


(2) STRATEGY COMBINATION

Frontend (config)
    │
    ▼
POST /strategies
    │
    ▼
CombinationEngine
    │
    ▼
WeightedCombiner
    │
    ▼
StrategyRegistry.resolve
    │
    ▼
persist StrategyVersion


(3) SEARCH / BACKTEST LOOP

Frontend
    │
    ▼
POST /search/start
    │
    ▼
SearchService.createRun
    │
    ▼
StrategyGenerator
    │
    ├──▶ emit("StrategyGenerated")
    │
    ▼
BullMQ: backtest queue
    │
    ▼
BacktestWorker.process
    │
    ▼
Strategy.analyze(ctx) on each candle
    │
    ▼
simulate trades
    │
    ▼
persist Experiment + Trades + Result
    │
    ▼
emit("BacktestCompleted")
    │
    ▼
EvaluationWorker
    │
    ▼
Evaluator.calculate(trades)
    │
    ▼
persist BacktestResult
    │
    ▼
emit("StrategyEvaluated")
    │
    ▼
LeaderboardService
    │
    ├──▶ recompute top-K
    ├──▶ upsert LeaderboardEntry
    └──▶ emit("LeaderboardUpdated")
              │
              ▼
           Frontend


(4) NEWS / SENTIMENT FLOW

Cron (every 5 min)
    │
    ▼
NewsCollectorService
    │
    ▼
CryptoPanicAdapter.fetch()
    │
    ▼
NewsNormalizer.toItem()
    │
    ▼
NewsRepository.upsert
(dedupe by external_id)
    │
    ▼
emit("NewsCollected")
    │
    ▼
SentimentService
    │
    ▼
GeminiAnalyzer.analyze(title + summary)
    │
    ▼
persist Sentiment
    │
    ▼
emit("SentimentAnalyzed")
```

### 8.2 Sequence: Search → Backtest → Leaderboard

```text
Trader Frontend SearchSvc BullMQ BacktestWorker Evaluator Leaderboard DB
     │          │          │          │             │          │        │
     │          │          │          │             │          │        │
     │ start    │          │          │             │          │        │
     │─────────▶│          │          │             │          │        │
     │          │ POST     │          │             │          │        │
     │          │ /search/ │          │             │          │        │
     │          │ start    │          │             │          │        │
     │          │─────────▶│          │             │          │        │
     │          │          │ create   │             │          │        │
     │          │          │ Run      │             │          │        │
     │          │          │──────────┼────────────────────────────────▶│
     │◀───────── WS: SearchStarted   │             │          │        │
     │          │          │          │             │          │        │
     │          │          │ generate candidate    │          │        │
     │          │          │─────────▶│             │          │        │
     │          │          │          │             │          │        │
     │          │          │ enqueue job           │          │        │
     │          │          │─────────▶│             │          │        │
     │          │          │          │ runBacktest │          │        │
     │          │          │          │────────────▶│          │        │
     │          │          │          │             │          │        │
     │          │          │          │             │ calculate│        │
     │          │          │          │             │─────────▶│        │
     │          │          │          │             │◀─────────│        │
     │          │          │          │             │          │        │
     │          │          │          │             │ persist Experiment
     │          │          │          │             │──────────────────▶│
     │          │          │          │             │          │        │
     │          │          │          │ emit BacktestCompleted          │
     │          │          │          │─────────────┼─────────▶│        │
     │          │          │          │             │          │        │
     │          │          │          │             │ StrategyEvaluated
     │          │          │          │             │─────────▶│        │
     │          │          │          │             │          │ upsert │
     │          │          │          │             │          │────────▶│
     │          │          │          │             │          │        │
     │◀───────── LeaderboardUpdated (WS)            │          │        │
     │          │          │          │             │          │        │
     │          │          │ generate candidate N...│          │        │
     │          │          │          │             │          │        │
     │◀───────── SearchCompleted    │             │          │        │
```

---

## 9. Realtime — WebSocket Topology

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         SOCKET.IO REALTIME HUB                           │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────┐
                    │      Socket.IO Server    │
                    │       (Backend)          │
                    └──────────────┬───────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼

    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │    room:    │          │    room:    │          │    room:    │
    │ candles:    │          │   search:   │          │  lb:top-k   │
    │ BTC@1m      │          │   {runId}   │          │             │
    │ BTC@1h      │          │             │          │ (live       │
    │ BTC@4h      │          │ (search     │          │ leaderboard │
    │ BTC@1d      │          │  progress)  │          │   push)     │
    └─────────────┘          └─────────────┘          └─────────────┘

Client subscribes:

- `subscribe: BTC 1m/1h/4h/1d`
- Joins rooms: `candles:btc@1m`, etc.
- `subscribe: search`
- Joins room: `search:{runId}`
- `subscribe: leaderboard`
- Joins room: `lb:top-k`

Server events:

- `CandleClosed` → `candles:*`
- `SearchProgress` → `search:{runId}`
- `SearchCompleted` → `search:{runId}`
- `BacktestCompleted` → `search:{runId}`
- `LeaderboardUpdated` → `lb:top-k`
- `NewsCollected` → `news:all`
- `SentimentAnalyzed` → `news:all`
```

---

## 10. Queue Topology

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                            BULLMQ QUEUES                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────────────┐       ┌────────────────────────┐
│ Q: search-built-in     │       │ Q: backtest            │
│                        │       │                        │
│ • JobType:             │       │ • JobType:             │
│   - GENERATE_CANDIDATE │       │   - RUN_BACKTEST       │
│                        │       │                        │
│ Workers: 1–2           │       │ Workers: 2–N (scale)   │
│ Concurrency: 2         │       │ Concurrency: per worker│
└────────────────────────┘       └────────────────────────┘
                                          │
                                          │ on success
                                          ▼
                               ┌────────────────────────┐
                               │ Q: evaluation           │
                               │                        │
                               │ • JobType:              │
                               │   - EVALUATE_RESULT     │
                               │                        │
                               │ Workers: 1–2            │
                               └───────────┬────────────┘
                                           │
                                           │ on success
                                           ▼
                               ┌────────────────────────┐
                               │ Q: leaderboard          │
                               │                        │
                               │ • JobType:              │
                               │   - UPDATE_LEADERBOARD  │
                               │                        │
                               │ Workers: 1               │
                               └────────────────────────┘

Retry policy:

- Attempts: 3
- Exponential backoff: 1s → 30s cap
- Failed jobs → persist `error_message` in `queue_jobs` table
```

---

## 11. Strategy Plugin Workflow

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      STRATEGY PLUGIN LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────────────┘

                     ┌──────────────────────────┐
                     │    Strategy interface    │
                     │                          │
                     │ + id: string             │
                     │ + name: string           │
                     │ + family: StrategyFamily │
                     │ + parameters: ParamSpec  │
                     │ + analyze(ctx): Signal   │
                     └──────────┬───────────────┘
                                │ implements
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│ MA Strategy  │        │ RSI Strategy │        │  Bollinger   │
│   (trend)    │        │  (momentum)  │        │ (volatility) │
└──────────────┘        └──────────────┘        └──────────────┘
                                │
                                │ at startup
                                ▼
                     ┌──────────────────────────┐
                     │     StrategyRegistry     │
                     │                          │
                     │ .register(MA)            │
                     │ .register(RSI)           │
                     │ .register(Bollinger)     │
                     │                          │
                     │ Map<id, Strategy>        │
                     └──────────┬───────────────┘
                                │ combine
                                ▼
                     ┌──────────────────────────┐
                     │    CombinationEngine     │
                     │                          │
                     │ combine([                │
                     │  {sid: MA, weight: 0.4}, │
                     │  {sid: RSI, weight: 0.6} │
                     │ ])                       │
                     │ → CompositeStrategy      │
                     └──────────┬───────────────┘
                                │ run
                                ▼
                     ┌──────────────────────────┐
                     │       Backtester         │
                     │                          │
                     │ for each candle:         │
                     │   ctx = new CandleCtx    │
                     │   sig = composite        │
                     │            .analyze(ctx) │
                     │   if BUY  → open         │
                     │   if SELL → close        │
                     └──────────────────────────┘
```

---

## 12. Caching Strategy

| Data                      | Cache     |     TTL | Invalidation            |
| ------------------------- | --------- | ------: | ----------------------- |
| `candles` (latest)        | Redis     |     60s | On `CandleClosed`       |
| `leaderboard:top-k`       | Redis     |     10s | On `LeaderboardUpdated` |
| `search:progress:<runId>` | Redis     | runtime | On `SearchProgress`     |
| `news:recent`             | Redis     |   5 min | On `NewsCollected`      |
| `strategies:registry`     | In-memory |    boot | On strategy register    |

---

## 13. Reliability & Failure Handling

| Scenario                      | Mitigation                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Binance WebSocket disconnect  | Exponential backoff (1s → 30s cap) + heartbeat monitor + automatic stream resubscription |
| Binance REST rate-limit (429) | Retry with exponential backoff (max 3), paginate with 80ms sleep                         |
| Worker crash                  | BullMQ retries; if all attempts fail → job marked `FAILED`, persisted in `queue_jobs`    |
| Search hung                   | Stop condition: `maxCandidates` reached OR user clicks stop                              |
| Evaluation handler fails      | Other handlers still run; event handlers are isolated                                    |
| Search running too long       | Mini-job chunks; Redis-backed breaker if cumulative time exceeds limit                   |
| Replay experiment             | `experiment_id` references immutable `strategy_version`, `dataset`, and `parameters`     |
| Concurrent leaderboard update | Upsert by `(strategy_version_id, symbol_id, timeframe)`; recompute rank atomically       |
| DB connection lost            | PostgreSQL pool reconnect; backtest job retried after transient failure                  |

---

## 14. Observability — Dashboard & Logs

### 14.1 Components Tracked

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                       OBSERVABILITY DASHBOARD                            │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   Market Data    │ │   Search Status  │ │  Backtest Queue  │
│                  │ │                  │ │                  │
│ Binance WS: OK   │ │ Run #42 ACTIVE   │ │ Waiting: 12      │
│ Last candle: 2s  │ │ Generated: 47/100│ │ Running: 3       │
│ Reconnects: 0    │ │ Backtested: 38   │ │ Completed: 287   │
│                  │ │ Avg time: 8.2s   │ │ Failed: 1        │
└──────────────────┘ └──────────────────┘ └──────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│     Workers      │ │   Leaderboard    │ │ News / Sentiment │
│                  │ │                  │ │                  │
│ worker-1: BUSY   │ │ Top 1: RSI+MA    │ │ Last crawl: 4m   │
│ worker-2: IDLE   │ │ Score: 87.3      │ │ News (24h): 142   │
│ worker-3: OFFLINE│ │ ...              │ │ +: 62 =: 41 −: 39│
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### 14.2 Structured Log Format

```json
{
  "timestamp": "2026-08-13T20:00:00.000Z",
  "level": "INFO",
  "module": "backtest",
  "event": "backtest.completed",
  "experimentId": "uuid",
  "candidateId": "uuid",
  "durationMs": 8213,
  "trades": 142,
  "pnl": 0.234
}
```

---

## 15. Security & Configuration

| Concern                                 | Solution                                          |
| --------------------------------------- | ------------------------------------------------- |
| API keys (Binance, CryptoPanic, Gemini) | `.env` loaded via `dotenv`, never hard-coded      |
| Exchange credentials                    | Not needed (public endpoints only in MVP)         |
| CORS                                    | Socket.IO + Express allowlist of frontend origins |
| Rate limiting                           | `express-rate-limit` middleware (100 req/min/IP)  |
| Input validation                        | `zod` schema for every REST endpoint              |
| SQL injection                           | Prisma ORM with parameterized queries             |
| Auth (future)                           | JWT + RBAC; layer separation prepared             |

---

## 16. Deployment Topology

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT (MVP / SINGLE REGION)                     │
└─────────────────────────────────────────────────────────────────────────┘

       ┌────────────────────────┐
       │    Vercel / Netlify    │
       │    Frontend (React)    │
       │  crypto-strategy-lab   │
       └────────────┬───────────┘
                    │ HTTPS / WSS
                    ▼
       ┌────────────────────────┐
       │    Render / Railway    │
       │     Backend Node.js    │
       │                        │
       │ • REST API             │
       │ • Socket.IO            │
       │ • BullMQ Workers       │
       │ • 1 instance           │
       └───────┬─────────┬──────┘
               │         │
               ▼         ▼
        ┌───────────┐ ┌───────────┐
        │ Supabase  │ │   Redis   │
        │ PostgreSQL│ │  Upstash  │
        │           │ │  or self  │
        └───────────┘ └───────────┘
```

---

## 17. Module Ownership

| Module                 | Owner | Backend                                                                | Frontend                                    |
| ---------------------- | ----- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Market Data            | Bảo   | ✅ BinanceRestAdapter, BinanceWsAdapter, SocketGateway                  | ✅ MultiChart (4-pane)                       |
| Strategy + Combination | Trí   | ✅ Strategy interface, Registry, MA/RSI/Bollinger/SR, CombinationEngine | ✅ Strategy Selector UI                      |
| Search                 | Trí   | ✅ StrategyGenerator, SearchController, Random/Domain-guided            | ✅ Search Control Panel                      |
| Backtest               | Huy   | ✅ Backtester, BullMQ Worker, Trade simulation                          | ✅ Backtest Progress, Result, Trade List     |
| News + Sentiment       | Nhân  | ✅ CryptoPanicAdapter, GeminiAnalyzer                                   | ✅ News/Sentiment UI                         |
| Evaluator              | Nhân  | ✅ Metrics (Return, WinRate, MDD, OverallScore)                         | Consumed by Leaderboard UI                  |
| Leaderboard            | Nhân  | ✅ Top-K service, listens to StrategyEvaluated                          | ✅ Leaderboard UI                            |
| Dashboard Shell        | Nhân  | —                                                                      | ✅ Layout, Routing, Theme, Component Library |

---

## 18. Quality Attribute Scenarios (QAS)

| Attribute           | Scenario                         | Response                                                                                                         |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Modifiability**   | Add a new strategy (e.g. MACD)   | Create class implementing `Strategy`; call `StrategyRegistry.register()`. No other code changes.                 |
| **Modifiability**   | Swap exchange to OKX             | Create `OkxRestAdapter` + `OkxWsAdapter` implementing the same ports; update DI container. Frontend untouched.   |
| **Scalability**     | Increase candidate count to 1000 | BullMQ scales workers horizontally; backtest queue capacity grows.                                               |
| **Reliability**     | Binance drops, reconnect 5 times | `ReconnectStrategy` uses exponential backoff; system remains available and UI shows `Reconnecting`.              |
| **Realtime**        | New candle closes                | Target < 2s end-to-end: Binance → WS Adapter → EventBus → SocketGateway → Frontend chart.                        |
| **Reproducibility** | Re-run experiment #42            | Read experiment row → fetch same `strategy_version` + parameters + dataset → backtest produces identical result. |

---

## 19. Architecture Decision Records (ADR Index)

| ID      | Title                                                                | Status   |
| ------- | -------------------------------------------------------------------- | -------- |
| ADR-001 | In-process Event Bus (Node EventEmitter) vs external (Redis Pub/Sub) | Accepted |
| ADR-002 | Plugin Architecture for Strategy (Registry pattern)                  | Accepted |
| ADR-003 | BullMQ for Backtest Queue (vs custom)                                | Accepted |
| ADR-004 | Separate Sentiment Service (vs inline in News)                       | Accepted |
| ADR-005 | UUID over auto-increment ID for distributed safety                   | Accepted |
| ADR-006 | Composite strategy normalized via `composite_components` table       | Accepted |
| ADR-007 | One leaderboard entry per `(strategy, symbol, timeframe)`            | Accepted |
| ADR-008 | Immutable strategy versioning (BR-043)                               | Accepted |

---

## 20. Acceptance Criteria (Architecture-Level Done)

* [ ] Strategy Registry supports hot-pluggable `Strategy` implementations
* [ ] Search runs independently of Backtest (decoupled via queue)
* [ ] Backtest runs in background; dashboard remains responsive
* [ ] Binance disconnect triggers automatic reconnect with backoff
* [ ] Leaderboard updates in realtime (< 3s latency)
* [ ] All cross-module communication uses Event Bus (no direct calls)
* [ ] Each module has its own folder, port interfaces, and DI container
* [ ] TypeScript shared types live in `shared/types/` and are imported across modules
* [ ] All events in the Event Catalog emit and are received correctly
* [ ] Reproducibility: `experiment → strategy_version → result` is traceable
