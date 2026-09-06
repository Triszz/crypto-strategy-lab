# Architectural Decision Records (ADR) - Crypto Strategy Lab

Bản ghi các quyết định kiến trúc phần mềm cho hệ thống Crypto Strategy Lab. Tài liệu này ghi lại bối cảnh, lý do lựa chọn, các phương án đã cân nhắc và những đánh đổi (trade-offs) trong quá trình tụi em thiết kế hệ thống.

---

## Danh sách Nhật ký Quyết định (ADR Index)

1. [ADR-001: Chọn Modular Monolith thay vì Microservices ngay từ đầu](#adr-001-chọn-modular-monolith-thay-vì-microservices-ngay-từ-đầu)
2. [ADR-002: Dùng Socket.IO để truyền dữ liệu nến và bảng xếp hạng realtime](#adr-002-dùng-socketio-để-truyền-dữ-liệu-nến-và-bảng-xếp-hạng-realtime)
3. [ADR-003: Dùng Plugin Architecture và Composite Pattern cho Strategy Engine](#adr-003-dùng-plugin-architecture-và-composite-pattern-cho-strategy-engine)
4. [ADR-004: Xử lý backtest chạy nền bằng BullMQ và Redis (Outbox Pattern)](#adr-004-xử-lý-backtest-chạy-nền-bằng-bullmq-và-redis-outbox-pattern)
5. [ADR-005: Tách riêng Sentiment Service, dùng Gemini API kèm Circuit Breaker](#adr-005-tách-riêng-sentiment-service-dùng-gemini-api-kèm-circuit-breaker)
6. [ADR-006: Xây dựng Continuous Strategy Loop chạy tự động khép kín](#adr-006-xây-dựng-continuous-strategy-loop-chạy-tự-động-khép-kín)

---

## ADR-001: Chọn Modular Monolith thay vì Microservices ngay từ đầu

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Ở giai đoạn đầu, hệ thống cần chia việc cho các thành viên phụ trách từng mảng chính (Market Data, Strategy Engine, Backtesting Engine, News & Sentiment Service). Tụi em có cân nhắc tách hẳn thành Microservices ngay từ đầu.

Nhưng sau khi ngồi lại phân tích luồng dữ liệu và chi phí vận hành, tụi em thấy làm Microservices sớm quá sẽ phát sinh mấy vấn đề:
- Tốn công viết thêm gRPC/HTTP client để các service nói chuyện với nhau, đội chi phí giao tiếp giữa các service lên khá nhiều.
- Setup hạ tầng (Docker orchestration, API Gateway) và môi trường dev ở máy cá nhân phức tạp hơn hẳn.
- Debug lỗi khó hơn vì phải trace qua nhiều service khác nhau (distributed tracing).

### Quyết định
Cả nhóm thống nhất làm theo mô hình **Modular Monolith**:
- Backend chạy chung trong một process Node.js duy nhất, nhưng code được chia ranh giới rõ ràng thành 8 module riêng biệt trong `backend/src/modules/`.
- Mỗi module tự quản lý dữ liệu của mình (định nghĩa qua Prisma Schema)
- Các module chỉ được giao tiếp với nhau qua Service Interface public (`backend/src/modules/*/index.ts`) hoặc qua EventBus nội bộ (`node:events`), không được đụng thẳng vào phần bên trong của module khác.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: Gọi nhau trong process nên nhanh, môi trường dev đơn giản hơn, viết Unit/Integration Test cũng dễ hơn nhiều.
- **Hạn chế**: Phải review code kỹ, vì rất dễ có bạn lỡ tay đụng vào code nội bộ của module khác (phá vỡ ranh giới module).
- **Khả năng mở rộng sau này**: Nhờ chia module sạch ngay từ đầu nên sau này nếu cần, tụi em có thể tách từng module ra thành Microservice riêng khi hệ thống thật sự cần scale hoặc bị giới hạn CPU/Memory.

---

## ADR-002: Dùng Socket.IO để truyền dữ liệu nến và bảng xếp hạng realtime

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Hệ thống cần cập nhật realtime cho hai luồng dữ liệu:
1. Dữ liệu nến giá (Candlestick Stream) lấy từ Binance WebSocket, cập nhật liên tục theo giây.
2. Cập nhật thứ hạng và chỉ số trên Bảng xếp hạng Top-K ngay sau khi backtest chạy xong.

Tụi em có xem qua vài lựa chọn:
- **HTTP Polling**: Bỏ vì tốn tài nguyên server mà dữ liệu vẫn bị trễ.
- **Server-Sent Events (SSE)**: Chỉ truyền một chiều, lại không có sẵn cơ chế quản lý phòng/kênh (Channels/Rooms) nên không linh hoạt.
- **Socket.IO / WebSocket**: Truyền hai chiều, có sẵn Namespace/Room, tự động reconnect khi mất kết nối.

### Quyết định
Chọn **Socket.IO** làm cổng truyền dữ liệu realtime (`backend/src/server.ts`):
- Chia thành các kênh riêng: `market:candles` cho dữ liệu giá, `leaderboard:updates` cho bảng xếp hạng chiến lược, và `loop:progress` cho tiến trình của Continuous Loop.
- Frontend chỉ subscribe đúng sự kiện/phòng mình cần, tránh tốn băng thông không cần thiết.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: Dữ liệu cập nhật liên tục, giao diện đỡ giật, người dùng thấy chỉ số thay đổi gần như ngay lập tức.
- **Hạn chế**: Phải cẩn thận quản lý vòng đời socket ở Client (nhớ cleanup listener khi component unmount), không thì dễ bị memory leak.

---

## ADR-003: Dùng Plugin Architecture và Composite Pattern cho Strategy Engine

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Strategy Engine cần mở rộng liên tục nhiều chỉ báo kỹ thuật (Moving Average, RSI, Bollinger Bands, Support/Resistance, Sentiment...) và phải hỗ trợ kết hợp nhiều chiến lược cùng lúc theo trọng số.

Nếu code kiểu `if/else` hay `switch/case` cứng nhắc thì sẽ vi phạm Open-Closed Principle (OCP) — mỗi lần thêm chiến lược mới là phải sửa lại code cũ, dễ gây lỗi (regression).

### Quyết định
Tụi em dùng kết hợp hai design pattern:
1. **Plugin Architecture**: Định nghĩa interface `IStrategy` với method chuẩn `evaluate(context: StrategyContext): TradingSignal`. Mỗi chỉ báo được viết thành một class Plugin riêng, kế thừa từ `BaseStrategy` và đăng ký qua `StrategyRegistry`.
2. **Composite Pattern**: Viết class `WeightedCombinationStrategy` cũng tuân theo `IStrategy`, bên trong chứa nhiều chiến lược con và gộp lại thành tín hiệu Buy/Sell/Hold theo công thức trọng số đã cấu hình.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: Theo đúng OCP — thêm chiến lược mới chỉ cần tạo class plugin mới, không đụng vào core engine.
- **Hạn chế**: Cần log chi tiết (structured logging) từng trọng số thành phần, để sau này dễ truy vết khi kiểm tra tín hiệu tổng hợp có đúng không.

---

## ADR-004: Xử lý backtest chạy nền bằng BullMQ và Redis

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Những tác vụ nặng như Strategy Search hay Continuous Loop cần chạy backtest cho hàng trăm cấu hình chiến lược cùng lúc trên tập dữ liệu nến lớn.

Nếu xử lý đồng bộ ngay trong HTTP request (Express Route Handler) thì sẽ gặp vấn đề:
- Block luôn event loop, dễ bị lỗi HTTP Gateway Timeout.
- Nếu nhiều request cùng lúc thì server dễ bị quá tải CPU.

### Quyết định
Tụi em dùng **BullMQ Queue** chạy trên **Redis**:
- HTTP Controller nhận request, đóng gói thành Job đẩy vào BullMQ Queue, rồi trả về `jobId` cho Client ngay, không phải chờ.
- Các worker (`EvaluationWorker`) lấy job ra khỏi hàng đợi và chạy xử lý ở nền (background process).
- Kết quả sau khi xong được lưu vào PostgreSQL.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: HTTP server không bị block, server luôn sẵn sàng nhận request mới, dễ điều tiết tải (rate limit / throttle workload).
- **Hạn chế**: Phải thêm Redis vào hạ tầng, và cần theo dõi trạng thái job cẩn thận hơn.

---

## ADR-005: Tách riêng Sentiment Service, dùng Gemini API kèm Circuit Breaker

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Phân hệ phân tích cảm xúc tin tức (Sentiment Analysis) cung cấp dữ liệu đầu vào cho `SentimentStrategy`. Nếu chỉ làm theo kiểu rule-based/lexicon matching đơn giản thì không đủ chính xác với các thuật ngữ đặc thù của thị trường crypto.

Vì vậy tụi em quyết định gọi **Google Gemini LLM API**. Nhưng phụ thuộc vào API bên ngoài thì có rủi ro: mạng lỗi, vượt rate limit, hoặc API bị chậm.

### Quyết định
- Đóng gói phần sentiment thành một module riêng qua interface `ISentimentAnalyzer`.
- Áp dụng pattern **Circuit Breaker** ở `backend/src/modules/news/infrastructure/CircuitBreaker.ts`, có 3 trạng thái:
  - `CLOSED`: Gọi Gemini API bình thường.
  - `OPEN`: Khi lỗi liên tiếp quá 3 lần, tự động ngắt không gọi Gemini nữa, chuyển sang phương án dự phòng (Rule-based Fallback Sentiment Engine) để hệ thống không bị đứng.
  - `HALF-OPEN`: Sau một khoảng thời gian chờ (cooldown), tự động thử gọi lại xem API đã ổn chưa.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: Phân tích cảm xúc tin tức chính xác hơn, đồng thời hệ thống vẫn chạy được (fault tolerance) khi Gemini API gặp sự cố.
- **Hạn chế**: Phụ thuộc vào rate limit và chi phí sử dụng của nhà cung cấp LLM.

---

## ADR-006: Xây dựng Continuous Strategy Loop chạy tự động khép kín

### Trạng thái
Đã chốt (Accepted)

### Bối cảnh
Quy trình tìm và tối ưu chiến lược theo kiểu thủ công (chỉnh tham số -> chạy backtest -> xem kết quả -> chỉnh lại tham số) tốn khá nhiều thời gian và dễ sai sót do con người. Tụi em muốn có một cơ chế tự động hóa việc đánh giá và cải tiến chiến lược.

### Quyết định
Xây dựng **Continuous Strategy Loop Engine**, chạy theo chu trình tự động 6 bước:
1. **Generate**: Tự sinh ra tập chiến lược ứng viên (kết hợp Random Search và Domain-guided Search).
2. **Execute**: Đẩy các job backtest vào hàng đợi BullMQ để chạy bất đồng bộ.
3. **Measure**: Đo và trích ra các chỉ số hiệu năng (Total Return, Win Rate, Max Drawdown, Sharpe Ratio).
4. **Rank**: Cập nhật những chiến lược đạt chuẩn vào Bảng xếp hạng Top-K.
5. **Improve**: Lấy các tham số tốt nhất làm nền tảng để tiến hóa cho vòng lặp tiếp theo.
6. **Verify**: Kiểm tra lại độ ổn định của chiến lược trên nhiều khung thời gian và tập dữ liệu khác nhau.

### Đánh đổi & Bài học rút ra
- **Ưu điểm**: Tự động hóa gần như toàn bộ quy trình tìm và đánh giá chiến lược, đỡ tốn công thao tác thủ công.
- **Hạn chế**: Cần đặt giới hạn số vòng lặp tối đa (Maximum Iterations) và có nút tạm dừng/hủy (Pause/Cancel) để không ngốn hết tài nguyên hệ thống.