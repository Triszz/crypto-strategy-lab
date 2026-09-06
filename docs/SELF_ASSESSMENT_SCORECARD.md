# Phiếu Tự Đánh Giá Đồ Án Cuối Kỳ - Crypto Strategy Lab


---

## 1. Thông Tin Chung

- **Tên đề tài**: Crypto Strategy Lab - Nền tảng phân tích, kết hợp, tìm kiếm và đánh giá chiến lược giao dịch Cryptocurrency theo thời gian thực
- **Lớp / Học phần**: Kiến trúc Phần mềm (KTPM)
- **Thang tự đánh giá**: 0 - 4 (0 = Chưa có/không chạy; 1 = Rất thiếu; 2 = Đạt một phần; 3 = Đạt yêu cầu cơ bản và demo được; 4 = Tốt/vượt yêu cầu, có minh chứng rõ)
- **Tổng điểm tự đánh giá**: 100 / 100
- **Điểm quy đổi**: 10 / 10

---

## 2. Bảng Tổng Hợp Điểm Theo Nhóm Tiêu Chí

| STT | Nhóm Tiêu Chí | Điểm Tối Đa | Mức Tự Đánh Giá (0 - 4) | Điểm Đạt |
|---|---|---|---|---|
| 1 | **A. Kiến trúc phần mềm** | 35 | 4 / 4 | 35 |
| 2 | **B. Chức năng yêu cầu** | 40 | 4 / 4 | 40 |
| 3 | **C. Hồ sơ & tài liệu** | 15 | 4 / 4 | 15 |
| 4 | **D. Demo & độ tin cậy** | 5 | 4 / 4 | 5 |
| 5 | **E. Mở rộng có giá trị** | 5 | 4 / 4 | 5 |
| | **TỔNG ĐIỂM** | **100** | | **100** |

---

## 3. Bảng Chi Tiết Tự Đánh Giá 24 Tiêu Chí

### Nhóm A: Kiến Trúc Phần Mềm (35 Điểm)

| STT | Tiêu Chí | Yêu Cầu Cần Đạt / Minh Chứng Nối Trực Tiếp | Mức Đánh Giá (0 - 4) | Link Mã Nguồn & Tài Liệu Minh Chứng |
|---|---|---|---|---|
| 1 | **Khả năng mở rộng Strategy / Plugin** | Có abstraction/interface Strategy (`IStrategy`); thêm strategy mới với thay đổi tối thiểu; không hard-code if/else theo từng strategy. | 4 | Code: `backend/src/modules/strategy/domain/IStrategy.ts`<br>Doc: [ADR.md](./ADR.md#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine) |
| 2 | **Tách trách nhiệm & giảm coupling** | Strategy chỉ xử lý logic strategy; tách Market Data, Backtest, Evaluator, Ranking, News, Sentiment, UI; tránh God Service và business logic ở frontend. | 4 | Code: `backend/src/modules/`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#3-component-responsibilities--boundaries-c4-level-3) |
| 3 | **Khả năng thay thế thành phần** | Có thể thay Random Search -> Domain-guided/Genetic, Binance -> provider khác, hoặc sentiment model mà không phải viết lại các module phía sau. | 4 | Code: `backend/src/modules/search/generators/`<br>Doc: [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) |
| 4 | **Scalability & Performance** | Giải thích/triển khai hướng mở rộng từ hàng trăm lên nhiều candidate; có queue/worker BullMQ; có đo thời gian backtest. | 4 | Code: `backend/src/modules/backtest/infrastructure/`<br>Doc: [ADR.md](./ADR.md#adr-004-xử-lý-chạy-ngầm-hàng-đợi-backtest-bằng-bullmq-và-redis-outbox-pattern) |
| 5 | **Realtime & Multi-timeframe** | Realtime flow rõ ràng (stream/WebSocket); tối đa 4 chart, mỗi chart đổi timeframe độc lập (1m, 5m, 15m, 1h); frontend không phụ thuộc trực tiếp schema Binance. | 4 | Code: `backend/src/modules/market-data/realtime/CandleStreamer.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#5-realtime-flow-socketio-stream) |
| 6 | **Reliability & Observability** | Có xử lý disconnect/retry/reconnect, lỗi worker/job; theo dõi trạng thái loop, số candidate, thời gian backtest, job lỗi, Top-1 hiện tại. | 4 | Code: `backend/src/modules/news/infrastructure/CircuitBreaker.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#3-component-responsibilities--boundaries-c4-level-3) |
| 7 | **Reproducibility & Versioning** | Strategy/experiment có version; một kết quả leaderboard truy vết được dataset, timeframe, parameters, strategy version và trade result. | 4 | Code: `backend/src/modules/strategy/domain/StrategyVersion.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#34-backtesting-engine) |

---

### Nhóm B: Chức Năng Yêu Cầu (40 Điểm)

| STT | Tiêu Chí | Yêu Cầu Cần Đạt / Minh Chứng Nối Trực Tiếp | Mức Đánh Giá (0 - 4) | Link Mã Nguồn & Tài Liệu Minh Chứng |
|---|---|---|---|---|
| 8 | **Market Data & Candlestick** | Lấy historical + realtime data từ Binance; candlestick/volume hiển thị đúng; cập nhật liên tục và ổn định. | 4 | Code: `backend/src/modules/market-data/`<br>Doc: [README.md](../README.md#3-tổng-quan-kiến-trúc-hệ-thống-architecture-overview) |
| 9 | **Strategy Engine >= 4 strategy** | Có ít nhất 4 strategy đơn lẻ (MA, RSI, Bollinger Bands, Support/Resistance, SMC/Wyckoff, SentimentStrategy) theo contract tín hiệu chuẩn BUY/SELL/HOLD. | 4 | Code: `backend/src/modules/strategy/strategies/`<br>Doc: [ADR.md](./ADR.md#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine) |
| 10 | **Composite Strategy** | Kết hợp được nhiều strategy; có quy tắc xử lý weighted combination và giải thích được bằng công thức toán học. | 4 | Code: `backend/src/modules/strategy/combination/WeightedCombinationStrategy.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#6-strategy-flow--plugin-system) |
| 11 | **Backtesting Engine** | Giả lập giao dịch trên historical data; sinh được entry/exit/trades; tách backtest khỏi strategy implementation. | 4 | Code: `backend/src/modules/backtest/application/BacktestService.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#34-backtesting-engine) |
| 12 | **Strategy Evaluation** | Đầy đủ Return %, Win Rate %, Max Drawdown %, Sharpe Ratio, Profit Factor, Total Trades; evaluator tách riêng. | 4 | Code: `backend/src/modules/backtest/domain/FinancialMetrics.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#7-search--backtest-flow) |
| 13 | **Strategy Search & Stop Condition** | Có Random Search & Domain-guided Search; generate -> backtest -> evaluate -> rank; có điều kiện dừng rõ ràng (số candidate/thời gian/no-improvement). | 4 | Code: `backend/src/modules/search/application/SearchService.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#7-search--backtest-flow) |
| 14 | **Leaderboard Top-K** | Hiển thị Top-K strategy; rank/sort theo metric hoặc overall score; candidate mới tự động cập nhật leaderboard qua Socket.IO. | 4 | Code: `backend/src/modules/leaderboard/application/LeaderboardService.ts`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#35-leaderboard-module) |
| 15 | **Visualization Strategy & Trade** | Chart hiển thị Buy/Sell, Entry/Exit và indicator liên quan; xem được trade detail và highlight từng giao dịch. | 4 | Code: `frontend/src/components/charts/TradingChart.tsx`<br>Doc: [README.md](../README.md#4-hướng-dẫn-kịch-bản-demo-demo-walkthrough) |
| 16 | **News Collector** | Có pipeline collect -> normalize -> store; provider abstraction; NewsItem có title, content/source, publishedAt, relatedCoins, url. | 4 | Code: `backend/src/modules/news/application/NewsService.ts`<br>Doc: [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) |
| 17 | **Sentiment Analysis** | Phân tích POSITIVE/NEUTRAL/NEGATIVE & Sentiment Score (-1.0 đến +1.0); kết quả lưu được; tích hợp sentiment thành SentimentStrategy. | 4 | Code: `backend/src/modules/sentiment/application/SentimentService.ts`<br>Doc: [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) |

---

### Nhóm C: Hồ Sơ & Tài Liệu (15 Điểm)

| STT | Tiêu Chí | Yêu Cầu Cần Đạt / Minh Chứng Nối Trực Tiếp | Mức Đánh Giá (0 - 4) | Link Mã Nguồn & Tài Liệu Minh Chứng |
|---|---|---|---|---|
| 18 | **Source code + README** | Repository hoàn chỉnh; README có Install, Run, Architecture Overview, Demo Walkthrough, permissions note. | 4 | Code: Project Repository Root<br>Doc: [README.md](../README.md) |
| 19 | **Architecture Document** | Có đầy đủ 7 sơ đồ Mermaid: System Context, Container decomposition, Component responsibilities, Data Flow, Realtime Flow, Strategy Flow, Search/Backtest Flow. | 4 | Code: `docs/ARCHITECTURE_DOCUMENT.md`<br>Doc: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md) |
| 20 | **Architectural Decision Records (ADR)** | Có 6 bản ghi ADR chính và lý do: Modular Monolith, Realtime Socket.IO, Plugin Architecture, BullMQ Queue Outbox, Gemini Circuit Breaker, Continuous Loop. | 4 | Code: `docs/ADR.md`<br>Doc: [ADR.md](./ADR.md) |
| 21 | **Video/demo & link minh chứng** | Link demo video, báo cáo, hướng dẫn cài đặt hoạt động; minh chứng được gắn trực tiếp vào ma trận đối chiếu. | 4 | Code: `docs/RUBRIC_VERIFICATION_MATRIX.md`<br>Doc: [RUBRIC_VERIFICATION_MATRIX.md](./RUBRIC_VERIFICATION_MATRIX.md) |

---

### Nhóm D: Demo & Độ Tin Cậy (5 Điểm)

| STT | Tiêu Chí | Yêu Cầu Cần Đạt / Minh Chứng Nối Trực Tiếp | Mức Đánh Giá (0 - 4) | Link Mã Nguồn & Tài Liệu Minh Chứng |
|---|---|---|---|---|
| 22 | **Demo end-to-end** | Trình diễn luồng khép kín: Dữ liệu realtime -> Chọn strategy -> Search -> Backtest -> Evaluate -> Leaderboard -> Click strategy -> Visualize -> News/Sentiment. | 4 | Code: `frontend/src/App.tsx`<br>Doc: [README.md](../README.md#4-hướng-dẫn-kịch-bản-demo-demo-walkthrough) |
| 23 | **Scenario kiến trúc / xử lý lỗi** | Chứng minh các kịch bản: Thêm strategy mới không đụng code cũ; Đổi thuật toán search; Gemini API lỗi tự ngắt ngắt cầu dao (Circuit Breaker) sử dụng Fallback Engine; Trace version strategy. | 4 | Code: `backend/src/modules/news/infrastructure/CircuitBreaker.ts`<br>Doc: [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) |

---

### Nhóm E: Mở Rộng Có Giá Trị (5 Điểm)

| STT | Tiêu Chí | Yêu Cầu Cần Đạt / Minh Chứng Nối Trực Tiếp | Mức Đánh Giá (0 - 4) | Link Mã Nguồn & Tài Liệu Minh Chứng |
|---|---|---|---|---|
| 24 | **Phần nâng cao có mục tiêu kiến trúc rõ** | Xây dựng phân hệ Continuous Strategy Loop Engine chạy tự động 6 giai đoạn khép kín; Domain-guided Search Heuristics; BullMQ Task Worker Queue; Gemini LLM AI Sentiment Analysis với Circuit Breaker. | 4 | Code: `backend/src/modules/loop/`<br>Doc: [ADR.md](./ADR.md#adr-006-xây-dựng-cơ-chế-continuous-strategy-loop-chạy-tự-động-khép-kín) |
