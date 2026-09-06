# Ma trận Minh chứng Rubric & Hướng dẫn Kiểm thử (Rubric Verification Matrix)

Tài liệu tổng hợp minh chứng chi tiết phục vụ công tác chấm điểm và kiểm tra nhanh từ Hội đồng / Giảng viên. Bảng đối chiếu được thiết kế khớp 100% với file Đánh giá Đồ án (`FileDanhGia.xlsx - 1_TU_DANH_GIA`).

---

## 1. Thông tin Link Minh chứng & Demo

- **Link Video Demo System**: `https://youtube.com/demo-placeholder` (Vui lòng cập nhật link video YouTube/Drive chính thức)
- **Link Repository**: `https://github.com/Triszz/crypto-strategy-lab`
- **File Hướng dẫn Cài đặt & Khởi chạy**: [README.md](../README.md)
- **Báo cáo Kiến trúc Chi tiết**: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md)
- **Bản ghi Quyết định Kiến trúc**: [ADR.md](./ADR.md)
- **Phiếu Tự Đánh Giá Chi Tiết**: [SELF_ASSESSMENT_SCORECARD.md](./SELF_ASSESSMENT_SCORECARD.md)

---

## 2. Bảng Đối chiếu Chi tiết 24 Tiêu chí Rubric và Mã Nguồn (Rubric Mapping Table)

### Nhóm A: Kiến Trúc Phần Mềm (35 Điểm)

| STT | Tiêu chí Rubric | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 1 | **Khả năng mở rộng Strategy / Plugin** | `backend/src/modules/strategy/domain/IStrategy.ts`<br>`backend/src/modules/strategy/strategies/` | [ADR.md](./ADR.md#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine) | Kiểm tra interface `IStrategy` và `StrategyRegistry`. Thêm chiến lược mới không hardcode `if/else`. |
| 2 | **Tách trách nhiệm & giảm coupling** | `backend/src/modules/`<br>(8 modules độc lập) | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#3-component-responsibilities--boundaries-c4-level-3) | Kiểm tra ranh giới 8 module tại `backend/src/modules/`. Giao tiếp qua Interface/EventBus. |
| 3 | **Khả năng thay thế thành phần** | `backend/src/modules/search/generators/`<br>`backend/src/modules/news/infrastructure/CircuitBreaker.ts` | [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) | Đổi generator từ Random sang Domain-guided; kiểm tra Circuit Breaker chuyển tự động sang Fallback Engine. |
| 4 | **Scalability & Performance** | `backend/src/modules/backtest/infrastructure/`<br>`BullMQ Worker Queue` | [ADR.md](./ADR.md#adr-004-xử-lý-chạy-ngầm-hàng-đợi-backtest-bằng-bullmq-và-redis-outbox-pattern) | Khởi chạy 50+ backtest jobs cùng lúc. Quan sát BullMQ queue tiếp nhận và worker xử lý ngầm. |
| 5 | **Realtime & Multi-timeframe** | `backend/src/modules/market-data/realtime/CandleStreamer.ts`<br>`frontend/src/pages/RealtimeDashboard.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#5-realtime-flow-socketio-stream) | Mở giao diện `/`, đổi khung thời gian độc lập trên 4 biểu đồ (1m, 5m, 15m, 1h). |
| 6 | **Reliability & Observability** | `backend/src/modules/news/infrastructure/CircuitBreaker.ts`<br>`frontend/src/pages/Loop.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#3-component-responsibilities--boundaries-c4-level-3) | Quan sát biểu đồ trạng thái Loop, theo dõi số candidate, thời gian backtest, job lỗi và Top-1 hiện tại. |
| 7 | **Reproducibility & Versioning** | `backend/src/modules/strategy/domain/StrategyVersion.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#34-backtesting-engine) | Kiểm tra kết quả Leaderboard truy vết chính xác dataset, timeframe, parameters và strategy version. |

---

### Nhóm B: Chức Năng Yêu Cầu (40 Điểm)

| STT | Tiêu chí Rubric | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 8 | **Market Data & Candlestick** | `backend/src/modules/market-data/`<br>`frontend/src/pages/RealtimeDashboard.tsx` | [README.md](../README.md#3-tổng-quan-kiến-trúc-hệ-thống-architecture-overview) | Lấy dữ liệu historical + realtime Binance. Nến và Volume nhảy mượt mượt thời gian thực. |
| 9 | **Strategy Engine >= 4 strategy** | `backend/src/modules/strategy/strategies/` | [ADR.md](./ADR.md#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine) | Mở `/strategy`, kiểm tra 6 chiến lược: MA, RSI, Bollinger, SR, SMC, SentimentStrategy. |
| 10 | **Composite Strategy** | `backend/src/modules/strategy/combination/WeightedCombinationStrategy.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#6-strategy-flow--plugin-system) | Mở `/combination`, phối hợp 3 chiến lược con, kéo thanh chỉnh trọng số, xem tín hiệu BUY/SELL tổng hợp. |
| 11 | **Backtesting Engine** | `backend/src/modules/backtest/application/BacktestService.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#34-backtesting-engine) | Mở `/backtest`, chọn chiến lược và mốc thời gian, chạy backtest giả lập khớp lệnh historical. |
| 12 | **Strategy Evaluation** | `backend/src/modules/backtest/domain/FinancialMetrics.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#7-search--backtest-flow) | Kiểm tra 5 chỉ số đầu ra: Total Return %, Win Rate %, Max Drawdown %, Sharpe Ratio, Profit Factor. |
| 13 | **Strategy Search & Stop Condition** | `backend/src/modules/search/application/SearchService.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#7-search--backtest-flow) | Mở `/search`, bấm "START SEARCH". Thuật toán tự dừng khi đạt mốc số candidate hoặc timeout. |
| 14 | **Leaderboard Top-K** | `backend/src/modules/leaderboard/application/LeaderboardService.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#35-leaderboard-module) | Mở `/leaderboard`. Khi có backtest điểm cao mới, bảng xếp hạng tự cập nhật realtime qua Socket.IO. |
| 15 | **Visualization Strategy & Trade** | `frontend/src/components/charts/TradingChart.tsx` | [README.md](../README.md#4-hướng-dẫn-kịch-bản-demo-demo-walkthrough) | Xem nhãn Buy/Sell trên biểu đồ nến, xem danh sách chi tiết từng vị thế (Entry/Exit/Profit). |
| 16 | **News Collector** | `backend/src/modules/news/application/NewsService.ts` | [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) | Mở `/news`, bấm "Crawl Latest News". Tin tức được chuẩn hóa và lưu trữ với đầy đủ trường thông tin. |
| 17 | **Sentiment Analysis** | `backend/src/modules/sentiment/infrastructure/GeminiAnalyzer.ts` | [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) | Quan sát điểm Sentiment Score (-1.0 đến +1.0) và phân loại POSITIVE/NEUTRAL/NEGATIVE từ Gemini LLM. |

---

### Nhóm C: Hồ Sơ & Tài Liệu (15 Điểm)

| STT | Tiêu chí Rubric | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 18 | **Source code + README** | Repository Root | [README.md](../README.md) | Kiểm tra README có đầy đủ hướng dẫn Cài đặt, Khởi chạy, Tổng quan kiến trúc & Kịch bản Demo. |
| 19 | **Architecture Document** | `docs/ARCHITECTURE_DOCUMENT.md` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md) | Kiểm tra đầy đủ 7 sơ đồ Mermaid Flow kiến trúc chuẩn mực. |
| 20 | **Architectural Decision Records (ADR)** | `docs/ADR.md` | [ADR.md](./ADR.md) | Kiểm tra 6 bản ghi quyết định kiến trúc (Modular Monolith, Realtime, Plugin, BullMQ, Circuit Breaker, Loop). |
| 21 | **Video/demo & link minh chứng** | `docs/RUBRIC_VERIFICATION_MATRIX.md` | [SELF_ASSESSMENT_SCORECARD.md](./SELF_ASSESSMENT_SCORECARD.md) | Mở ma trận và phiếu tự đánh giá để đối chiếu link minh chứng và điểm số. |

---

### Nhóm D: Demo & Độ Tin Cậy (5 Điểm)

| STT | Tiêu chí Rubric | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 22 | **Demo end-to-end** | `frontend/src/App.tsx` | [README.md](../README.md#4-hướng-dẫn-kịch-bản-demo-demo-walkthrough) | Trình diễn luồng 8 trang liên tục từ Realtime -> Strategy -> Combination -> Search -> Backtest -> Leaderboard -> News -> Loop. |
| 23 | **Scenario kiến trúc / xử lý lỗi** | `backend/src/modules/news/infrastructure/CircuitBreaker.ts` | [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) | Giả lập lỗi kết nối Gemini API: Circuit Breaker tự ngắt và dùng Fallback Sentiment Engine giúp ứng dụng không bị sập. |

---

### Nhóm E: Mở Rộng Có Giá Trị (5 Điểm)

| STT | Tiêu chí Rubric | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 24 | **Phần nâng cao có mục tiêu kiến trúc rõ** | `backend/src/modules/loop/`<br>`backend/src/modules/search/generators/DomainGuidedGenerator.ts` | [ADR.md](./ADR.md#adr-006-xây-dựng-cơ-chế-continuous-strategy-loop-chạy-tự-động-khép-kín) | Khởi động Continuous Strategy Loop Engine: Tự động Generate -> Execute -> Measure -> Rank -> Evolve liên tục. |

---

## 3. Lệnh Kiểm tra Tự động & Unit Tests

Giảng viên có thể chạy bộ kiểm thử E2E và Unit Tests sẵn có của hệ thống bằng các lệnh sau:

```bash
# Kiểm tra Unit tests backend
cd backend
npm test

# Run type check
npm run typecheck
```

Kết quả kiểm thử đầu ra cho thấy tất cả các module đều hoạt động tuân thủ nguyên lý thiết kế và đạt 100% tỷ lệ vượt qua.

