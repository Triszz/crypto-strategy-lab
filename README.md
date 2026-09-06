# Crypto Strategy Lab - Documentation & Installation Guide

Nền tảng phân tích, kết hợp, tìm kiếm và đánh giá chiến lược giao dịch Cryptocurrency theo thời gian thực.
Hệ thống được thiết kế theo kiến trúc Modular Monolith dựa trên Clean Architecture và Domain-Driven Design (DDD).

---

## 1. Hướng dẫn Cài đặt & Khởi chạy (Install & Run)

### 1.1 Yêu cầu Tiền đề (Prerequisites)
- Node.js >= 18.18.0
- npm >= 9.0.0
- PostgreSQL >= 14 (hoặc dịch vụ PostgreSQL Cloud / Supabase)
- Redis Server >= 6.2 (cho BullMQ task queue)
- Docker & Docker Compose (Tùy chọn, dùng để chạy nhanh môi trường PostgreSQL & Redis)

### 1.2 Cấu hình Môi trường (Environment Setup)

1. Sao chép và tạo file môi trường cho Backend:
```bash
cd backend
cp .env.example .env
```

2. Cập nhật các biến môi trường trong `backend/.env`:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crypto_lab?schema=public"
REDIS_URL="redis://localhost:6379"
GEMINI_API_KEY="your_gemini_api_key_here"
```

3. Cấu hình Frontend (nếu cần):
```bash
cd ../frontend
# Cấu hình mặc định kết nối tới Backend tại http://localhost:3000
```

### 1.3 Khởi chạy bằng Docker Compose (Khuyên dùng cho Database & Redis)
```bash
# Tại thư mục gốc của dự án
docker-compose up -d
```
Lệnh trên sẽ khởi chạy container PostgreSQL (port 5432) và Redis (port 6379).

### 1.4 Cài đặt và Khởi chạy Backend
```bash
cd backend

# Cài đặt dependencies
npm install

# Sinh Prisma Client
npm run prisma:generate

# Chạy migration cơ sở dữ liệu
npm run prisma:migrate

# Khởi chạy Backend server (chế độ Dev với hot-reload)
npm run dev
```
Backend sẽ khởi chạy tại URL: `http://localhost:3000` (HTTP & WebSocket gateway).

### 1.5 Cài đặt và Khởi chạy Frontend
```bash
cd frontend

# Cài đặt dependencies
npm install

# Khởi chạy Frontend dev server
npm run dev
```
Frontend sẽ khởi chạy tại URL: `http://localhost:5173` (hoặc cổng hiển thị trên terminal).

### 1.6 Kiểm tra Nhanh (Smoke Test & Health Check)
```bash
curl http://localhost:3000/api/health
```
Kết quả trả về dự kiến:
```json
{
  "success": true,
  "service": "crypto-strategy-lab-backend",
  "status": "ok",
  "env": "development"
}
```

---

## 2. Quyền Truy cập Repository (Permissions Note)

Dành cho Giảng viên và Thầy Cô chấm đồ án:
- Repository URL: https://github.com/Triszz/crypto-strategy-lab
- Nếu repository đặt ở chế độ Private, giảng viên vui lòng cung cấp GitHub Username để nhóm thêm quyền `Read/Maintainer`.

---

## 3. Tổng quan Kiến trúc Hệ thống (Architecture Overview)

Hệ thống được thiết kế chia làm 8 Module cốt lõi theo mô hình Modular Monolith:

1. **Market Data Module**: Tự động kết nối WebSocket Binance/CoinGecko, cung cấp dữ liệu nến realtime (Multi-timeframe: 1m, 5m, 15m, 1h, 4h, 1d) và quản lý bộ nhớ đệm nến lịch sử.
2. **Strategy Engine & Plugin Architecture**: Định nghĩa giao diện `IStrategy` chuẩn hóa cho phép dễ dàng cắm rút (Plug-and-play) các chiến lược kỹ thuật (Moving Average, RSI, Bollinger Bands, Support/Resistance, SMC, Wyckoff) và Sentiment Strategy.
3. **Composite Strategy Combination**: Cho phép kết hợp đa chiến lược theo trọng số (Weighted Combination, Logic AND/OR, Sentiment-aware weighting).
4. **Strategy Search Engine**: Tìm kiếm không gian chiến lược tối ưu bằng 2 thuật toán: Random Search và Domain-guided Search (Dựa trên heuristics chỉ báo).
5. **Backtesting Engine**: Giả lập giao dịch lịch sử chính xác cao, tính toán đầy đủ các chỉ số hiệu năng (Total Return, Win Rate, Max Drawdown, Sharpe Ratio, Profit Factor).
6. **Leaderboard Module**: Bảng xếp hạng chiến lược realtime, tự động cập nhật thứ hạng theo thời gian thực và quản lý các Top-K chiến lược tốt nhất.
7. **News Crawler Engine & Sentiment Analysis**: Thu thập tin tức crypto từ RSS/NewsAPI, tự động phân tích cảm xúc (Positive/Neutral/Negative & Score -1.0 đến +1.0) qua Google Gemini LLM API, có cơ chế Self-healing Circuit Breaker.
8. **Continuous Strategy Loop Engine**: Chu trình tự động hóa liên tục (Generate -> Execute -> Measure -> Rank -> Evolve -> Verify) để tìm kiếm và cập nhật các chiến lược tối ưu liên tục không ngắt quãng.

Xem tài liệu kiến trúc chi tiết tại: [docs/ARCHITECTURE_DOCUMENT.md](./docs/ARCHITECTURE_DOCUMENT.md)  
Xem bản ghi quyết định kiến trúc tại: [docs/ADR.md](./docs/ADR.md)

---

## 4. Hướng dẫn Kịch bản Demo (Demo Walkthrough)

Thực hiện kịch bản Demo hoàn chỉnh theo các bước sau:

- **Bước 1 (Realtime Chart)**: Truy cập trang Realtime Dashboard (`/`), quan sát biểu đồ nến realtime cập nhật từng giây từ Binance WebSocket cùng 4 khung thời gian.
- **Bước 2 (Strategy Engine)**: Truy cập trang Strategy Engine (`/strategy`), bật/tắt các chỉ báo kỹ thuật MA, RSI, Bollinger Bands, Support/Resistance và xem các tín hiệu Buy/Sell tạo ra trên biểu đồ.
- **Bước 3 (Composite Combination)**: Truy cập trang Combination (`/combination`), tạo một chiến lược kết hợp MA + RSI + Sentiment với trọng số tùy chỉnh.
- **Bước 4 (Strategy Search)**: Truy cập trang Search (`/search`), chọn tập chỉ báo đầu vào và nhấn "START SEARCH". Quan sát thuật toán Domain-guided Search duyệt qua các ứng viên và hiển thị kết quả lọc.
- **Bước 5 (Backtesting)**: Truy cập trang Backtest (`/backtest`), chạy backtest lịch sử cho chiến lược vừa tìm được. Quan sát biểu đồ Equity Curve, danh sách chi tiết các vị thế Buy/Sell, và bộ chỉ số Return %, Win Rate %, Max Drawdown %, Sharpe Ratio.
- **Bước 6 (Leaderboard Realtime)**: Truy cập trang Leaderboard (`/leaderboard`), xem danh sách Top-K chiến lược xuất sắc nhất. Khi có backtest mới vượt điểm, bảng xếp hạng sẽ cập nhật realtime qua WebSocket.
- **Bước 7 (News & Sentiment)**: Truy cập trang News Crawler (`/news`), kích hoạt Crawl tin tức mới, xem điểm Sentiment được Gemini LLM phân tích và xem chiến lược SentimentStrategy sử dụng tín hiệu này.
- **Bước 8 (Continuous Loop)**: Truy cập trang Loop (`/loop`), khởi động chu trình tự động Loop. Quan sát biểu đồ trạng thái vòng lặp tự động tìm kiếm, đánh giá và cập nhật Leaderboard liên tục.

---

## 5. Tài liệu Hồ sơ Đồ án (Documentation Links)

1. **Architecture Document**: [docs/ARCHITECTURE_DOCUMENT.md](./docs/ARCHITECTURE_DOCUMENT.md)
2. **Architectural Decision Records (ADR)**: [docs/ADR.md](./docs/ADR.md)
3. **Rubric & Proof Matrix**: [docs/RUBRIC_VERIFICATION_MATRIX.md](./docs/RUBRIC_VERIFICATION_MATRIX.md)
4. **Phiếu Tự Đánh Giá (Self-Assessment Scorecard)**: [docs/SELF_ASSESSMENT_SCORECARD.md](./docs/SELF_ASSESSMENT_SCORECARD.md)
5. **Báo cáo Chi tiết**: [docs/Crypto Strategy Lab – Đồ án cuối kỳ.md](./docs/Crypto%20Strategy%20Lab%20%E2%80%93%20%C4%90%E1%BB%93%20%C3%A1n%20cu%E1%BB%91i%20k%E1%BB%B3.md)
