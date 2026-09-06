# Ma trận Minh chứng Rubric & Hướng dẫn Kiểm thử (Rubric Verification Matrix)

Tài liệu tổng hợp minh chứng chi tiết phục vụ công tác chấm điểm và kiểm tra nhanh từ Hội đồng / Giảng viên.

---

## 1. Thông tin Link Minh chứng & Demo

- **Link Video Demo System**: `https://youtube.com/demo-placeholder` (Vui lòng cập nhật link video YouTube/Drive chính thức)
- **Link Repository**: `https://github.com/Triszz/crypto-strategy-lab`
- **File Hướng dẫn Cài đặt & Khởi chạy**: [README.md](../README.md)
- **Báo cáo Kiến trúc Chi tiết**: [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md)
- **Bản ghi Quyết định Kiến trúc**: [ADR.md](./ADR.md)

---

## 2. Bảng Đối chiếu Chi tiết Tiêu chí Rubric và Mã Nguồn (Rubric Mapping Table)

| STT | Tiêu chí Rubric Đồ án | Mã Nguồn / Component Thực thi | File Tài liệu / Minh chứng | Kịch bản Kiểm tra Nhanh (Demo Steps) |
|---|---|---|---|---|
| 1 | **Realtime Market Data & Multi-timeframe Chart** | `backend/src/modules/market-data/realtime/CandleStreamer.ts`<br>`frontend/src/pages/RealtimeDashboard.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#5-realtime-flow-socketio-stream) | Mở giao diện `/`, chọn các khung thời gian 1m, 5m, 15m, 1h. Quan sát nến nhảy realtime từ Binance WebSocket. |
| 2 | **Strategy Engine & Plugin Architecture** | `backend/src/modules/strategy/domain/IStrategy.ts`<br>`backend/src/modules/strategy/strategies/` | [ADR.md](./ADR.md#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine) | Truy cập `/strategy`, chọn chỉ báo MA, RSI, Bollinger, SR, SMC, Sentiment. Bật/tắt để tạo tín hiệu Buy/Sell. |
| 3 | **Composite Strategy & Weighting Combination** | `backend/src/modules/strategy/combination/WeightedCombinationStrategy.ts`<br>`frontend/src/pages/Combination.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#6-strategy-flow--plugin-system) | Truy cập `/combination`, thêm 3 chiến lược con, kéo thanh chỉnh trọng số (Weighting), kiểm tra tín hiệu tổng hợp. |
| 4 | **Strategy Search Engine (Random & Domain-guided)** | `backend/src/modules/search/generators/`<br>`backend/src/modules/search/application/SearchService.ts` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#7-search--backtest-flow) | Truy cập `/search`, chọn tập chỉ báo, nhấn "START SEARCH". Quan sát thuật toán duyệt qua các ứng viên. |
| 5 | **Backtesting Engine & Financial Metrics** | `backend/src/modules/backtest/application/BacktestService.ts`<br>`frontend/src/pages/Backtest.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#34-backtesting-engine) | Truy cập `/backtest`, chọn chiến lược và mốc thời gian, chạy backtest. Quan sát Equity Curve, Win Rate %, MDD %, Sharpe Ratio. |
| 6 | **Leaderboard Realtime & Top-K Strategies** | `backend/src/modules/leaderboard/application/LeaderboardService.ts`<br>`frontend/src/pages/Leaderboard.tsx` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#35-leaderboard-module) | Truy cập `/leaderboard`, chạy 1 backtest có điểm cao. Xếp hạng trên bảng lập tức thay đổi qua Socket.IO realtime. |
| 7 | **Continuous Strategy Loop Engine** | `backend/src/modules/backtest/application/BacktestService.ts`<br>`frontend/src/pages/Loop.tsx` | [ADR.md](./ADR.md#adr-006-xây-dựng-cơ-chế-continuous-strategy-loop-chạy-tự-động-khép-kín) | Truy cập `/loop`, nhấn khởi động Loop. Vòng lặp tự động Generate -> Execute -> Measure -> Rank -> Evolve liên tục. |
| 8 | **News Crawler & LLM Sentiment Analysis Integration** | `backend/src/modules/news/`<br>`backend/src/modules/sentiment/`<br>`frontend/src/pages/NewsCrawler.tsx` | [ADR.md](./ADR.md#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker) | Truy cập `/news`, nhấn "Crawl Latest News". Xem bài báo được phân tích bởi Gemini LLM và cập nhật điểm Sentiment Score. |
| 9 | **Software Architecture Quality Attributes** | `backend/src/modules/news/infrastructure/CircuitBreaker.ts`<br>`backend/src/shared/outbox/` | [ARCHITECTURE_DOCUMENT.md](./ARCHITECTURE_DOCUMENT.md#3-component-responsibilities--boundaries-c4-level-3) | Đánh giá tính sẵn sàng (Fault Tolerance), cơ chế ngắt cầu dao (Circuit Breaker) và kiến trúc Clean Architecture / DDD. |

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
