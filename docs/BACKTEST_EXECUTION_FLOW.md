# Tài liệu Luồng Xử Lý Thực Tế & Đối Chiếu Đặc Tả — Module Backtest

Tài liệu giải thích chi tiết **luồng xử lý code thực tế (Execution Flow)** của Module Backtest và kết quả **Đối chiếu & Xác minh (Verification & Validation)** theo đúng các tài liệu đặc tả: `docs/Requirements_Specification.md`, `docs/Solution.md`, `docs/loop.md` và `Loop_Specification.md`.

---

## 1. Sơ đồ Luồng Xử lý Thực tế (Execution Flow)

```text
[HTTP Request / Search Event]
         │
         ▼
[1. BacktestController / SearchExecutionService]
         │
         ▼
[2. BullMQBacktestQueue]
         │ ───► Ghi nhật ký vào bảng Postgres `queue_jobs` (status = WAITING, maxAttempts = 3)
         │ ───► Đẩy Job "backtest.run" vào Redis Queue "backtest"
         ▼
[3. BullMQBacktestWorker (Concurrency = 4)]
         │
         ├──► 3.1. Cập nhật DB: `queue_jobs` (status = RUNNING) & `candidate_strategies` (status = RUNNING)
         ├──► 3.2. Phát event: `BacktestStarted`
         │
         ▼
[4. BacktestService.runBacktest()]
         │
         ├──► 4.1. Resolve Strategy từ `StrategyRegistry` (bootstrap các class Strategy thật)
         ├──► 4.2. getHistoricalCandles():
         │          - Ưu tiên đọc Postgres DB (`prisma.candle.findMany`)
         │          - Nếu DB < 10 nến: Gọi `BinanceRestAdapter.fetchKlines()` cào nến từ Binance REST API với retry 3 lần
         │          - Upsert nến mới vào DB Postgres
         │          - Fallback sang Fixture nến nếu mất mạng
         ├──► 4.3. Backtester.run():
         │          - Duyệt qua từng nến (Candle-by-Candle simulation)
         │          - Gọi `Strategy.analyze(ctx)` -> Tín hiệu BUY / SELL / HOLD
         │          - Tính toán phí giao dịch (feePercent), Trượt giá (slippageBps), Stop Loss / Take Profit
         │          - Tạo danh sách `SimulatedTrade[]` và tính bộ chỉ số Performance Metrics
         └──► 4.4. Save DB: Ghi nhận `Experiment` và danh sách `Trade` vào Postgres DB
         │
         ▼
[5. Xử lý Kết quả trong BullMQBacktestWorker]
         │
         ├──► 5.1. THÀNH CÔNG:
         │          - Cập nhật DB: `queue_jobs` (status = COMPLETED) & `candidate_strategies` (status = DONE)
         │          - Phát event: `BacktestCompleted` (chứa experimentId, metrics, trades)
         │
         ├──► 5.2. THẤT BẠI (Sau 3 lần Retry với Exponential Backoff):
         │          - Cập nhật DB: `queue_jobs` (status = FAILED) & `candidate_strategies` (status = FAILED)
         │          - Phát event: `BacktestFailed` & `CandidateFailed`
         │
         ▼
[6. BacktestCompletionTracker]
         │
         └──► Đếm số Candidate đã kết thúc (DONE, FAILED, SKIPPED).
              Nếu finishedCount === totalCandidates:
                - Cập nhật DB: `SearchRun.status = 'DONE'`
                - Phát event: `SearchRunCompleted` & `SearchCompleted` cho LoopOrchestrator
```

---

## 2. Kết quả Đối chiếu & Xác minh bám sát Đặc tả (Validation Matrix)

| Yêu cầu Đặc tả | Thuộc tính / Chức năng | Trạng thái triển khai | Bằng chứng trong Codebase |
| --- | --- | --- | --- |
| **FR-011** | Mô phỏng giao dịch: Vốn ban đầu, Phí (Fee), Trượt giá (Slippage), StopLoss / TakeProfit, LONG/SHORT | **ĐẠT (100%)** | `Backtester.ts` xử lý đủ LONG/SHORT, trừ phí `feePercent`, tính trượt giá `slippageBps`, thoát lệnh theo `STOP_LOSS`, `TAKE_PROFIT`, `SIGNAL_REVERSAL`, `END_OF_DATA`. |
| **FR-012** | Lấy nến lịch sử & Auto-backfill Binance | **ĐẠT (100%)** | `BacktestService.ts` (`getHistoricalCandles`): Đọc DB Postgres → Cào tự động từ Binance REST API nếu thiếu nến → Upsert DB. |
| **FR-013** | Quản lý Strategy qua Plugin Architecture | **ĐẠT (100%)** | `bootstrap.ts` & `StrategyRegistry.ts`: Đăng ký và nạp tự động các concrete class Strategy (`MovingAverageStrategy`, `RsiStrategy`, `BollingerBandsStrategy`, `SupportResistanceStrategy`). |
| **FR-014** | Xử lý song song qua Queue (BullMQ + Workers) | **ĐẠT (100%)** | `BullMQBacktestQueue.ts` & `BullMQBacktestWorker.ts`: Chạy bất đồng bộ qua Redis Queue `"backtest"`, cấu hình `concurrency: 4`. |
| **FR-015** | Cơ chế Retry Policy & Ghi nhật ký `queue_jobs` | **ĐẠT (100%)** | `BullMQBacktestQueue.ts`: Cấu hình `attempts: 3`, `exponential backoff`. `BullMQBacktestWorker.ts`: Ghi nhận nhật ký trạng thái (`WAITING` → `RUNNING` → `COMPLETED`/`FAILED`) vào bảng `queue_jobs` (chuẩn `docs/Solution.md` §13). |
| **FR-016** | Kiểm tra hoàn tất 100% Candidates của SearchRun | **ĐẠT (100%)** | `BacktestCompletionTracker.ts`: Đếm `finishedCount === totalCandidates` → Cập nhật `SearchRun.status = 'DONE'` và phát event `SearchRunCompleted`. |
| **NFR-004** | Cách ly sự kiện (Event Isolation) & Decoupling | **ĐẠT (100%)** | `EventBus.ts` & `BullMQBacktestWorker.ts`: Mọi sự kiện `BacktestStarted`, `BacktestCompleted`, `SearchRunCompleted` đều được bọc catch block cách ly, không làm sập tiến trình chính. |

---

## 3. Tổng kết Kiểm thử (Test Suite Results)

- **Đã kiểm thử**: `tests/backtest.test.ts` và `tests/backtest-worker.test.ts`.
- **Kết quả**: 9/9 test cases ĐẠT 100%.
- **Đánh giá**: Module Backtest hoạt động đúng thiết kế, sẵn sàng đấu nối với module Search, Evaluator và Leaderboard.
