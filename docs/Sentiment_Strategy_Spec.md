# Sentiment Strategy — Specification

**Version:** 1.0
**Status:** Draft
**Owner:** Nhân
**Last Updated:** 2026-09-03
**Related:** `Loop_Specification.md §5`, `docs/Crypto Strategy Lab – Đồ án cuối kỳ.md §30`

---

# 1. Mục đích

Tài liệu này đặc tả cách **biến Sentiment từ dữ liệu phụ thành một Strategy thật**, tích hợp vào hệ thống composite strategy giống như MA, RSI, Bollinger.

Sau khi đọc xong tài liệu này, người mới có thể hiểu được:

- Tại sao kiến trúc này **mở được** sang Sentiment mà không phải sửa lại core.
- Cách viết một `Strategy` mới từ đầu.
- Cách `Generator` tự động nhặt Strategy mới vào composite.
- Cách `Backtester` chạy nó trên dữ liệu lịch sử.

---

# 2. Vấn đề nền tảng: Tại sao cần biến Sentiment thành Strategy?

## 2.1 Bối cảnh

Trader muốn trade BTC. Có 2 loại tín hiệu:

| Loại | Nguồn | Ví dụ |
|------|-------|-------|
| **Technical Analysis (TA)** | Dữ liệu giá (candles) | MA cắt MA → BUY, RSI < 30 → BUY |
| **Information Analysis (IA)** | Dữ liệu tin tức | Tin tích cực dồn dập → BTC sắp pump |

Hệ thống hiện chỉ làm TA. Nếu muốn thêm IA, có 2 cách:

**Cách 1 — Hardcode (KHÔNG tốt):**

```ts
// ❌ Nhét logic sentiment vào BacktestWorker
if (sentiment > 0.7 && maBullish) {
  return BUY;
}
```

→ Vi phạm Open/Closed, coupling cao, khó thêm nguồn IA khác.

**Cách 2 — Plugin Architecture (TỐT):**

Tạo class `NewsSentimentStrategy implements Strategy` → register vào `StrategyRegistry` → Generator tự động nhặt.

→ Zero modification to core code. Mở rộng sang Social Media Sentiment, On-chain Data, Macro Indicators... đều làm theo cùng pattern.

## 2.2 Ý nghĩa kiến trúc

> **Kiến trúc không còn giới hạn ở Technical Analysis. Có thể mở rộng sang Information Analysis, On-chain Analysis, v.v.**

Đây chính là minh chứng cho **FR-015 / AC-01 — Plugin Architecture**.

---

# 3. Interface `Strategy` — Khối xây dựng cốt lõi

Mọi strategy trong hệ thống (MA, RSI, BB, SR, **NewsSentiment**, ...) đều implement interface này:

```typescript
// backend/src/modules/strategy/domain/Strategy.ts

export type StrategyFamily = "TREND" | "MOMENTUM" | "VOLATILITY" | "STRUCTURE" | "SENTIMENT";

export interface Strategy {
  readonly id: string;                            // "strategy.news_sentiment"
  readonly name: string;                          // "News Sentiment"
  readonly family: StrategyFamily;                // ← PHÂN LOẠI
  readonly description: string;
  readonly parameterSpec: Record<string, ParamSpec>;
  readonly requiredHistory: number;

  defaultParameters(): StrategyParameters;
  validateParameters(p: StrategyParameters): { ok: boolean; errors: string[] };
  analyze(ctx: StrategyContext): Promise<Signal>;
}
```

**Đặc điểm cốt lõi:**
- Method `analyze(ctx)` nhận `StrategyContext` (chứa candle, parameters, symbol, ...), trả về `Signal` (BUY/SELL/HOLD).
- Strategy **KHÔNG biết** nó đang chạy trong Backtest, Paper Trading, hay Live Trading.
- Strategy **KHÔNG truy cập DB trực tiếp** — chỉ nhận data qua `ctx`.

Vì cùng implement 1 interface, **Generator, Backtester, Evaluator, Leaderboard đều không phân biệt** được strategy nào đang chạy. Đây là sức mạnh của plugin architecture.

---

# 4. Bước 1 — Tạo `NewsSentimentStrategy`

## 4.1 Mục tiêu

Một strategy đọc sentiment trung bình của N giờ gần nhất → trả tín hiệu BUY/SELL/HOLD.

## 4.2 Class implementation

```typescript
// backend/src/modules/strategy/strategies/NewsSentimentStrategy.ts

import type { Strategy } from "../domain/Strategy";
import type { Signal } from "../domain/Signal";
import type { StrategyContext, StrategyParameters, StrategyCandle } from "../domain/StrategyContext";
import { ParamSpec } from "../domain/ParamSpec";

/**
 * Strategy lấy tín hiệu từ Sentiment của tin tức.
 *
 * Ví dụ rule đơn giản:
 *   - avgSentiment trong N giờ > threshold  → BUY
 *   - avgSentiment trong N giờ < -threshold → SELL
 *   - ngược lại                                → HOLD
 *
 * KHÔNG đọc DB trực tiếp. Nhận SentimentSummary qua constructor (DI).
 */
export class NewsSentimentStrategy implements Strategy {
  public readonly id = "strategy.news_sentiment";
  public readonly name = "News Sentiment";
  public readonly family = "SENTIMENT" as const;
  public readonly requiredHistory = 1;
  public readonly description =
    "Phát tín hiệu BUY/SELL dựa trên sentiment trung bình của N giờ tin tức gần nhất.";

  // ── Khai báo parameter space để Generator biết cách sample ──
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
      max: 168,             // tối đa 1 tuần
      step: 1,
      defaultValue: 24,
    }),
    minNewsCount: new ParamSpec({
      kind: "INTEGER",
      min: 1,
      max: 50,
      step: 1,
      defaultValue: 3,
    }),
  };

  public defaultParameters(): StrategyParameters {
    return { threshold: 0.2, lookbackHours: 24, minNewsCount: 3 };
  }

  public validateParameters(p: StrategyParameters) {
    const errors: string[] = [];
    if (typeof p.threshold !== "number" || p.threshold < 0 || p.threshold > 1) {
      errors.push("threshold phải là số trong [0, 1]");
    }
    if (typeof p.lookbackHours !== "number" || p.lookbackHours < 1 || p.lookbackHours > 168) {
      errors.push("lookbackHours phải là số nguyên trong [1, 168]");
    }
    if (typeof p.minNewsCount !== "number" || p.minNewsCount < 1) {
      errors.push("minNewsCount phải ≥ 1");
    }
    return { ok: errors.length === 0, errors };
  }

  // ── Inject dependency qua constructor (KHÔNG new bên trong) ──
  public constructor(private readonly sentimentService: SentimentServiceLike) {}

  /**
   * Method chính — được BacktestWorker gọi mỗi candle.
   * Trả về Signal dựa trên sentiment hiện tại.
   */
  public async analyze(ctx: StrategyContext): Promise<Signal> {
    const params = ctx.parameters as {
      threshold: number;
      lookbackHours: number;
      minNewsCount: number;
    };

    const summary = await this.sentimentService.getSentimentSummaryForBacktest(
      ctx.symbol,
      params.lookbackHours,
    );

    // Quá ít tin → không giao dịch
    if (summary.totalNews < params.minNewsCount) {
      return { kind: "HOLD", strength: 0, at: ctx.candle.closeTime };
    }

    // Sentiment mạnh → tín hiệu mạnh
    const score = summary.averageScore; // [-1, 1]

    if (score > params.threshold) {
      return {
        kind: "BUY",
        strength: Math.min(1, score),
        at: ctx.candle.closeTime,
      };
    }

    if (score < -params.threshold) {
      return {
        kind: "SELL",
        strength: Math.min(1, Math.abs(score)),
        at: ctx.candle.closeTime,
      };
    }

    return { kind: "HOLD", strength: 0, at: ctx.candle.closeTime };
  }
}

/**
 * Interface tối thiểu mà Strategy cần.
 * Implementation thật là SentimentService trong sentiment module.
 */
export interface SentimentServiceLike {
  getSentimentSummaryForBacktest(
    symbol: string,
    lookbackHours: number,
  ): Promise<SentimentSummary>;
}

export interface SentimentSummary {
  symbol: string;
  totalNews: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  averageScore: number;     // [-1, 1]
  windowStart: Date;
  windowEnd: Date;
}
```

## 4.3 Giải thích chi tiết

| Thành phần | Vai trò | Tại sao cần |
|-----------|---------|-------------|
| `family = "SENTIMENT"` | Đánh dấu đây là strategy dòng cảm xúc | Generator dùng `family` để pick vào đúng family group |
| `parameterSpec` | Khai báo không gian tham số | Generator biết sinh thử threshold = 0.1, 0.15, 0.2... |
| `validateParameters()` | Đảm bảo tham số hợp lệ | Tránh Generator sample ra bộ tham số vô nghĩa |
| `analyze(ctx)` | Hàm chính — tín hiệu | BacktestWorker gọi mỗi candle, kết quả gộp vào composite |
| `private sentimentService` | Dependency qua constructor | Strategy không tự gọi DB, tuân thủ BR |

---

# 5. Bước 2 — Đăng ký vào StrategyRegistry

```typescript
// backend/src/modules/strategy/strategies/bootstrap.ts

import { NewsSentimentStrategy } from "./NewsSentimentStrategy";
import { getSentimentService } from "../../sentiment/application/sentiment.container";

export const BUILT_IN_STRATEGIES: ReadonlyArray<Strategy> = [
  new MovingAverageStrategy(),
  new RsiStrategy(),
  new BollingerBandsStrategy(),
  new SupportResistanceStrategy(),
  // ↓↓↓ Bước 9 — chỉ cần thêm 1 dòng này ↓↓↓
  new NewsSentimentStrategy(getSentimentService()),
];

export function bootstrapStrategies(): void {
  const registry = getStrategyRegistry();
  for (const strategy of BUILT_IN_STRATEGIES) {
    registry.register(strategy);
  }
}
```

**Điều kỳ diệu:** Từ lúc này, bất kỳ chỗ nào trong hệ thống gọi `StrategyRegistry.list()`, nó sẽ trả về `[MA, RSI, BB, SR, NewsSentiment]`. Generator không biết mình đang có thêm 1 strategy mới.

---

# 6. Bước 3 — Generator tự động nhặt (Domain-guided Search)

Trader gửi request với `familyGroups` chứa SENTIMENT:

```json
POST /api/search/start
{
  "algorithmId": "domain_guided",
  "symbolId": "BTCUSDT",
  "timeframe": "1h",
  "maxCandidates": 30,
  "generatorConfig": {
    "familyGroups": [
      { "name": "trend",     "families": ["TREND"] },
      { "name": "momentum",  "families": ["MOMENTUM"] },
      { "name": "structure", "families": ["STRUCTURE"] },
      { "name": "sentiment", "families": ["SENTIMENT"] }
    ],
    "mode": "EXHAUSTIVE"
  }
}
```

## 6.1 Quy trình Generator xử lý

Trong `DomainGuidedGenerator.generate()`:

```
familyGroups = [
  { name: "trend",     families: ["TREND"] },     ← pick 1 strategy
  { name: "momentum",  families: ["MOMENTUM"] },  ← pick 1 strategy
  { name: "structure", families: ["STRUCTURE"] }, ← pick 1 strategy
  { name: "sentiment", families: ["SENTIMENT"] }, ← pick 1 strategy MỚI
]
```

Mỗi lần lặp L1, Generator:
1. Từ group "trend" → pick ngẫu nhiên 1 strategy family TREND → `MA(period=20)`
2. Từ group "momentum" → pick 1 family MOMENTUM → `RSI(period=14)`
3. Từ group "structure" → pick 1 family STRUCTURE → `SR(lookback=50)`
4. **Từ group "sentiment" → pick 1 strategy family SENTIMENT → `NewsSentiment(threshold=0.2, hours=24)`**

→ Ghép thành composite: `MA(20) + RSI(14) + SR(50) + NewsSentiment(0.2, 24h)`

## 6.2 Không cần sửa code Generator

`DomainGuidedGenerator.ts` không cần thay đổi. Nó chỉ làm việc với `family groups` — không quan tâm strategy cụ thể nào nằm trong group đó.

```typescript
// DomainGuidedGenerator.ts — KHÔNG CẦN SỬA
const components = groups.map((group, idx) => {
  const space = spaceByFamily.get(group.families[0]!);
  return {
    strategyId: space.strategyId,  // ← Có thể là "strategy.ma" hoặc "strategy.news_sentiment"
    weight: 1 / groups.length,
    position: idx,
  };
});
```

---

# 7. Bước 4 — Backtester chạy nó (KHÔNG cần sửa)

```typescript
// Trong BacktestService.runBacktest()
for (let i = 0; i < candles.length; i++) {
  const candle = candles[i];
  const ctx = { candle, parameters, symbol, timeframe };

  // Gọi strategy.analyze() — composite strategy tự gọi 4 strategy con
  const signal = await compositeStrategy.analyze(ctx);
  //   composite gọi: MA.analyze(), RSI.analyze(), SR.analyze(), NewsSentiment.analyze()
  //   rồi gộp 4 signal bằng WeightedCombiner

  // Mở/đóng lệnh dựa trên signal
}
```

**Quan trọng:** `BacktestService` không hề biết `NewsSentiment` tồn tại. Nó chỉ gọi `strategy.analyze()`. Strategy composite tự quyết định gọi strategy con nào.

---

# 8. Bước 5 — SentimentService cung cấp data (DI)

```typescript
// backend/src/modules/sentiment/application/sentiment.service.ts

export class SentimentService {
  /**
   * API cho Strategy đọc trong Backtest.
   * Trả về sentiment summary trong khoảng lookbackHours.
   */
  public async getSentimentSummaryForBacktest(
    symbol: string,
    lookbackHours: number,
  ): Promise<SentimentSummary> {
    const since = new Date(Date.now() - lookbackHours * 3600 * 1000);

    const records = await this.repository.findSentiments({
      symbol,
      since,
    });

    if (records.length === 0) {
      return {
        symbol,
        totalNews: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        averageScore: 0,
        windowStart: since,
        windowEnd: new Date(),
      };
    }

    const positive = records.filter((r) => r.label === "POSITIVE").length;
    const neutral = records.filter((r) => r.label === "NEUTRAL").length;
    const negative = records.filter((r) => r.label === "NEGATIVE").length;

    const averageScore =
      records.reduce((acc, r) => acc + r.score, 0) / records.length;

    return {
      symbol,
      totalNews: records.length,
      positiveCount: positive,
      neutralCount: neutral,
      negativeCount: negative,
      averageScore,
      windowStart: since,
      windowEnd: new Date(),
    };
  }
}
```

DI container:

```typescript
// backend/src/modules/sentiment/sentiment.container.ts
let instance: SentimentService | null = null;

export function getSentimentService(): SentimentService {
  if (!instance) {
    instance = new SentimentService(getSentimentRepository());
  }
  return instance;
}
```

---

# 9. Bước 6 — Verification & Acceptance

## 9.1 Test cases

| # | Test | Expected |
|---|------|----------|
| TC-1 | `StrategyRegistry.has("strategy.news_sentiment")` sau bootstrap | `true` |
| TC-2 | Unit test `NewsSentimentStrategy.analyze()` với summary score = 0.8 | trả `BUY`, strength = 0.8 |
| TC-3 | Unit test với summary score = -0.8 | trả `SELL`, strength = 0.8 |
| TC-4 | Unit test với summary score = 0.05 (dưới threshold) | trả `HOLD` |
| TC-5 | Unit test với summary `totalNews = 0` | trả `HOLD`, không crash |
| TC-6 | Integration test: SearchRun với 4 family groups → DB có candidate composite có 4 components (1 SENTIMENT) | PASS |
| TC-7 | Integration test: Backtest chạy candidate composite 4 strategy không lỗi | PASS |

## 9.2 Acceptance Criteria

- [ ] **AC-S1**: `NewsSentimentStrategy` được register vào registry khi bootstrap chạy.
- [ ] **AC-S2**: Class này KHÔNG vi phạm FR-015 (Plugin Architecture) — không cần sửa Generator, Backtester, Evaluator, Leaderboard.
- [ ] **AC-S3**: `analyze(ctx)` trả về 1 trong 3 giá trị `BUY | SELL | HOLD` (FR-017).
- [ ] **AC-S4**: `analyze(ctx)` chỉ phụ thuộc `SentimentService`, không truy cập DB trực tiếp (BR-015).
- [ ] **AC-S5**: Parameter `threshold`, `lookbackHours`, `minNewsCount` được Generator sample hợp lệ (PASS `validateParameters`).
- [ ] **AC-S6**: DomainGuidedGenerator sinh candidate có `config.components` chứa `strategyId: "strategy.news_sentiment"` khi family group SENTIMENT được khai báo.
- [ ] **AC-S7**: UI hiển thị "Sentiment: +0.42" trên candidate detail.

---

# 10. So sánh với Technical Strategy

| Khía cạnh | MA / RSI / BB / SR | NewsSentiment |
|-----------|-------------------|---------------|
| **Nguồn data** | Candles (giá) | News + Sentiment DB |
| **Mỗi candle tính** | Tính lại indicator từ candles | Đọc sentiment summary trong lookback window |
| **Latency** | Rất nhanh (chỉ tính toán) | Hơi chậm (1 query DB) |
| **Cache** | Không cần | Nên cache per backtest job (R2 trong Risk) |
| **Null safety** | Không cần | Phải handle `totalNews = 0` |
| **Family** | TREND / MOMENTUM / VOLATILITY / STRUCTURE | SENTIMENT |

→ Về bản chất là giống nhau (cùng implement interface), chỉ khác data source.

---

# 11. Mở rộng tương lai

Cùng pattern này, có thể thêm:

| Strategy mới | Family | Data source |
|--------------|--------|-------------|
| `TwitterSentimentStrategy` | SENTIMENT | Twitter API + sentiment |
| `OnChainWhaleStrategy` | ONCHAIN | Whale alert transactions |
| `MacroIndicatorStrategy` | MACRO | Fed rates, CPI, DXY |
| `FundingRateStrategy` | DERIVATIVES | Futures funding rate |
| `OptionsGreeksStrategy` | DERIVATIVES | Options chain |

Chỉ cần:
1. Implement `Strategy` interface.
2. Register vào `StrategyRegistry`.
3. Khai báo family group mới trong request.

**Zero modification to core pipeline.**

---

# 12. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R1 | `getSentimentSummary()` trả về rỗng (DB chưa có data) | Backtest crash hoặc trả signal sai | Return `HOLD` khi `totalNews = 0` |
| R2 | Worker gọi sentiment N lần cho N candle | Chậm | Cache 1 lần đầu, dùng cho toàn bộ candle trong backtest |
| R3 | Sentiment DB bị xóa giữa chừng | Backtest không deterministic | Snapshot sentiment summary khi start backtest |
| R4 | Sentiment analyzer thay đổi (Gemini → LLM khác) | Kết quả backtest cũ không reproducible | Ghi `analyzerVersion` vào `sentiment_records` |
| R5 | Strategy cần data ngoài candles (lookbackHours) | Phải map thời gian candle → thời gian thật | `ctx.candle.closeTime` cung cấp timestamp |

---

# 13. Tóm tắt 1 câu

> **Tạo 1 class implement `Strategy` interface → register vào `StrategyRegistry` → khai báo 1 family group mới trong `familyGroups` → hệ thống tự động ghép vào composite với mọi strategy khác, không cần sửa bất kỳ module core nào.**

Đây là sức mạnh của **Plugin Architecture + Domain-guided Search + Composite Strategy** kết hợp.

---

_End of document_
