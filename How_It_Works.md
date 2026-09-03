# Luồng hoạt động thực tế — Crypto Strategy Lab

> Tài liệu giải thích bằng ngôn ngữ đời thường + sơ đồ + code reference, giúp bất kỳ ai (kể cả người mới) hiểu được đồ án đang chạy như thế nào.

---

# 1. Bức tranh toàn cảnh (đọc 1 lần là hiểu)

Hệ thống giải quyết **1 câu hỏi lớn**:

> _"Với cặp BTC/USDT, trong khung 1h, tổ hợp chiến lược nào (MA + RSI + SENTIMENT,...) cho lợi nhuận tốt nhất trên dữ liệu quá khứ?"_

Để trả lời, hệ thống chia thành **5 module chạy nối tiếp nhau qua EventBus**, cộng với **2 module phụ trợ** (Market Data + News):

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        KIẾN TRÚC 7 MODULE                                   │
└────────────────────────────────────────────────────────────────────────────┘

  [1] Market Data ────► [2] Search ────► [3] Backtest ────► [4] Evaluator ────► [5] Leaderboard
       (lấy nến)         (sinh ý tưởng)   (chạy thử)        (chấm điểm)        (xếp hạng)
                                                                     ▲
  [6] News ──► [7] Sentiment ─────────────────────────────────────────┘
       (lấy tin)   (phân tích)        sentiment được Strategy SENTIMENT
                                     đọc trong lúc Backtest
```

**Mỗi module là một "trạm" độc lập.** Các trạm giao tiếp qua **EventBus** (pub/sub), KHÔNG gọi trực tiếp nhau. Khi trạm Search xong việc, nó chỉ cần **publish event** "tôi xong rồi, đây là kết quả". Trạm Backtest đã subscribe sẵn sẽ tự động nhận và xử lý.

**Bạn chỉ cần nhớ:** Pipeline chính chạy từ Search → Backtest → Evaluator → Leaderboard. Market Data và News chạy song song ở background để cung cấp đầu vào.

---

# 2. Từng module làm gì (theo file thật trong codebase)

| # | Module | Thư mục | Viết tắt | Làm gì |
|---|---|---|---|---|
| 1 | **Market Data** | `backend/src/modules/market-data/` | MD | Lấy nến (candles) BTC/USDT từ Binance → lưu Postgres. Đồng thời stream realtime qua WebSocket. |
| 2 | **Search** | `backend/src/modules/search/` | SR | Sinh ra các "ý tưởng chiến lược" (candidates). |
| 3 | **Backtest** | `backend/src/modules/backtest/` | BT | Chạy thử chiến lược trên dữ liệu quá khứ, sinh ra giao dịch giả lập. |
| 4 | **Evaluator** | `backend/src/modules/evaluation/` | EV | Tính chỉ số: lợi nhuận, win rate, max drawdown, điểm tổng. |
| 5 | **Leaderboard** | `backend/src/modules/leaderboard/` | LB | Sắp xếp các strategy theo điểm, lưu top-K. |
| 6 | **News** | `backend/src/modules/news/` | NW | Lấy tin tức từ CryptoPanic/NewsData → lưu DB. |
| 7 | **Sentiment** | `backend/src/modules/sentiment/` | SN | Phân tích tin tức: tích cực / trung tính / tiêu cực. |

Mỗi module có cấu trúc 3 lớp giống nhau:

```
modules/<name>/
├── domain/         ← Pure business logic, KHÔNG phụ thuộc DB / framework
├── application/    ← Orchestration: gọi domain, phát event
├── infrastructure/ ← Adapter: Prisma, BullMQ, Binance SDK, Gemini API
└── presentation/   ← HTTP routes / WebSocket gateways
```

---

# 3. Ví dụ cụ thể: Trader bấm "Run Discovery" — chuyện gì xảy ra từng giây

Giả sử trader mở frontend `localhost:5173`, chọn:
- Symbol: BTC/USDT
- Timeframe: 1h
- Algorithm: Domain-guided
- maxCandidates: 30
- Bấm **"Run Discovery"**

Dưới đây là từng bước với file thật và số dòng:

## Bước A — Frontend gửi HTTP request

```114:118:frontend/src/pages/Strategy.tsx
  // ...
  startSearch(input) {
    // POST /api/search/start
  }
```

Frontend gọi `POST /api/search/start` với body:

```json
{
  "algorithmId": "uuid-của-DomainGuided",
  "symbolId": "uuid-của-BTCUSDT",
  "timeframe": "1h",
  "maxCandidates": 30,
  "generatorConfig": {
    "familyGroups": [
      { "name": "trend",     "families": ["TREND"] },
      { "name": "momentum",  "families": ["MOMENTUM"] },
      { "name": "structure", "families": ["STRUCTURE"] }
    ],
    "mode": "EXHAUSTIVE"
  }
}
```

## Bước B — Backend nhận request, tạo SearchRun

Request đến `search.routes.ts`:

```48:50:backend/src/modules/search/presentation/search.routes.ts
const StartSearchSchema = z.object({
  algorithmId: z.string().uuid(),
  symbolId: z.string().uuid(),
  ...
  maxCandidates: z.number().int().positive().max(10_000),
});
```

Sau khi validate, route gọi `SearchService.startSearch()`:

```209:223:backend/src/modules/search/application/SearchService.ts
public async startSearch(input): Promise<{ searchRun: SearchRunRecord }> {
  const searchRun = await this.repository.createSearchRun({...});

  this.eventBus.publish<SearchStartedEvent>("SearchStarted", {
    searchRunId: searchRun.id,
    ...
  });

  return { searchRun };
}
```

**Việc làm:**
1. INSERT một dòng vào bảng `search_runs` với `status = 'PENDING'`.
2. Publish event `SearchStarted` lên EventBus (frontend nghe qua WS sẽ hiện "Search started").

## Bước C — SearchService chạy Generator

`startSearch()` rồi gọi `start(searchRunId)`:

```256:264:backend/src/modules/search/application/SearchService.ts
const generator = this.buildGenerator(algorithm, spaces);
const onCandidate = this.buildOnCandidate(searchRunId);
const state: SearchState = { generatedCount: 0, queuedCount: 0, ... };

const result = await generator.generate(onCandidate, shouldStop, state);
```

**Trong bước này SearchService làm 3 việc:**

1. **Lấy tất cả strategy đã đăng ký** từ `StrategyRegistry`:
   ```
   registry.list() = [
     "strategy.ma",
     "strategy.rsi",
     "strategy.bollinger",
     "strategy.support_resistance",
     // (sau Bước 9 sẽ thêm "strategy.news_sentiment")
   ]
   ```

2. **Mỗi strategy → 1 `ParameterSpace`** (không gian tham số có thể thử). VD với MA:
   ```
   MA: { period: [5, 10, 20, 50, 100] }
   RSI: { period: [7, 14, 21], oversold: [20, 30], overbought: [70, 80] }
   ```

3. **Khởi tạo `DomainGuidedGenerator`** với spaces + family groups từ request.

## Bước D — Generator lặp nội bộ (L1 loop)

Trong file `DomainGuidedGenerator.ts`:

```148:223:backend/src/modules/search/generators/DomainGuidedGenerator.ts
while (true) {
  if (shouldStop(state)) break;
  if (totalGenerated >= maxCombinations) break;
  
  // Pick 1 strategy từ MỖI family group
  // VD: trend=MA(period=20), momentum=RSI(period=14),
  //     structure=SR(lookback=50)
  
  const cand = buildCompositeCandidate(spaceByStrategyId, familyGroups, ...);
  const fingerprint = compositeFingerprint(cand); // dedupe
  if (seen.has(fingerprint)) continue;
  seen.add(fingerprint);
  
  const accepted = await resolveOnCandidate(onCandidate, cand);
  // ↑ mỗi candidate được đẩy qua callback onCandidate
}
```

**Giải thích đơn giản:**
- L1 loop lặp cho tới khi đủ `maxCandidates` (30).
- Mỗi vòng: chọn ngẫu nhiên 1 strategy từ mỗi family group → ghép thành composite.
- Bỏ qua các combination đã thấy (dedupe).
- Mỗi candidate hợp lệ → gọi `onCandidate(candidate)`.

## Bước E — onCandidate đẩy candidate xuống Queue

Trong `SearchService.buildOnCandidate`:

```tsx
// Pseudo-code (dựa trên pattern trong SearchService.ts)
const onCandidate = (candidate: SearchCandidate) => {
  // 1. Persist candidate vào DB
  await prisma.candidateStrategy.create({
    data: { searchRunId, config: candidate.config, ... }
  });
  
  // 2. Đẩy vào BacktestQueue (in-memory map trong MVP)
  backtestQueue.enqueue({
    candidateId,
    strategyId,
    parameters,
    symbol,
    timeframe,
  });
  
  return true; // báo cho generator tiếp tục
};
```

**Đây chính là "Strategy Queue" trong sơ đồ của bạn.** Nó là một hàng đợi các job backtest cần chạy.

## Bước F — BacktestWorker xử lý job từ Queue

```7:75:backend/src/modules/backtest/infrastructure/BacktestWorker.ts
export class BacktestWorker {
  public async processJob(jobId, params): Promise<BacktestJobProgress> {
    // 1. Emit BacktestStarted event
    eventBus.publish("BacktestStarted", { jobId, params, startedAt });
    
    // 2. Chạy backtest thực sự qua BacktestService
    const output = await this.backtestService.runBacktest(params);
    
    // 3. Emit BacktestCompleted event
    eventBus.publish("BacktestCompleted", {
      jobId,
      experimentId: output.experimentId,
      symbol, timeframe, strategyName,
      metrics: output.result.metrics,
    });
    
    return { jobId, progress: 100, status: "COMPLETED", result: output };
  }
}
```

**Trong `BacktestService.runBacktest`:**
1. Load candles BTC/USDT 1h từ Postgres (do Market Data đã lưu).
2. Khởi tạo `CompositeStrategy` từ candidate config.
3. Với mỗi candle, gọi `compositeStrategy.analyze(ctx)`:
   - `MA.analyze(ctx)` → BUY / HOLD / SELL
   - `RSI.analyze(ctx)` → BUY / HOLD / SELL
   - `SR.analyze(ctx)` → BUY / HOLD / SELL
   - `WeightedCombiner.combine(signals, weights)` → tín hiệu cuối
4. Mô phỏng giao dịch: mỗi BUY → mua, SELL → bán, tính P&L.
5. Trả về `trades[]` và `metrics` (return, win rate, drawdown).

## Bước G — EvaluationService nhận event BacktestCompleted

`EvaluationService` đã subscribe event `BacktestCompleted` từ lúc khởi động:

```29:33:backend/src/modules/evaluation/application/evaluation.service.ts
private registerEventListener(): void {
  this.eventBus.subscribe("BacktestCompleted", (payload) => {
    void this.handleBacktestCompleted(payload);
  });
}
```

Khi nhận event, nó sẽ:
1. Tính toán metrics: `Return`, `WinRate`, `MaxDrawdown`, `NumTrades`.
2. Tính `OverallScore = 0.4*Return + 0.3*WinRate + 0.3*(1 - MDD)`.
3. Lưu vào bảng `backtest_results`.
4. Publish event `StrategyEvaluated`.

```231:244:backend/src/modules/evaluation/application/evaluation.service.ts
this.eventBus.publish("StrategyEvaluated", {
  experimentId,
  strategyVersionId,
  symbolId, timeframe,
  totalReturn, winRate, maxDrawdown, numTrades,
  overallScore,
});
```

## Bước H — LeaderboardService nhận event StrategyEvaluated

```27:32:backend/src/modules/leaderboard/application/leaderboard.service.ts
private registerEventListener(): void {
  this.eventBus.subscribe<StrategyEvaluatedPayload>(
    "StrategyEvaluated",
    (payload) => { void this.handleStrategyEvaluated(payload); }
  );
}
```

Khi nhận event, nó sẽ:
1. Lấy top 10 strategy theo `overallScore` từ DB.
2. Cập nhật `leaderboard_entries` (upsert).
3. Publish event `LeaderboardUpdated` + broadcast qua Socket.IO.

```58:66:backend/src/modules/leaderboard/application/leaderboard.service.ts
this.eventBus.publish("LeaderboardUpdated", updatePayload);

try {
  const io = getSocketServer();
  io.emit("LeaderboardUpdated", updatePayload);
} catch {
  // Socket server optional
}
```

## Bước I — Frontend nhận WebSocket event

File `frontend/src/lib/socket.ts` đã subscribe các event:

```141:145:frontend/src/lib/socket.ts
socket.on("SentimentAnalyzed", (data: SentimentAnalyzedPayload) => {
  // cập nhật widget sentiment
});

socket.onAny((event: string, ...args: unknown[]) => {
  // log + custom handler
});
```

`/leaderboard` page subscribe `LeaderboardUpdated`:

```63:68:frontend/src/pages/Leaderboard.tsx
const off = on('LeaderboardUpdated', () => {
  // gọi API refetch hoặc merge payload vào state
  refetch();
});
```

UI Leaderboard tự cập nhật, không cần F5.

## Bước J — Search kết thúc

Sau khi Generator dừng (đủ `maxCandidates` hoặc user bấm Stop):

```288:300:backend/src/modules/search/application/SearchService.ts
this.eventBus.publish<SearchCompletedEvent>("SearchCompleted", {
  searchRunId,
  totalGenerated: result.result.totalGenerated,
  totalQueued: result.result.totalQueued,
  totalRejected: result.result.totalRejected,
  ...
});
```

`search_runs.status` được update thành `DONE` hoặc `STOPPED`.

Frontend nhận `SearchCompleted` qua WS → toast "Search completed: 30 candidates tested".

---

# 4. Timeline tổng hợp (1 candidate hoàn chỉnh)

```
0ms           50ms              80ms                 2000ms                    2050ms
 │             │                  │                      │                          │
 ▼             ▼                  ▼                      ▼                          ▼
[POST]    [Persist SearchRun] [Generate cand #1]   [Backtest cand #1]      [Emit BacktestCompleted]
 │             │                  │                      │                          │
 │             │ publish          │ persist candidate     │ load candles             │ publish event
 │             │ SearchStarted    │ + enqueue             │ loop candles             │ to EvaluationService
 │             │                  │                      │ MA + RSI + SR analyze    │
 │             │                  │                      │ combine signals          │
 │             │                  │                      │ simulate trades          │
 │             │                  │                      ▼                          ▼
 │             │                  │                [trades[], metrics]        [EvaluationService handles]
 │             │                  │                      │                          │
 │             │                  │                      │                          │ compute score
 │             │                  │                      │                          │ persist result
 │             │                  │                      │                          │ publish StrategyEvaluated
 │             │                  │                      │                          │
 │             │                  │                      │                          ▼
 │             │                  │                      │                    [LeaderboardService handles]
 │             │                  │                      │                          │
 │             │                  │                      │                          │ update top-K
 │             │                  │                      │                          │ broadcast LeaderboardUpdated
 │             │                  │                      │                          │
 │             │                  │                      │                          ▼
 │             │                  │                      │                   [Frontend UI updates]
```

30 candidates × ~2s/candidate ≈ 60 giây cho 1 SearchRun.

---

# 5. Module phụ trợ: Market Data và News

Hai module này chạy **nền song song**, không thuộc pipeline chính nhưng cung cấp đầu vào:

## 5.1 Market Data

- **Khởi động:** Khi `npm run dev`, `server.ts` gọi `marketData.service.start()`.
- **Công việc:**
  1. Đồng bộ danh sách symbols từ Binance → lưu DB.
  2. Backfill candles lịch sử (VD: 1000 nến 1h gần nhất).
  3. Mở WebSocket với Binance → nhận candles realtime → publish event `CandleClosed`, `CandleUpdating` qua Socket.IO.
- **File chính:** `backend/src/modules/market-data/`
- **Ai dùng?** Backtester load candles từ DB. Frontend nhận realtime qua WS để vẽ chart.

## 5.2 News + Sentiment

- **News crawler** chạy theo lịch (cron / interval) → lấy tin từ CryptoPanic/NewsData → lưu DB → publish event `NewsCollected`.
- **SentimentService** subscribe `NewsCollected` → lấy tin → gọi `GeminiSentimentAnalyzer.analyzeText()` (hoặc fallback `LexiconSentimentAnalyzer`) → lưu kết quả → publish event `SentimentAnalyzed`.
- **Frontend widget** "BTC News: Positive 42% / Neutral 38% / Negative 20%" subscribe `SentimentAnalyzed` qua WS và update.
- **Vai trò trong loop:** Hiện tại chỉ hiển thị widget. Để sentiment đi vào loop thật, cần làm Bước 9: tạo `NewsSentimentStrategy` để nó đọc `SentimentSummary` rồi trả Signal (xem `Loop_Specification.md` §5).

```
NewsAdapter ──► NewsService ──► DB ──► SentimentService ──► Gemini ──► DB
                                    │                                    │
                                    │                                    │
                                    ▼                                    │
                              EventBus                                   │
                              NewsCollected                              │
                                    │                                    │
                                    ▼                                    │
                          SentimentService (subscribe)                   │
                                    │                                    │
                                    ▼                                    │
                          GeminiSentimentAnalyzer                        │
                                    │                                    │
                                    ▼                                    │
                          save SentimentRecord ─────────────────────────►│
                                    │
                                    ▼
                              EventBus
                              SentimentAnalyzed
                                    │
                                    ▼
                          Frontend widget update
```

---

# 6. Cơ chế giao tiếp: EventBus

Tất cả module giao tiếp qua **1 EventBus duy nhất** (singleton):

```ts
// backend/src/shared/event-bus/EventBus.ts (giản lược)
class EventBus {
  private listeners = new Map<string, Set<Function>>();
  
  publish(event: string, payload: any) {
    this.listeners.get(event)?.forEach(fn => fn(payload));
  }
  
  subscribe(event: string, fn: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
}
```

**Tại sao thiết kế này?**

| Lợi ích | Ví dụ |
|---|---|
| Module không phụ thuộc trực tiếp nhau | Search KHÔNG gọi Backtest, chỉ enqueue + publish event |
| Dễ thêm module mới | Muốn thêm "NotificationService" gửi email khi leaderboard thay đổi → chỉ cần subscribe `LeaderboardUpdated` |
| Test dễ | Mock EventBus, không cần mock cả DB |
| Loose coupling | Đổi Search algorithm không cần sửa Backtest |

**Các event chính trong hệ thống:**

```
SearchStarted           ← Search publish
SearchProgress          ← Search publish (mỗi N candidates)
SearchCompleted         ← Search publish (kết thúc L1)
SearchFailed            ← Search publish (lỗi)
StrategyGenerated       ← Search publish (mỗi candidate)
BacktestQueued          ← Search publish
BacktestStarted         ← BacktestWorker publish
BacktestCompleted       ← BacktestWorker publish
StrategyEvaluated       ← EvaluationService publish
LeaderboardUpdated      ← LeaderboardService publish (+ Socket.IO broadcast)
NewsCollected           ← NewsService publish
SentimentAnalyzed       ← SentimentService publish
CandleClosed            ← MarketData publish (Socket.IO)
CandleUpdating          ← MarketData publish (Socket.IO)
```

---

# 7. Cơ chế "queue" hiện tại (in-memory)

Trong MVP, `BacktestQueue` dùng một Map trong memory:

```tsx
// Pseudo-code dựa trên BacktestQueue.ts
class BacktestQueue {
  private jobs = new Map<string, BacktestJob>();
  
  enqueue(job) { this.jobs.set(job.id, job); this.emit('new'); }
  
  // Worker polling / on-event
  on('new', () => this.processNext());
}
```

**Hạn chế:** Không scale được, mất job khi restart. Production cần BullMQ + Redis (xem Loop_Specification.md §5B).

---

# 8. Cách xem hệ thống chạy thật

## 8.1 Chạy local

```bash
cd backend
npm install
npx prisma migrate dev    # tạo schema trong Postgres
npm run dev               # start Express + Socket.IO + bootstraps
```

Mở `frontend/`:
```bash
npm install
npm run dev               # mở localhost:5173
```

## 8.2 Quan sát realtime

Mở **3 tab**:
1. `/strategy` — chọn config, bấm Run Discovery.
2. `/search/:id` — xem progress realtime (qua WS).
3. `/leaderboard` — xem bảng xếp hạng update từng candidate.

Mở **DevTools → Network → WS** để xem các event `SearchStarted`, `BacktestCompleted`, `LeaderboardUpdated` realtime.

## 8.3 Debug nhanh trong code

```bash
# Terminal 1: chạy backend với log chi tiết
LOG_LEVEL=debug npm run dev

# Terminal 2: query DB xem candidate vừa sinh
psql $DATABASE_URL -c "SELECT id, strategy_version_id, created_at FROM candidate_strategies ORDER BY created_at DESC LIMIT 10;"

# Terminal 3: xem event publish
# Thêm log vào EventBus.publish() để dump mọi event
```

---

# 9. Mapping file → module (cheat sheet)

```
backend/src/
├── server.ts                            ← Entry point, khởi động tất cả
├── modules/
│   ├── market-data/                     ← [1] Market Data
│   │   ├── application/
│   │   │   └── market-data.service.ts   ← start(), stop(), wsConnect
│   │   └── infrastructure/
│   │       └── binance.adapter.ts       ← Gọi Binance REST + WS
│   │
│   ├── search/                          ← [2] Search
│   │   ├── application/
│   │   │   └── SearchService.ts         ← startSearch() → createRun + run generator
│   │   ├── generators/
│   │   │   ├── DomainGuidedGenerator.ts ← family-group based generation
│   │   │   └── RandomGenerator.ts       ← pure random
│   │   └── presentation/
│   │       └── search.routes.ts         ← POST /api/search/start
│   │
│   ├── strategy/                        ← Strategy interfaces & impls
│   │   ├── domain/
│   │   │   ├── Strategy.ts              ← interface (id, family, analyze)
│   │   │   └── StrategyContext.ts       ← input cho analyze()
│   │   ├── strategies/
│   │   │   ├── bootstrap.ts             ← register tất cả strategy
│   │   │   ├── MovingAverageStrategy.ts
│   │   │   ├── RsiStrategy.ts
│   │   │   ├── BollingerBandsStrategy.ts
│   │   │   └── SupportResistanceStrategy.ts
│   │   └── combination/                 ← CompositeStrategy logic
│   │
│   ├── backtest/                        ← [3] Backtest
│   │   ├── application/
│   │   │   └── BacktestService.ts       ← runBacktest()
│   │   └── infrastructure/
│   │       ├── BacktestQueue.ts         ← in-memory queue
│   │       └── BacktestWorker.ts        ← consume queue, run backtest
│   │
│   ├── evaluation/                      ← [4] Evaluator
│   │   ├── domain/
│   │   │   └── evaluator.engine.ts      ← pure metrics calculation
│   │   └── application/
│   │       └── evaluation.service.ts    ← subscribe BacktestCompleted
│   │
│   ├── leaderboard/                     ← [5] Leaderboard
│   │   └── application/
│   │       └── leaderboard.service.ts   ← subscribe StrategyEvaluated
│   │
│   ├── news/                            ← [6] News
│   │   ├── application/
│   │   │   └── news.service.ts
│   │   └── infrastructure/
│   │       ├── newsdata-news.adapter.ts ← CryptoPanic / NewsData
│   │       └── adapter-registry.ts      ← chọn adapter theo env
│   │
│   └── sentiment/                       ← [7] Sentiment
│       ├── application/
│       │   └── sentiment.service.ts     ← subscribe NewsCollected
│       └── infrastructure/
│           ├── gemini-sentiment.analyzer.ts   ← Gemini LLM
│           ├── lexicon-sentiment.analyzer.ts  ← fallback
│           └── prisma-sentiment.repository.ts ← DB
│
├── shared/
│   └── event-bus/
│       └── EventBus.ts                  ← pub/sub trung tâm
│
└── infrastructure/
    ├── database/
    │   └── prisma.ts                    ← Prisma client singleton
    └── queue/
        └── redis.ts                     ← Redis connection (BullMQ sắp tới)
```

```
frontend/src/
├── pages/
│   ├── Strategy.tsx     ← cấu hình + bấm Run Discovery
│   ├── Search.tsx       ← xem progress SearchRun
│   ├── Leaderboard.tsx  ← bảng xếp hạng realtime
│   ├── Backtest.tsx     ← xem chi tiết 1 backtest
│   ├── Discovery.tsx    ← danh sách SearchRun cũ
│   ├── NewsCrawler.tsx  ← danh sách tin tức + sentiment widget
│   ├── StrategyEngine.tsx ← thử nghiệm strategy ad-hoc
│   ├── RealtimeDashboard.tsx ← chart realtime
│   └── Settings.tsx
└── lib/
    └── socket.ts       ← subscribe WebSocket events
```

---

# 10. Tóm tắt 1 phút (TL;DR)

> **Hệ thống hoạt động theo pipeline pub/sub:**
> 
> **Trader bấm Run Discovery** → `Search` tạo SearchRun → `Generator` sinh 30 candidate → mỗi candidate vào `BacktestQueue` → `BacktestWorker` chạy thử trên candles → `BacktestCompleted` event → `Evaluator` tính điểm → `StrategyEvaluated` event → `LeaderboardService` cập nhật top-K → `LeaderboardUpdated` event → `Socket.IO` broadcast → **Frontend leaderboard tự update.**
>
> **Song song:** `MarketData` stream candles từ Binance vào DB. `News` + `Sentiment` lấy tin và phân tích cảm xúc, hiển thị widget.
>
> **6 yêu cầu ngầm định** (multi-worker, retry, pause, resume, monitor, hot-swap algorithm) hiện **chưa implement** — cần `LoopOrchestrator` (xem `Loop_Specification.md` §5B).
>
> **Bước 9, 10** trong demo: thêm `NewsSentimentStrategy` vào `bootstrap.ts` rồi bấm Run Discovery lần 2 với `familyGroups` chứa `SENTIMENT` → composite MA+RSI+SENTIMENT mới được sinh ra và xếp hạng.

---

*End of document*
