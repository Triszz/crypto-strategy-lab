# Loop Specification — Crypto Strategy Lab

**Version:** 1.0  
**Status:** Draft  
**Owner:** Nhân  
**Last Updated:** 2026-09-03  
**Related:** `Requirements_Specification.md`, `Solution.md`

---

# 1. Mục đích

Tài liệu này đặc tả **chính xác** cơ chế vòng lặp (loop) trong Crypto Strategy Lab:

- "Loop" ở đây nghĩa là gì trong codebase thực tế.
- Luồng dữ liệu đi qua từng module khi một SearchRun được chạy.
- Cách **Sentiment Strategy** được đưa vào loop (Bước 9).
- Cách **re-run loop với search space mới** (Bước 10).
- Phân biệt giữa **vòng lặp nội tại trong Generator** và **vòng lặp pipeline liên module**.

Tài liệu đi kèm code reference, giúp developer/QA/reviewer trace từ yêu cầu → code → test.

---

# 2. Phạm vi & Định nghĩa

## 2.1 Thuật ngữ

| Thuật ngữ          | Định nghĩa trong codebase                                                                                                                                              | Định danh trong DB             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **SearchRun**      | Một lần thực thi hoàn chỉnh pipeline `Generator → Queue → Worker → Evaluator → Leaderboard`. Có `id`, `status` (PENDING/RUNNING/DONE/STOPPED/FAILED), `maxCandidates`. | bảng `search_runs`             |
| **Candidate**      | Một tổ hợp strategy cụ thể được sinh ra bởi Generator trong một SearchRun. Có `candidateId` (VD: `0_42`).                                                              | bảng `candidate_strategies`    |
| **Search Space**   | Tập `ParameterSpace[]` mà Generator dùng để sinh candidate.                                                                                                            | embedded trong SearchRun       |
| **Family Group**   | Nhóm các family (TREND, MOMENTUM, STRUCTURE, SENTIMENT) để DomainGuidedGenerator ghép 1 strategy từ mỗi group.                                                         | `generatorConfig.familyGroups` |
| **Pipeline Loop**  | Chuỗi xử lý một SearchRun từ đầu đến cuối.                                                                                                                             | không có bảng riêng            |
| **Generator Loop** | Vòng `while(true)` trong `DomainGuidedGenerator.generate()` — sinh candidate cho tới khi hết stop condition.                                                           | không có bảng riêng            |

## 2.2 Phân biệt 4 loại "loop"

| Loại                                     | Phạm vi                                                                                                      | Tự động?                   | Vị trí trong code (mong đợi)                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **L1 — Generator Loop**                  | Trong 1 lần `generate()`, lặp cho tới khi đủ `maxCandidates`                                                 | Có, tự động                | `DomainGuidedGenerator.ts:144` (`while (true)`)                                                             |
| **L2 — Pipeline Loop**                   | 1 SearchRun đi qua 5 module: Generator → Queue → Worker → Evaluator → Leaderboard                            | Có, tự động (qua EventBus) | `SearchService.ts` → `BacktestQueue` → `BacktestWorker.ts` → `evaluation.service.ts` → `LeaderboardService` |
| **L3 — Discovery Loop / Loop Lifecycle** | Orchestrator liên tục trigger các L2 liên tiếp nhau, mỗi iteration là 1 SearchRun mới. Có pause/resume/stop. | Có, tự động (continuous)   | **LoopOrchestrator** (chưa tồn tại — cần implement)                                                         |
| **L4 — Manual Override**                 | Trader bấm "Run Discovery" để trigger 1 SearchRun ad-hoc bất kỳ lúc nào (override L3)                        | Không, thủ công            | `Strategy.tsx:159` (`startSearch(...)`)                                                                     |

> **Sửa lại so với spec cũ:** Spec v1 ghi L3 là "manual" — sai. Đúng ra L3 phải là **continuous background loop** do `LoopOrchestrator` điều khiển. Nút "Pause Loop" chỉ có ý nghĩa khi L3 đang chạy nền.
>
> Trader chỉ cần bấm **"Start Loop"** 1 lần, sau đó hệ thống tự chạy. Nút "Run Discovery" trên `/strategy` là L4 (manual override), dùng để chạy thử ngoài loop.

---

# 3. Kiến trúc tổng thể của Loop

## 3.1 Sơ đồ tổng quan (5 module + 1 entry point)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          THE LOOP ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐
  │  Trader (User)   │ ◄──── điểm bắt đầu của L3
  └────────┬─────────┘
           │ click "Run Discovery" ở /strategy/:id
           │ payload: { algorithmId, symbolId, timeframe, maxCandidates, generatorConfig }
           ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ L2 — PIPELINE LOOP (1 SearchRun)                            │
  │                                                              │
  │  ┌────────────────────┐                                      │
  │  │  SearchService     │ create SearchRun PENDING            │
  │  │  (search/)         │ publish "SearchStarted"              │
  │  └────────┬───────────┘                                      │
  │           ▼                                                   │
  │  ┌────────────────────┐  L1 — generator lặp while(true)      │
  │  │  DomainGuided /    │  mỗi iter: build candidate          │
  │  │  Random Generator  │  dedupe, gọi onCandidate()           │
  │  └────────┬───────────┘                                      │
  │           │ persist CandidateStrategy row                    │
  │           ▼                                                   │
  │  ┌────────────────────┐  publish "StrategyGenerated"         │
  │  │  BacktestQueue     │  enqueue job (in-memory map,         │
  │  │  (backtest/)       │  chưa phải BullMQ)                   │
  │  └────────┬───────────┘                                      │
  │           ▼                                                   │
  │  ┌────────────────────┐  publish "BacktestStarted"            │
  │  │  BacktestWorker    │  chạy Strategy.analyze()             │
  │  │  (backtest/)       │  qua từng candle, sinh trades        │
  │  └────────┬───────────┘  publish "BacktestCompleted"          │
  │           ▼                                                   │
  │  ┌────────────────────┐  publish "StrategyEvaluated"          │
  │  │  Evaluator         │  tính Return, WinRate, MDD,          │
  │  │  (evaluation/)     │  NumTrades, OverallScore             │
  │  └────────┬───────────┘  persist BacktestResult               │
  │           ▼                                                   │
  │  ┌────────────────────┐  publish "LeaderboardUpdated"        │
  │  │  LeaderboardService│  recompute top-K, upsert entries    │
  │  │  (leaderboard/)    │                                       │
  │  └────────┬───────────┘                                      │
  │           ▼                                                   │
  │      [EventBus / WS]                                          │
  │           │                                                   │
  └───────────┼──────────────────────────────────────────────────┘
              ▼
  ┌──────────────────┐
  │  Frontend (WS)   │ Leaderboard UI cập nhật realtime
  └──────────────────┘

  // Kết thúc L2.
  // Để chạy L3, Trader quay lại /strategy/:id và bấm "Run Discovery" lần nữa.
```

## 3.2 Đặc tính của loop

| Đặc tính                         | Mô tả                                                                       |
| -------------------------------- | --------------------------------------------------------------------------- |
| **Stateless giữa các SearchRun** | Mỗi SearchRun là một instance độc lập. Không có state ẩn giữa các lần chạy. |
| **Event-driven**                 | Module giao tiếp qua EventBus (`getEventBus()`), không gọi trực tiếp.       |
| **Pure domain**                  | Generator/Strategy không phụ thuộc infrastructure (Prisma, Redis, BullMQ).  |
| **Idempotent registration**      | `bootstrapStrategies()` đăng ký 1 lần, gọi lại vô hại.                      |
| **L3 cần user action**           | Không có subscriber nào tự khởi động SearchRun mới dựa trên Leaderboard.    |

---

# 4. Sequence — Một lần chạy L2 hoàn chỉnh

```text
Trader        Frontend       SearchService    Generator      BacktestQueue     BacktestWorker      Evaluator      LeaderboardSvc
 │               │                │               │                │                  │                 │                │
 │ click "Run    │                │               │                │                  │                 │                │
 │ Discovery"    │                │               │                │                  │                 │                │
 │──────────────▶│                │               │                │                  │                 │                │
 │               │ POST           │               │                │                  │                 │                │
 │               │ /search/start  │               │                │                  │                 │                │
 │               │───────────────▶│               │                │                  │                 │                │
 │               │                │ createRun     │                │                  │                 │                │
 │               │                │──────┐       │                │                  │                 │                │
 │               │                │◀─────┘       │                │                  │                 │                │
 │               │                │ publish      │                │                  │                 │                │
 │               │                │ SearchStarted│                │                  │                 │                │
 │               │                │               │                │                  │                 │                │
 │               │                │ generate(    │                │                  │                 │                │
 │               │                │ onCandidate, │                │                  │                 │                │
 │               │                │ shouldStop,   │                │                  │                 │                │
 │               │                │ state)       │                │                  │                 │                │
 │               │                │──────────────▶│                │                  │                 │                │
 │               │                │               │ while(true):   │                  │                 │                │
 │               │                │               │  build cand    │                  │                 │                │
 │               │                │               │  dedupe        │                  │                 │                │
 │               │                │               │  onCandidate() │                  │                 │                │
 │               │                │               │───────────────▶│                  │                 │                │
 │               │                │               │               │ persist cand +   │                  │                 │
 │               │                │               │               │ setImmediate()   │                  │                 │
 │               │                │               │               │ (processJob)     │                  │                 │
 │               │                │               │               │─────────────────▶│                  │                │
 │               │                │               │               │               │ publish           │                 │
 │               │                │               │               │               │ BacktestStarted   │                 │
 │               │                │               │               │               │──────────────────│                 │
 │               │                │               │               │               │ runBacktest(p)    │                 │
 │               │                │               │               │               │ Strategy.analyze │                 │
 │               │                │               │               │               │ trên từng candle │                 │
 │               │                │               │               │               │ sinh trades[]    │                 │
 │               │                │               │               │               │ publish           │                 │
 │               │                │               │               │               │ BacktestCompleted │                 │
 │               │                │               │               │               │─────────────────▶│                 │
 │               │                │               │               │               │               │ Evaluator.calculate(trades)│
 │               │                │               │               │               │               │ persist metrics     │
 │               │                │               │               │               │               │ publish               │
 │               │                │               │               │               │               │ StrategyEvaluated     │
 │               │                │               │               │               │               │───────────────────────▶│
 │               │                │               │               │               │               │               │ recompute top-K        │
 │               │                │               │               │               │               │               │ upsert entries         │
 │               │                │               │               │               │               │               │ publish                 │
 │               │                │               │               │               │               │               │ LeaderboardUpdated      │
 │               │                │               │               │               │               │               │                          │
 │               │  WS broadcast  │               │               │               │               │               │                          │
 │               │◀───────────────│               │               │               │               │               │                          │
 │               │ Leaderboard UI │               │               │               │               │               │                          │
 │               │ re-render      │               │               │               │               │               │                          │
 │               │                │               │ repeat for    │                  │                 │                │
 │               │                │               │ next candidate│                  │                 │                │
 │               │                │               │               │                  │                 │                │
 │               │                │ publish       │               │                  │                 │                │
 │               │                │ SearchCompleted (khi hết candidates)            │                 │                │
 │               │                │               │                  │                 │                │
```

**Tại mỗi bước** các event được publish qua EventBus, frontend subscribe qua WebSocket để cập nhật UI realtime.

---

# 5. Đặc tả chi tiết Bước 9 — Đưa SentimentStrategy vào Search Space

## 5.1 Goal

Sau khi module Sentiment đã hoạt động (thu thập news, phân tích, lưu DB), làm sao để **SentimentStrategy** trở thành một lựa chọn hợp lệ mà Generator có thể include vào candidate.

## 5.2 Preconditions

| #   | Điều kiện                                                    | Bằng chứng                                                                                                          |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | SentimentService đã có dữ liệu                               | `getSentimentSummary("BTCUSDT")` trả về object với `averageScore`, `positiveCount`, `neutralCount`, `negativeCount` |
| 2   | `SentimentSummary` đã được expose qua REST                   | `GET /api/sentiment/summary?symbol=BTCUSDT`                                                                         |
| 3   | Bảng `strategies` đã có row `id = "strategy.news_sentiment"` | Hiện **chưa có** — cần tạo seed/script                                                                              |
| 4   | Bootstrap chưa register `NewsSentimentStrategy`              | `bootstrap.ts` chỉ có 4 strategy                                                                                    |

## 5.3 Bước 9 — Công việc kỹ thuật

**5.3.1 Tạo class `NewsSentimentStrategy`** — implement interface `Strategy` với `family = "SENTIMENT"`:

```ts
// File mới: backend/src/modules/strategy/strategies/NewsSentimentStrategy.ts
import type { Strategy } from "../domain/Strategy";
import type { Signal } from "../domain/Signal";
import type { StrategyCandle, StrategyContext, StrategyParameters } from "../domain/StrategyContext";
import { ParamSpec } from "../domain/ParamSpec";

export class NewsSentimentStrategy implements Strategy {
  public readonly id = "strategy.news_sentiment";
  public readonly name = "News Sentiment";
  public readonly family = "SENTIMENT" as const;
  public readonly requiredHistory = 1;
  public readonly description = "Phát tín hiệu dựa trên tổng hợp sentiment của tin tức.";

  public parameterSpec = {
    threshold: new ParamSpec({
      kind: "NUMBER",
      min: 0.05,
      max: 0.5,
      step: 0.05,
      defaultValue: 0.2,
    }),
    lookbackHours: new ParamSpec({
      kind: "INTEGER",
      min: 1,
      max: 168,
      step: 1,
      defaultValue: 24,
    }),
  };

  public defaultParameters(): StrategyParameters {
    return { threshold: 0.2, lookbackHours: 24 };
  }

  public validateParameters(p: StrategyParameters) {
    if (typeof p.threshold !== "number") return { ok: false, errors: ["threshold must be number"] };
    if (p.threshold < 0 || p.threshold > 1) return { ok: false, errors: ["threshold out of range"] };
    return { ok: true, errors: [] };
  }

  // Inject SentimentService qua constructor (DI từ container.ts)
  public constructor(private readonly sentimentService: SentimentServiceLike) {}

  public async analyze(ctx: StrategyContext): Promise<Signal> {
    const params = ctx.parameters as { threshold: number; lookbackHours: number };
    const summary = await this.sentimentService.getSentimentSummaryForBacktest(ctx.symbol, params.lookbackHours);

    if (summary.averageScore > params.threshold) {
      return { kind: "BUY", strength: Math.min(1, summary.averageScore), at: ctx.candle.closeTime };
    }
    if (summary.averageScore < -params.threshold) {
      return { kind: "SELL", strength: Math.min(1, Math.abs(summary.averageScore)), at: ctx.candle.closeTime };
    }
    return { kind: "HOLD", strength: 0, at: ctx.candle.closeTime };
  }
}

export interface SentimentServiceLike {
  getSentimentSummaryForBacktest(symbol: string, lookbackHours: number): Promise<SentimentSummary>;
}
```

**Điểm cốt lõi của Bước 9:**

- Tạo `Strategy` instance thật với `family = "SENTIMENT"` → `StrategyRegistry` có thể lookup theo `id`.
- `analyze(ctx)` đọc `SentimentService` để biến sentiment score thành Signal BUY/SELL/HOLD.
- Có đầy đủ `parameterSpec` + `validateParameters` → Generator có thể sample threshold.

**5.3.2 Đăng ký trong `bootstrap.ts`:**

```ts
// Sửa: backend/src/modules/strategy/strategies/bootstrap.ts
import { NewsSentimentStrategy } from "./NewsSentimentStrategy";
import { getSentimentService } from "../../sentiment/application/sentiment.container";

export const BUILT_IN_STRATEGIES: ReadonlyArray<Strategy> = [
  new MovingAverageStrategy(),
  new RsiStrategy(),
  new BollingerBandsStrategy(),
  new SupportResistanceStrategy(),
  new NewsSentimentStrategy(getSentimentService()),
];
```

**5.3.3 Cấu hình family group trong API request:**

Khi trader bấm "Run Discovery", frontend gửi payload `generatorConfig`:

```json
POST /api/search/start
{
  "algorithmId": "domain_guided",
  "symbolId": "BTCUSDT",
  "timeframe": "1h",
  "maxCandidates": 30,
  "algorithm": "domain_guided",
  "generatorConfig": {
    "familyGroups": [
      { "name": "trend",      "families": ["TREND"] },
      { "name": "momentum",   "families": ["MOMENTUM"] },
      { "name": "structure",  "families": ["STRUCTURE"] },
      { "name": "sentiment",  "families": ["SENTIMENT"] }
    ],
    "mode": "EXHAUSTIVE"
  }
}
```

> **Trước Bước 9:** payload không có group `sentiment` → Generator chỉ pick từ 3 group → composite chỉ có MA/RSI/SR (nếu 3 group) hoặc MA/RSI (nếu 2 group).
>
> **Sau Bước 9:** payload có group `sentiment` → Generator pick `NewsSentimentStrategy` cho group đó.

## 5.4 Postconditions

| #   | Điều kiện                                                                                                  | Cách kiểm tra                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | `StrategyRegistry.has("strategy.news_sentiment") === true`                                                 | Unit test: `expect(registry.has(...)).toBe(true)`                                                                         |
| 2   | `DomainGuidedGenerator` sinh candidate có `config.components` chứa `strategyId: "strategy.news_sentiment"` | Test generator với 4 family groups → assert candidate                                                                     |
| 3   | SearchRun mới chứa candidate composite có 4 thành phần: MA + RSI + SR + Sentiment                          | Query DB: `SELECT * FROM candidate_strategies WHERE config->'components' @> '[{"strategyId":"strategy.news_sentiment"}]'` |
| 4   | UI hiển thị "Candidates tested: N (with Sentiment)" trong SearchRun detail                                 | Sau khi backtest xong, kiểm tra component breakdown                                                                       |

## 5.5 Acceptance Criteria

- [ ] AC-9.1: `NewsSentimentStrategy` được register vào StrategyRegistry khi `bootstrapStrategies()` chạy.
- [ ] AC-9.2: Class này KHÔNG vi phạm FR-015/AC-01 (Plugin Architecture): không cần sửa SearchService/BacktestWorker.
- [ ] AC-9.3: `analyze(ctx)` trả về 1 trong 3 giá trị `BUY | SELL | HOLD` (FR-017).
- [ ] AC-9.4: `analyze(ctx)` chỉ phụ thuộc `SentimentSummary`, không truy cập DB trực tiếp (BR "Strategy không được truy cập Database trực tiếp").
- [ ] AC-9.5: Parameter `threshold` được Generator sample hợp lệ (PASS `validateParameters`).

---

# 5B. LoopOrchestrator — Continuous Loop với Pause/Resume (BỔ SUNG SAU CLARIFY)

## 5B.1 Lý do cần LoopOrchestrator

Khi phân tích 6 yêu cầu ngầm định:

1. **Multi-worker** → phải có orchestrator spawn N workers qua BullMQ.
2. **Retry on failure** → phải có orchestrator theo dõi failure và re-queue.
3. **Pause loop** → phải có thứ đang chạy liên tục để pause.
4. **Resume loop** → orchestrator phải nhớ state khi pause để resume đúng chỗ.
5. **Monitor progress** → orchestrator phải emit event liên tục về tiến trình.
6. **Swap search algorithm** → orchestrator phải có endpoint đổi algorithm không cần restart.

Trader-triggered flow không thỏa mãn (3), (4). Cần **background process** chạy liên tục — đó là `LoopOrchestrator`.

## 5B.2 State Machine

```text
                  ┌──────────────┐
                  │     IDLE     │  ← initial state sau khi boot
                  └──────┬───────┘
                         │ startLoop()
                         ▼
       ┌─────────────────────────────────────┐
       │             RUNNING                 │
       │                                     │
       │  while (state === RUNNING):         │
       │    iteration = new SearchRun(config)│
       │    await iteration.done             │
       │    await LeaderboardUpdated         │
       │    cooldown(30s)                    │
       │    emit "LoopIterationCompleted"    │
       │    if maxIterations reached: stop   │
       └──────┬──────────────────────┬───────┘
              │                      │
    pauseLoop()│                      │stopLoop()
              ▼                      ▼
       ┌──────────────┐       ┌──────────────┐
       │    PAUSED    │       │    STOPPED   │
       └──────┬───────┘       └──────────────┘
              │ resumeLoop()
              └─── back to RUNNING (giữ nguyên iteration counter)
```

| State     | Cho phép hành động                       | Event publish                                                                            |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `IDLE`    | `startLoop`                              | `LoopStarted`                                                                            |
| `RUNNING` | `pauseLoop`, `stopLoop`, `setAlgorithm`  | `LoopIterationStarted`, `LoopIterationCompleted`, `LoopProgress`, `LoopAlgorithmChanged` |
| `PAUSED`  | `resumeLoop`, `stopLoop`, `setAlgorithm` | `LoopPaused`, `LoopResumed`                                                              |
| `STOPPED` | `startLoop`                              | `LoopStopped`                                                                            |

## 5B.3 API endpoints

| Method | Path                  | Body                                                                                       | Effect                                                                                                             |
| ------ | --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/api/loop/start`     | `{ algorithm, symbol, timeframe, maxCandidates, maxIterations, familyGroups, cooldownMs }` | IDLE → RUNNING                                                                                                     |
| `POST` | `/api/loop/pause`     | `{}`                                                                                       | RUNNING → PAUSED                                                                                                   |
| `POST` | `/api/loop/resume`    | `{}`                                                                                       | PAUSED → RUNNING                                                                                                   |
| `POST` | `/api/loop/stop`      | `{}`                                                                                       | \* → STOPPED (kết thúc current iteration, không trigger iteration mới)                                             |
| `GET`  | `/api/loop/status`    | —                                                                                          | `{ state, currentIteration, totalIterations, currentSearchRunId, startedAt, pausedDurationMs, algorithm, config }` |
| `PUT`  | `/api/loop/algorithm` | `{ algorithmId, generatorConfig }`                                                         | Hot-swap — áp dụng cho iteration TIẾP THEO, không ảnh hưởng iteration hiện tại                                     |
| `GET`  | `/api/loop/progress`  | —                                                                                          | `{ iteration, candidatesGenerated, candidatesEvaluated, currentLeaderboardTop, elapsedMs, etaMs }`                 |

## 5B.4 Persistence của state

State của loop lưu ở **Redis** (để orchestrator có thể restart không mất state):

```text
Redis key                              | Value type    | TTL
---------------------------------------|---------------|--------
loop:state                             | RUNNING/...   | none
loop:config                            | JSON          | none
loop:current_iteration                 | INT           | none
loop:total_iterations                  | INT           | none
loop:current_search_run_id             | STRING        | none
loop:paused_at                         | ISO timestamp | expire sau 7 ngày
loop:paused_duration_ms                | BIGINT        | expire sau 7 ngày
```

## 5B.5 Multi-worker coordination

```text
LoopOrchestrator
       │
       │  enqueue 1 job per candidate
       ▼
BullMQ Queue: "backtest" (Redis)
       │
       ├────▶ BacktestWorker #1 (process.Pid X)
       ├────▶ BacktestWorker #2 (process.Pid Y)
       ├────▶ BacktestWorker #3 (process.Pid Z)
       └────▶ BacktestWorker #4 (process.Pid W)
                │
                │  BullMQ retry policy:
                │   attempts: 3
                │   backoff: exponential (1s, 5s, 30s)
                │
                │  failed 3 lần?
                ▼
           Dead Letter Queue "backtest:dlq"
                │
                ▼
           LoopOrchestrator nhận event "JobFailedPermanently"
                │
                │  quyết định:
                │    - log + continue (skip candidate)
                │    - hoặc pause loop để trader xử lý
                ▼
           emit "LoopWorkerFailed" event
```

## 5B.6 Retry policy

| Failure type                             | Retry strategy                         | Sau retry                        |
| ---------------------------------------- | -------------------------------------- | -------------------------------- |
| Transient (network, timeout)             | Auto retry, 3 lần, exponential backoff | Re-queue hoặc DLQ                |
| Validation (parameter invalid)           | Không retry                            | Log + emit `CandidateRejected`   |
| Strategy bug (exception trong `analyze`) | Retry 1 lần, nếu vẫn fail thì DLQ      | DLQ + `LoopWorkerFailed`         |
| Infrastructure (Redis down, DB down)     | Pause loop tự động                     | `LoopAutoPaused(reason="infra")` |

## 5B.7 Progress monitoring events

```ts
// Emit mỗi 1s trong khi iteration đang chạy
eventBus.publish("LoopProgress", {
  loopId: "main",
  state: "RUNNING",
  currentIteration: 12,
  totalIterations: 100,
  currentSearchRunId: "run-abc",
  candidatesGenerated: 850,
  candidatesBacktested: 832,
  candidatesEvaluated: 820,
  leaderboardTopScore: 87.3,
  elapsedMs: 4_500_000,
  estimatedRemainingMs: 12_000_000,
  workersBusy: 3,
  workersIdle: 1,
  workersOffline: 0,
});
```

Frontend subscribe `LoopProgress` qua WebSocket → hiển thị:

- Progress bar (candidatesEvaluated / candidatesGenerated)
- ETA
- Worker pool status (3 busy, 1 idle)
- Pause/Resume button enabled khi state ∈ {RUNNING, PAUSED}

## 5B.8 Acceptance Criteria cho LoopOrchestrator

- [ ] AC-L1: `LoopOrchestrator` chạy như 1 process riêng (PM2/systemd) hoặc 1 module long-running, KHÔNG bị kill khi request HTTP kết thúc.
- [ ] AC-L2: Khi `POST /api/loop/start`, hệ thống tự động trigger iteration đầu tiên trong vòng 5s.
- [ ] AC-L3: Sau khi 1 iteration hoàn thành (SearchRun DONE + LeaderboardUpdated), iteration tiếp theo tự động start sau `cooldownMs` (mặc định 30s).
- [ ] AC-L4: `POST /api/loop/pause` dừng trigger iteration mới, nhưng KHÔNG kill iteration hiện tại đang chạy.
- [ ] AC-L5: `POST /api/loop/resume` tiếp tục từ iteration kế tiếp, iteration counter giữ nguyên.
- [ ] AC-L6: `PUT /api/loop/algorithm` đổi `algorithmId` cho iteration tiếp theo, iteration hiện tại chạy đến hết với algorithm cũ.
- [ ] AC-L7: Khi 1 BacktestWorker fail vĩnh viễn (3 lần retry), event `LoopWorkerFailed` được emit, loop KHÔNG dừng (chỉ skip candidate đó).
- [ ] AC-L8: `GET /api/loop/status` trả về state hiện tại trong < 100ms (đọc Redis).
- [ ] AC-L9: Sau khi restart process (ví dụ crash), LoopOrchestrator tự phục hồi state từ Redis và tiếp tục loop (nếu trước đó RUNNING).
- [ ] AC-L10: Multi-worker pool: ít nhất 4 BacktestWorker instances chạy song song khi deploy production.

## 5B.9 Implementation tasks (NEW)

| #   | Task                                                | File mới / sửa                                                       | Effort       |
| --- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| 1   | Tạo `LoopOrchestrator` class                        | `backend/src/modules/loop/LoopOrchestrator.ts`                       | L (2-3 ngày) |
| 2   | State machine implementation                        | `backend/src/modules/loop/state-machine.ts`                          | M            |
| 3   | Redis state persistence                             | `backend/src/modules/loop/loop-state.repository.ts`                  | S            |
| 4   | `BullMQBacktestQueue` thay thế in-memory            | `backend/src/modules/backtest/infrastructure/BullMQBacktestQueue.ts` | L            |
| 5   | Retry policy + DLQ cho worker                       | `backend/src/modules/backtest/infrastructure/WorkerRetryPolicy.ts`   | M            |
| 6   | Worker pool scaling (PM2 hoặc Docker)               | `ecosystem.config.js`                                                | S            |
| 7   | API endpoints (`start/pause/resume/stop/algorithm`) | `backend/src/modules/loop/presentation/loop.routes.ts`               | M            |
| 8   | Frontend Loop Control UI                            | `frontend/src/pages/LoopControl.tsx`                                 | M            |
| 9   | Loop progress event publishing                      | `LoopOrchestrator.ts`                                                | S            |
| 10  | WebSocket subscription cho frontend                 | `backend/src/modules/loop/presentation/loop.gateway.ts`              | S            |

## 5B.10 Tóm tắt quan hệ giữa các loop

```text
IDLE
  │
  │ [POST /api/loop/start]
  ▼
RUNNING  ◀──────────────┐
  │                       │
  │ iteration N            │ [POST /api/loop/resume]
  │   SearchService ───────┤
  │   → BullMQ             │
  │   → N Workers          │
  │   → Evaluator          │
  │   → Leaderboard        │
  │   cooldown(30s)        │
  │ iteration N+1          │
  │ ...                    │
  │ iteration K            │
  │ [POST /api/loop/pause]│
  ▼                       │
PAUSED ────────────────────┘

[POST /api/loop/stop] bất cứ lúc nào → STOPPED
```

Mỗi iteration trong RUNNING là một L2 (Pipeline Loop) hoàn chỉnh, tạo SearchRun mới, chạy qua 5 module, cập nhật Leaderboard.

---

# 6. Đặc tả chi tiết Bước 10 — Re-run Loop với Search Space đã mở rộng

## 6.1 Goal

Sau Bước 9, Trader muốn **chạy lại pipeline** để sinh candidate mới có kèm Sentiment, sau đó backtest + eval + rank → cập nhật Leaderboard.

## 6.2 Cách kích hoạt

**Phương án A — Thủ công (Bước 10 MVP):**

Trader trên frontend:

1. Vào `/strategy/:id` (đã có config timeframe, coin).
2. Bấm **"Run Discovery"** lần nữa với `maxCandidates = 52` (như demo).
3. Frontend gửi request mới tới `POST /api/search/start` với `generatorConfig.familyGroups` chứa group `sentiment`.
4. Backend tạo **SearchRun mới** với `id` mới → bắt đầu L2 từ đầu.

Code frontend xử lý (`Strategy.tsx:159`):

```tsx
const result = await startSearch({
  algorithmId: selectedAlgorithmId,
  symbolId: selectedSymbolId,
  timeframe: lastConfig.timeframe,
  maxCandidates, // VD: 52
  algorithm: algorithmCode,
  generatorConfig: {
    familyGroups: [
      { name: "trend", families: ["TREND"] },
      { name: "momentum", families: ["MOMENTUM"] },
      { name: "structure", families: ["STRUCTURE"] },
      { name: "sentiment", families: ["SENTIMENT"] }, // ← Bước 9 đã thêm
    ],
    mode: "EXHAUSTIVE",
  },
});
navigate(`/search/${encodeURIComponent(result.searchRunId)}`);
```

**Phương án B — Tự động (mở rộng tương lai):**

Backend có thể đăng ký subscriber `LeaderboardUpdated` để tự động khởi tạo SearchRun mới. Đây là cách L3 trở thành **closed loop**, nhưng **không thuộc MVP**.

```ts
// Pseudo-code (KHÔNG implement cho MVP)
eventBus.subscribe("LeaderboardUpdated", async (payload) => {
  if (autoLoopEnabled && shouldRestart(payload)) {
    await searchService.startSearch({
      ...lastConfig,
      generatorConfig: withSentimentFamily(lastConfig.generatorConfig),
    });
  }
});
```

## 6.3 Sequence chi tiết Bước 10

```text
Bước 10.1: Trader bấm "Run Discovery" lần 2 (có sentiment)
            │
            ▼
Bước 10.2: Frontend gọi POST /api/search/start
            payload: { ..., generatorConfig.familyGroups: [..., sentiment] }
            │
            ▼
Bước 10.3: SearchService.createSearch() → INSERT SearchRun row (id mới)
            publish "SearchStarted" với searchRunId mới
            │
            ▼
Bước 10.4: DomainGuidedGenerator.generate()
            ┌──────────────────────────────────────────────────┐
            │ L1 loop:                                         │
            │   for each combination of {trend, momentum,      │
            │                                  structure,       │
            │                                  sentiment}:     │
            │     composite = MA(weight=0.25) +                │
            │                  RSI(weight=0.25) +               │
            │                  SR(weight=0.25) +                │
            │                  Sentiment(weight=0.25)           │
            │     persist candidate                             │
            │     enqueue backtest job                          │
            │   until 52 candidates hoặc shouldStop             │
            └──────────────────────────────────────────────────┘
            publish "SearchCompleted" khi xong L1
            │
            ▼
Bước 10.5: BacktestWorker xử lý song song từng candidate
            Mỗi candidate:
              - load candles cho BTCUSDT/1h
              - MA.analyze() → BUY/HOLD/SELL
              - RSI.analyze() → BUY/HOLD/SELL
              - SR.analyze() → BUY/HOLD/SELL
              - Sentiment.analyze() → BUY/HOLD/SELL (từ summary)
              - WeightedCombiner.combine() → tín hiệu cuối
              - simulate trades với fixed position size
              - persist trades[]
              - publish "BacktestCompleted"
            │
            ▼
Bước 10.6: EvaluationWorker.subscribe("BacktestCompleted")
            - tính Return, WinRate, MDD, NumTrades
            - tính OverallScore = 0.4*Return + 0.3*WinRate + 0.3*(1-MDD)
            - persist BacktestResult
            - publish "StrategyEvaluated"
            │
            ▼
Bước 10.7: LeaderboardService.subscribe("StrategyEvaluated")
            - recompute top-10
            - upsert LeaderboardEntry
            - publish "LeaderboardUpdated"
            │
            ▼
Bước 10.8: Frontend nhận WS "LeaderboardUpdated"
            - bảng Leaderboard render lại
            - Toast: "Search completed: 52 candidates evaluated"
            │
            ▼
            KẾT THÚC L2 (lần 2)
```

## 6.4 Kết quả kỳ vọng

| Metric                                       | Trước Bước 9                            | Sau Bước 10                                    |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Số family group trong search space           | 3 (TREND, MOMENTUM, STRUCTURE)          | 4 (thêm SENTIMENT)                             |
| Số candidate composite phân biệt             | C(1,1) × C(1,1) × C(1,1) = N1 × N2 × N3 | N1 × N2 × N3 × N4 (N4 = số cấu hình Sentiment) |
| Có candidate có sentiment không              | Không                                   | Có                                             |
| Leaderboard có composite với Sentiment không | Không                                   | Có thể                                         |

Với 4 group, mỗi group 1 strategy, EXHAUSTIVE mode sinh 1 candidate. Tăng `maxCandidates` để có nhiều combination khác nhau (weight khác nhau, threshold khác nhau).

## 6.5 Acceptance Criteria

- [ ] AC-10.1: SearchRun mới được tạo với `id` khác SearchRun trước.
- [ ] AC-10.2: Tất cả candidate của SearchRun mới có `config.components` chứa `strategyId: "strategy.news_sentiment"` (vì EXHAUSTIVE + 4 groups = 1 group sentiment bắt buộc).
- [ ] AC-10.3: BacktestWorker chạy `NewsSentimentStrategy.analyze()` mà không lỗi (inject SentimentService đúng).
- [ ] AC-10.4: Leaderboard cập nhật < 3s sau khi `BacktestCompleted` cuối cùng (FR-046).
- [ ] AC-10.5: SearchRun có thể bị dừng bất kỳ lúc nào (FR-025) — nút "Stop" trên `/search/:id` hoạt động.

---

# 7. Câu hỏi thường gặp & Giải đáp

## 7.1 "Loop là gì, có phải tự chạy ngầm không?"

**Trả lời:** Loop có 4 tầng (xem §2.2). Tầng **L3 (Loop Lifecycle)** là **continuous background loop** do `LoopOrchestrator` điều khiển. Trader chỉ bấm **"Start Loop"** 1 lần, hệ thống tự chạy mãi cho tới khi trader pause hoặc stop.

| Tầng   | Loại                                 | Tự động?            |
| ------ | ------------------------------------ | ------------------- |
| L1     | Generator lặp nội bộ                 | Có                  |
| L2     | 1 SearchRun qua 5 module             | Có                  |
| **L3** | **Orchestrator liên tục trigger L2** | **Có — continuous** |
| L4     | Trader bấm "Run Discovery" ad-hoc    | Thủ công            |

Sự tồn tại của nút **Pause/Resume Loop** chỉ có ý nghĩa khi L3 đang chạy nền. Nếu L3 là manual, thì nút pause không có đối tượng để áp dụng.

## 7.2 "Có phải Gemini chọn lại combination không?"

**Trả lời:** Không. Hiện tại Gemini **CHƯA** tham gia vào vòng lặp chọn strategy. Gemini chỉ có 2 vai trò:

1. `GeminiSentimentAnalyzer.analyzeText()` — phân tích sentiment tin tức.
2. (Tương lai) Có thể dùng để gợi ý parameter — chưa implement.

Việc chọn combination là của `DomainGuidedGenerator`, hoàn toàn deterministic (không có AI/LLM).

## 7.3 "Sentiment sau khi phân tích xong thì làm gì?"

**Trả lời (hiện tại):**

1. `SentimentService.handleNewsCollected()` lưu record vào bảng `sentiments`.
2. Publish event `SentimentAnalyzed` lên EventBus.
3. Frontend nhận event, cập nhật widget "BTC News — Positive: 42%, Neutral: 38%, Negative: 20%".
4. **Không có gì khác xảy ra.** Sentiment là dead-end nếu không có Bước 9.

**Trả lời (sau Bước 9, 10):**

1. Sentiment được `NewsSentimentStrategy.analyze()` đọc qua `getSentimentSummary(symbol, lookbackHours)`.
2. Tóm tắt `averageScore ∈ [-1, 1]` được chuyển thành Signal:

- `score > threshold` → BUY (mạnh yếu theo score)
- `score < -threshold` → SELL
- ngược lại → HOLD

3. Signal này được `WeightedCombiner` tổng hợp với các strategy khác trong composite.
4. Composite được backtest → đánh giá → xếp hạng cùng các candidate khác.

## 7.4 "Tại sao cần family group SENTIMENT riêng?"

**Trả lời:** Vì `DomainGuidedGenerator` ghép 1 strategy từ MỖI group. Nếu không có group SENTIMENT, sentiment không bao giờ xuất hiện trong composite. Tên group chỉ là label; giá trị `families: ["SENTIMENT"]` quyết định Generator sẽ pick strategy nào từ `StrategyRegistry` để điền vào.

## 7.5 "Có thể chạy 2 strategy cùng family không?"

**Trả lời:** Không trong cùng 1 candidate. Mỗi family group pick **đúng 1** strategy. Đây là ràng buộc của `DomainGuidedGenerator.buildCompositeCandidate()`. Nếu muốn 2 strategy cùng family (VD: MA + EMA đều TREND), cần tạo 2 family group riêng:

```json
[
  { "name": "trend_a",   "families": ["TREND"] },
  { "name": "trend_b",   "families": ["TREND"] },
  ...
]
```

Hoặc mở rộng `CombinationConfig` để cho phép multi-pick — ngoài MVP scope.

---

# 8. Implementation Checklist

## 8.1 Backend (must-have cho Bước 9, 10)

| #   | Task                                                                | File                                                                            | Effort   |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| 1   | Tạo `NewsSentimentStrategy`                                         | `backend/src/modules/strategy/strategies/NewsSentimentStrategy.ts`              | M (3-4h) |
| 2   | Register vào bootstrap                                              | `backend/src/modules/strategy/strategies/bootstrap.ts`                          | XS       |
| 3   | Inject `SentimentService` qua DI container                          | `backend/src/modules/sentiment/sentiment.container.ts`                          | S        |
| 4   | Thêm method `getSentimentSummaryForBacktest(symbol, lookbackHours)` | `backend/src/modules/sentiment/application/sentiment.service.ts`                | S        |
| 5   | Seed row `strategy.news_sentiment` vào DB                           | `backend/prisma/seed.ts`                                                        | XS       |
| 6   | Prisma migration nếu cần field mới                                  | `backend/prisma/schema.prisma`                                                  | S        |
| 7   | Unit test cho `NewsSentimentStrategy.analyze()`                     | `backend/src/modules/strategy/strategies/__tests__/`                            | M        |
| 8   | Test composite với 4 group                                          | `backend/src/modules/search/generators/__tests__/DomainGuidedGenerator.test.ts` | S        |

## 8.2 Frontend

| #   | Task                                                                                      | File                                  | Effort |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| 1   | Hiển thị checkbox "Include Sentiment" trong Search Space Builder                          | `frontend/src/pages/Strategy.tsx`     | S      |
| 2   | Gắn `familyGroups` vào payload `startSearch()`                                            | `frontend/src/pages/Strategy.tsx:159` | XS     |
| 3   | Render "Sentiment" badge trên candidate card                                              | `frontend/src/pages/Search.tsx`       | S      |
| 4   | Hiển thị "Sentiment: +0.42" trong Strategy detail                                         | `frontend/src/pages/Strategy.tsx`     | S      |
| 5   | Verify link tới NewsCrawler trên Strategy detail "NewsSentimentStrategy — Chiến lược mẫu" | `frontend/src/pages/NewsCrawler.tsx`  | XS     |

## 8.3 Testing & Validation

| #   | Task                                                                                                             | Type             |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | Unit test generator với 4 family groups → đếm candidate có sentiment                                             | Unit             |
| 2   | Integration test: POST /api/search/start với family group sentiment → SearchRun DONE → DB có candidate sentiment | Integration      |
| 3   | E2E: Trader flow: Discovery → Strategy → Run Discovery (with sentiment) → Search lifecycle → Leaderboard         | E2E (Playwright) |
| 4   | Manual demo: mở `localhost:5173`, làm theo 10 bước của demo, screenshot mỗi bước                                 | Manual           |

---

# 9. Risks & Mitigations

| #   | Risk                                                                                         | Impact                               | Mitigation                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `NewsSentimentStrategy.analyze()` bị null khi `getSentimentSummary()` chưa có data (DB rỗng) | Backtest crash                       | Trả `HOLD` với `confidence = 0` khi `summary.totalNews === 0`                                                                                                                                      |
| R2  | BacktestWorker chạy sentiment nhiều lần cho mỗi candle → chậm                                | Perf                                 | Cache `getSentimentSummary(symbol, lookbackHours)` per backtest job — 1 lần fetch đầu, dùng cho toàn bộ candles                                                                                    |
| R3  | `DomainGuidedGenerator` không dedupe khi weight giống nhau                                   | Duplicate candidates                 | Đã có `compositeFingerprint()` ở line 124 của generator — sort theo strategyId trước khi hash. Tuy nhiên chỉ dedupe theo strategy set, không dedupe theo weight. Có thể thêm `weight fingerprint`. |
| R4  | API không expose `familyGroups`                                                              | Frontend không thể bật/tắt sentiment | Sửa `POST /api/search/start` payload schema trong `search.routes.ts:148`                                                                                                                           |
| R5  | BacktestQueue dùng in-memory map, không phải BullMQ                                          | Vi phạm TC-05, không scale           | Tạo `BullMQBacktestQueue` thay thế, xem §10                                                                                                                                                        |

---

# 10. Known Architectural Debt (liên quan đến Loop)

| #   | Vấn đề                                                           | FR/AC vi phạm                                                                        | Cần sửa                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | `BacktestQueue` dùng in-memory Map, không phải BullMQ            | TC-05                                                                                | Refactor sang `BullMQBacktestQueue`                        |
| 2   | **KHÔNG có LoopOrchestrator** — loop phải trader-trigger         | FR-024 (ngụ ý auto-loop) + AC-L1..L10 (mới)                                          | Implement `LoopOrchestrator` theo §5B                      |
| 3   | `NewsSentimentStrategy` chưa tồn tại                             | FR-018 mở rộng, FR-022                                                               | Bước 9                                                     |
| 4   | UI Strategy page chỉ pick 1 strategy, không multi-pick composite | FR-018                                                                               | Bước 10 (UI cải tiến)                                      |
| 5   | Leaderboard sortable chưa hoạt động                              | FR-047                                                                               | Sửa `Leaderboard.tsx`                                      |
| 6   | Event `WorkerStatusChanged` chưa publish                         | FR-075                                                                               | Sửa `BacktestWorker.ts` thành publish event khi start/stop |
| 7   | Không có Pause/Resume/Stop API cho loop                          | Yêu cầu ngầm định (multi-worker + retry + monitor + pause + resume + algorithm swap) | Implement §5B.3 endpoints                                  |
| 8   | Không có retry policy cho worker                                 | Yêu cầu ngầm định                                                                    | Implement §5B.6                                            |
| 9   | Không có algorithm hot-swap                                      | Yêu cầu ngầm định                                                                    | Implement §5B.3 `PUT /api/loop/algorithm`                  |

---

# 11. Phụ lục

## 11.1 Traceability

| Yêu cầu                                      | Đặc tả liên quan                                                    |
| -------------------------------------------- | ------------------------------------------------------------------- |
| FR-018 Configure Composite Strategy          | §5.3.3, §6.2                                                        |
| FR-019 Weighted Combination                  | §6.3 (WeightedCombiner)                                             |
| FR-020 Generate Candidate                    | §3.1, §6.3                                                          |
| FR-022 Domain-guided Search                  | §5.3.3 (family groups), §6.3                                        |
| FR-023 Configure Search Parameters           | §5.3.3 (payload)                                                    |
| FR-024 Start Search                          | §6.2 (POST /api/search/start)                                       |
| FR-025 Stop Search                           | §6.5 AC-10.5                                                        |
| FR-028 Publish Search Event                  | §3.1 (EventBus), §4                                                 |
| FR-046 Real-time Leaderboard Update          | §6.3 (Bước 10.7), §6.5 AC-10.4                                      |
| FR-056 Analyze Sentiment                     | §5.2 (Precondition)                                                 |
| FR-060 Independent Sentiment Service         | §5.3.1 (DI qua constructor)                                         |
| AC-01 Plugin Architecture                    | §5.3.1 (Strategy interface)                                         |
| AC-04 Replaceable Search Algorithm           | §3.1 (StrategyGenerator interface)                                  |
| AC-05 Backtesting tách khỏi Strategy         | §6.3 (BacktestWorker gọi Strategy.analyze, không if-else theo loại) |
| AC-08 Sentiment Service độc lập              | §5.3.1 (inject qua interface `SentimentServiceLike`)                |
| AC-10 Module giao tiếp qua abstraction/event | §3.1 (EventBus)                                                     |

## 11.2 Glossary

- **EXHAUSTIVE mode** — `DomainGuidedGenerator` sinh TẤT CẢ combination có thể từ family groups (deterministic).
- **RANDOM_SAMPLE mode** — `DomainGuidedGenerator` sample ngẫu nhiên theo `maxCombinations` (không deterministic).
- **stop condition** — Predicate kiểm tra xem SearchRun có nên dừng không: `maxCandidates` đạt, user bấm Stop, timeout, lỗi.
- **back-pressure** — Khi queue đầy, generator tạm dừng emit candidate.

## 11.3 Tóm tắt 1 câu

> **Bước 9** = đăng ký `NewsSentimentStrategy` với `family: "SENTIMENT"` vào `StrategyRegistry` để nó xuất hiện trong search space.
> **Bước 10** = trader bấm "Run Discovery" lần 2 với `familyGroups` chứa `SENTIMENT` → Generator sinh candidate mới có 4 thành phần → Backtest → Eval → Leaderboard cập nhật.

---

_End of document_
