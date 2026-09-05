# Hướng dẫn Đấu nối EventBus & BullMQ Queue — Module Backtest

Tài liệu này tổng hợp chi tiết tất cả các **Sự kiện (EventBus Messages)** và **Queue Job Data** mà Module Backtest đang **Publish (Phát ra)** và **Subscribe/Consume (Lắng nghe)**.

Dành cho các thành viên phụ trách **Search (Trí)**, **Evaluation (Nhân)**, và **Leaderboard (Nhân)** đấu nối tích hợp.

---

## 1. Các sự kiện Module Backtest PHÁT RA (Publish Events)

### 1.1 `BacktestStarted`
- **Thời điểm phát**: Khi `BacktestWorker` tiếp nhận Job từ Queue và bắt đầu chạy mô phỏng.
- **Payload Schema**:
```typescript
{
  jobId: string;
  params: {
    candidateId?: string;
    symbol: string;
    timeframe: string;
    strategyName: string;
    initialCapital: number;
    feePercent: number;
    slippageBps: number;
    fromTime?: number;
    toTime?: number;
  };
  startedAt: string; // ISO 8601 Timestamp
}
```

### 1.2 `BacktestCompleted` (Dành cho Evaluator & Leaderboard)
- **Thời điểm phát**: Khi Backtest hoàn thành thành công.
- **Payload Schema**:
```typescript
{
  jobId: string;
  experimentId: string; // UUID của Experiment lưu trong DB
  candidateId?: string;  // UUID của CandidateStrategy (nếu chạy từ Search)
  symbol: string;        // Ví dụ: "BTCUSDT"
  timeframe: string;     // Ví dụ: "1h"
  strategyName: string;  // Tên chiến lược
  metrics: {
    initialCapital: number;
    finalCapital: number;
    totalReturn: number;
    winRate: number;
    maxDrawdown: number;
    numTrades: number;
    numWinningTrades: number;
    numLosingTrades: number;
    sharpeRatio: number;
  };
  trades: Array<{
    id: string;
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    direction: "LONG" | "SHORT";
    profitLoss: number;
    profitLossPct: number;
    exitReason: string;
  }>;
  completedAt: string; // ISO 8601 Timestamp
}
```

### 1.3 `BacktestFailed` / `CandidateFailed`
- **Thời điểm phát**: Khi Backtest thất bại sau 3 lần thử lại (retry).
- **Payload Schema**:
```typescript
{
  jobId: string;
  candidateId?: string;
  error: string;      // Thông báo lỗi chi tiết
  failedAt: string;   // ISO 8601 Timestamp
}
```

### 1.4 `SearchRunCompleted` / `SearchCompleted` (Dành cho LoopOrchestrator)
- **Thời điểm phát**: Khi 100% các candidates của một `SearchRun` đã xử lý xong (trạng thái kết thúc `DONE`, `FAILED`, hoặc `SKIPPED`).
- **Payload Schema**:
```typescript
{
  searchRunId: string;
  finishedCount: number;   // Số candidates đã xử lý hoàn tất
  totalCandidates: number; // Tổng số candidates của SearchRun
  completedAt: string;     // ISO 8601 Timestamp
}
```

---

## 2. Các sự kiện & Queue Job Module Backtest LẮNG NGHE (Subscribe / Consume)

### 2.1 BullMQ Queue: `"backtest"`
- **Tên Job**: `"backtest.run"`
- **Cấu hình Queue**: Retry 3 lần với Exponential Backoff.
- **Payload đẩy vào Queue**:
```typescript
{
  jobId: string;
  params: {
    candidateId?: string;
    symbol?: string;
    timeframe?: string;
    strategyName?: string;
    initialCapital?: number;
    feePercent?: number;
    slippageBps?: number;
    fromTime?: number;
    toTime?: number;
    stopLossPct?: number;
    takeProfitPct?: number;
  }
}
```

---

## 3. Trạng thái Candidate trong Database (`candidate_strategies`)

Mọi Candidate đi qua Module Backtest được cập nhật trạng thái trong Postgres DB như sau:

| Trạng thái | Ý nghĩa |
| --- | --- |
| `PENDING` | Mới sinh từ Search, chuẩn bị đẩy vào Queue |
| `RUNNING` | BacktestWorker đang thực thi mô phỏng nến |
| `DONE` | Backtest xong thành công, đã lưu `Experiment` & `Trades` |
| `FAILED` | Lỗi trong quá trình backtest (thông báo lỗi lưu tại `errorMessage`) |
| `SKIPPED` | Candidate bị bỏ qua do thiếu tham số hoặc không hợp lệ |
