# Continuous Strategy Loop — Design Document

**Module:** Search & Backtest Loop (Module 9)  
**Owner:** Trí (Search) + Huy (Backtest) + Nhân (Evaluation & Leaderboard)  
**Status:** Design Phase  
**Priority:** P0 (Core Feature)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Loop Execution Model](#3-loop-execution-model)
4. [Job State Management](#4-job-state-management)
5. [BullMQ Worker Implementation](#5-bullmq-worker-implementation)

---

## 1. Overview

Continuous Strategy Loop là **trái tim** của hệ thống — một vòng lặp tự động sinh, test, đánh giá và xếp hạng strategies cho đến khi tìm ra strategy tốt nhất hoặc đạt điều kiện dừng.

### 1.1 Goals

- **Automation**: User chỉ cần click "Start Search", hệ thống tự động tìm kiếm strategies
- **Scalability**: Xử lý song song nhiều backtest qua BullMQ workers
- **Observability**: Realtime progress updates qua WebSocket
- **Control**: Multiple stop conditions (time, count, improvement threshold, user stop)
- **Reproducibility**: Mỗi search run có thể replay với kết quả giống hệt

---

## 2. Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────────┐
│                    CONTINUOUS STRATEGY LOOP                            │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                      MAIN LOOP                                │   │
│   │                                                               │   │
│   │   ┌─────────────────────────────────────────────────────┐   │   │
│   │   │                                                      │   │   │
│   │   ▼                                                      │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║   ① StrategyGenerator   ║                           │   │   │
│   │  ║   • RandomGenerator      ║                           │   │   │
│   │  ║   • DomainGuidedGen      ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║ generate()                               │   │   │
│   │              ║ emit("StrategyGenerated")                │   │   │
│   │              ▼                                           │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║  ② BullMQ: backtest     ║                           │   │   │
│   │  ║        queue             ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║ dispatch job                             │   │   │
│   │              ▼                                           │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║  ③ BacktestWorker       ║                           │   │   │
│   │  ║    • Load strategy       ║                           │   │   │
│   │  ║    • Load candles        ║                           │   │   │
│   │  ║    • Simulate trades     ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║ persist Experiment + Trades              │   │   │
│   │              ║ emit("BacktestCompleted")                │   │   │
│   │              ▼                                           │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║  ④ EvaluationWorker     ║                           │   │   │
│   │  ║    • Calculate metrics   ║                           │   │   │
│   │  ║      - Return, WinRate   ║                           │   │   │
│   │  ║      - MaxDrawdown       ║                           │   │   │
│   │  ║      - Sharpe Ratio      ║                           │   │   │
│   │  ║      - OverallScore      ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║ persist BacktestResult                   │   │   │
│   │              ║ emit("StrategyEvaluated")                │   │   │
│   │              ▼                                           │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║  ⑤ LeaderboardService   ║                           │   │   │
│   │  ║    • Recompute top-K     ║                           │   │   │
│   │  ║    • Upsert entry        ║                           │   │   │
│   │  ║    • Broadcast update    ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║ emit("LeaderboardUpdated")               │   │   │
│   │              ▼                                           │   │   │
│   │  ╔══════════════════════════╗                           │   │   │
│   │  ║  ⑥ SearchController     ║                           │   │   │
│   │  ║    • Check stop cond.    ║                           │   │   │
│   │  ║    • Decide continue?    ║                           │   │   │
│   │  ╚═══════════╦══════════════╝                           │   │   │
│   │              ║                                           │   │   │
│   │         ┌────╨────┐                                     │   │   │
│   │         │ STOP?   │                                     │   │   │
│   │    ┌────┴────┬────┴────┐                               │   │   │
│   │    │         │         │                               │   │   │
│   │   NO        YES       PAUSED                           │   │   │
│   │    │         │         │                               │   │   │
│   │    │         │         └─► wait for resume             │   │   │
│   │    │         │                                          │   │   │
│   │    │         └──► emit("SearchCompleted")              │   │   │
│   │    │                  persist final stats              │   │   │
│   │    │                  notify Frontend                  │   │   │
│   │    │                  EXIT LOOP                        │   │   │
│   │    │                                                    │   │   │
│   │    └──────────────────────────────────────────────────────┘   │
│   │                    (loop back to ①)                           │
│   └───────────────────────────────────────────────────────────────┘
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Loop Execution Model

### 3.1 Sequential Loop Design

Loop 1 generate 10,000 candidates → chạy hết 10,000 backtest → xong hết → mới sang Loop 2

```text
LOOP 1
Generate C1
Generate C2
...
Generate C10,000
        ↓
     BullMQ
        ↓
 ┌──────┼──────┐
 W1     W2     W3 ...
 ↓      ↓      ↓
BT     BT     BT
        ↓
 completed / failed
        ↓
  10,000 jobs terminal
        ↓
====================
     LOOP 1 DONE
====================
        ↓
     LOOP 2
```

### 3.2 Loop Flow

```text
Loop 1
   ↓
Generate 1000 candidates
   ↓
Enqueue 1000 jobs
   ↓
Workers xử lý parallel
   ↓
All jobs completed
   ↓
Loop 2
```

---

## 4. Job State Management

### 4.1 Job Schema

Mỗi candidate/job có trạng thái:

**BacktestJob**

- `id`
- `loopId`
- `candidateId`
- `status`

### 4.2 Job Status

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

### 4.3 Database State

```text
Loop #1
target = 10,000

Job 1       COMPLETED
Job 2       COMPLETED
Job 3       FAILED
Job 4       COMPLETED
...
Job 10000   COMPLETED
```

### 4.4 Loop Completion Check

Khi cần xác định loop done:

```sql
SELECT COUNT(*)
FROM BacktestJobs
WHERE LoopId = @loopId
AND Status IN ('COMPLETED', 'FAILED', 'CANCELLED');
```

**Rule:**

```text
If terminal_count == target_count
Then LOOP 1 DONE
```

Đây là **source of truth**.

---

## 5. BullMQ Worker Implementation

### 5.1 Worker Setup

```typescript
import { Worker } from "bullmq";

const worker = new Worker(
  "backtest",
  async (job) => {
    console.log("Received job:", job.id);

    // Đây chính là function xử lý job
    await runBacktest(job.data);

    return {
      success: true,
    };
  },
  {
    connection: redisConnection,
  }
);
```

### 5.2 Backtest Processor

```typescript
async function runBacktest(data) {
  // load strategy
  // load candles
  // simulate trades
  // save result
}
```

### 5.3 Worker Architecture

```text
  Redis
                   │
             "backtest" queue
                   │
                   │ job
                   ▼
        ┌─────────────────────┐
        │ Backtest Worker     │
        │ Node.js process     │
        │                     │
        │ Worker("backtest")  │
        └──────────┬──────────┘
                   │
                   ▼
          processor function
                   │
                   ▼
             runBacktest()
```

---

**End of Document**
