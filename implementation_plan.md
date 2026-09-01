# Kế hoạch & Checklist Triển khai Backend (Nhân) — Crypto Strategy Lab

Bản kế hoạch chi tiết từng bước thực hiện dành cho **Nhân** để triển khai 4 module Backend: **News**, **Sentiment**, **Evaluation**, và **Leaderboard** theo đúng kiến trúc Hexagonal / Clean Architecture và Event-Driven Architecture đã chốt.

---

## User Review Required

> [!IMPORTANT]
> **Chiến lược Mock Data & Tách rời phụ thuộc:**
> Để code độc lập không phụ thuộc vào tiến độ của Huy (Backtest Engine) hay Bảo (Market Data), bạn sẽ tạo dữ liệu giả lập (fixtures) cho các `Trade` và `News` khi chạy unit test & integration test nội bộ.

---

## Proposed Changes

### Component 1: News Module (`backend/src/modules/news`)

Xây dựng module thu thập tin tức crypto từ các nguồn bên ngoài, lưu trữ vào DB và phát event khi có tin tức mới.

#### [NEW] [news.entity.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/news/domain/news.entity.ts)
- Định nghĩa Domain Entity `News`, `NewsProvider`, `NewsCoin` và interface `NewsProviderAdapter`.

#### [NEW] [rss-news.adapter.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/news/infrastructure/rss-news.adapter.ts)
- Adapter crawl/fetch tin tức từ nguồn RSS/Crypto API hoặc mock fixture source.

#### [NEW] [prisma-news.repository.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/news/infrastructure/prisma-news.repository.ts)
- Repository tương tác DB với Prisma (`News`, `NewsProvider`, `NewsCoin`), xử lý deduplication theo `(providerId, externalId)`.

#### [NEW] [news.service.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/news/application/news.service.ts)
- Service gọi crawler, lưu DB và bắn event `NewsCollected`.

#### [NEW] [news.controller.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/news/presentation/news.controller.ts)
- Express Controller cung cấp 2 REST API:
  - `GET /api/v1/news` (lấy danh sách tin tức có phân trang & filter `symbol`)
  - `GET /api/v1/news/:id` (lấy chi tiết tin).

---

### Component 2: Sentiment Module (`backend/src/modules/sentiment`)

Phân tích sắc thái (Bullish, Bearish, Neutral) của tin tức, lưu kết quả sentiment và cung cấp điểm chỉ số tổng hợp.

#### [NEW] [sentiment.entity.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/sentiment/domain/sentiment.entity.ts)
- Interface `SentimentAnalyzer` và các type `SentimentClass` (`POSITIVE`, `NEUTRAL`, `NEGATIVE`).

#### [NEW] [lexicon-sentiment.analyzer.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/sentiment/infrastructure/lexicon-sentiment.analyzer.ts)
- Bộ phân tích sentiment MVP dựa trên quy tắc/từ điển từ khóa Crypto (*bullish, moon, pump, crash, dump, bearish...*).

#### [NEW] [sentiment.event-listener.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/sentiment/application/sentiment.event-listener.ts)
- Lắng nghe event `NewsCollected` -> tự động phân tích tin tức mới -> lưu DB `Sentiment` -> phát event `SentimentAnalyzed`.

#### [NEW] [sentiment.controller.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/sentiment/presentation/sentiment.controller.ts)
- REST API `GET /api/v1/sentiment/summary` (xem điểm sentiment tổng hợp theo coin).

---

### Component 3: Evaluation Module (`backend/src/modules/evaluation`)

Bộ tính toán chỉ số hiệu năng giao dịch (Metrics Engine) từ kết quả các lệnh giao dịch (`Trade`).

#### [NEW] [evaluator.engine.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/evaluation/domain/evaluator.engine.ts)
- Pure functions tính toán các chỉ số tài chính:
  - **Total Return %**
  - **Win Rate %**
  - **Max Drawdown (MDD %)**
  - **Sharpe Ratio & Sortino Ratio**
  - **Overall Score** (Formula chuẩn hóa để xếp hạng).

#### [NEW] [evaluation.service.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/evaluation/application/evaluation.service.ts)
- Xử lý đánh giá -> cập nhật DB `BacktestResult` & `EvaluationMetric` -> phát event `StrategyEvaluated`.

---

### Component 4: Leaderboard Module (`backend/src/modules/leaderboard`)

Duy trì và cung cấp Bảng xếp hạng Top-K Strategy theo thời gian thực.

#### [NEW] [leaderboard.event-listener.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/leaderboard/application/leaderboard.event-listener.ts)
- Lắng nghe event `StrategyEvaluated` từ Evaluation Module.

#### [NEW] [leaderboard.service.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/leaderboard/application/leaderboard.service.ts)
- Cập nhật bảng `LeaderboardEntry`, tính lại `rank`, ghi log snapshot vào `RankingHistory` và phát event WebSocket `LeaderboardUpdated`.

#### [NEW] [leaderboard.controller.ts](file:///e:/Documents/HCMUS/Semester3_Year3/Ki%E1%BA%BFn%20tr%C3%BAc%20ph%E1%BA%A7n%20m%E1%BB%81m/crypto-strategy-lab/backend/src/modules/leaderboard/presentation/leaderboard.controller.ts)
- REST API:
  - `GET /api/v1/leaderboard` (Lấy danh sách Top-K strategy, filter theo symbol, timeframe).
  - `GET /api/v1/leaderboard/history/:strategyVersionId` (Biến động thứ hạng theo thời gian).

---

## Verification Plan

### Automated Tests
- Chạy toàn bộ Unit Test cho 4 module:
  ```bash
  npm run test -- --filter=modules/news
  npm run test -- --filter=modules/sentiment
  npm run test -- --filter=modules/evaluation
  npm run test -- --filter=modules/leaderboard
  ```
- Kiểm tra tính đúng đắn toán học của `evaluator.engine.ts` bằng các test case mẫu (Win Rate, Max Drawdown).

### Manual Verification
- Test gọi REST APIs qua HTTP client (`curl` hoặc Postman):
  - Check `GET /api/v1/news`
  - Check `GET /api/v1/sentiment/summary`
  - Check `GET /api/v1/leaderboard`
