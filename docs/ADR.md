# Architectural Decision Records (ADR) - Crypto Strategy Lab

Bản ghi các quyết định kiến trúc phần mềm cho hệ thống Crypto Strategy Lab. Tài liệu này lưu trữ bối cảnh, lý do kỹ thuật, phương án lựa chọn và các đánh đổi (trade-offs) trong quá trình thiết kế hệ thống.

---

## Danh sách Nhật ký Quyết định (ADR Index)

1. [ADR-001: Lựa chọn Modular Monolith thay vì Microservices ngay từ đầu](#adr-001-lựa-chọn-modular-monolith-thay-vì-microservices-ngay-từ-đầu)
2. [ADR-002: Dùng Socket.IO làm Gateway truyền dữ liệu nến và xếp hạng realtime](#adr-002-dùng-socketio-làm-gateway-truyền-dữ-liệu-nến-và-xếp-hạng-realtime)
3. [ADR-003: Áp dụng Plugin Architecture và Composite Pattern cho Strategy Engine](#adr-003-áp-dụng-plugin-architecture-và-composite-pattern-cho-strategy-engine)
4. [ADR-004: Xử lý chạy ngầm hàng đợi backtest bằng BullMQ và Redis Outbox Pattern](#adr-004-xử-lý-chạy-ngầm-hàng-đợi-backtest-bằng-bullmq-và-redis-outbox-pattern)
5. [ADR-005: Tách Sentiment Service riêng và dùng Gemini API cùng cơ chế Circuit Breaker](#adr-005-tách-sentiment-service-riêng-và-dùng-gemini-api-cùng-cơ-chế-circuit-breaker)
6. [ADR-006: Xây dựng cơ chế Continuous Strategy Loop chạy tự động khép kín](#adr-006-xây-dựng-cơ-chế-continuous-strategy-loop-chạy-tự-động-khép-kín)

---

## ADR-001: Lựa chọn Modular Monolith thay vì Microservices ngay từ đầu

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Trong giai đoạn thiết kế ban đầu, hệ thống cần đáp ứng khối lượng công việc được phân chia giữa các thành viên phụ trách các phân hệ chính (Market Data, Strategy Engine, Backtesting Engine, News & Sentiment Service). Phương án chia hệ thống thành các Microservices độc lập đã được xem xét.

Tuy nhiên, qua phân tích dòng dữ liệu và chi phí vận hành (operational overhead), việc áp dụng Microservices từ giai đoạn đầu phát sinh các thách thức:
- Chi phí truyền thông liên dịch vụ (Inter-service communication) tăng cao do cần triển khai gRPC/HTTP clients và xử lý giao thức truyền tin.
- Độ phức tạp khi quản lý hạ tầng (Docker orchestration, API Gateway) và môi trường phát triển cục bộ (local development setup).
- Tăng chi phí kiểm thử và truy vết lỗi (distributed tracing/debugging) qua nhiều dịch vụ phân tán.

### Quyết định
Nhóm thống nhất xây dựng theo mô hình kiến trúc **Modular Monolith** kết hợp nguyên lý Clean Architecture và Domain-Driven Design (DDD):
- Toàn bộ backend vận hành trong cùng một Node.js process nhưng mã nguồn được phân định ranh giới đóng gói nghiêm ngặt thành 8 module độc lập tại thư mục `backend/src/modules/`.
- Mỗi module tự chủ về dữ liệu (mô hình hóa qua Prisma Schema) và áp dụng cấu trúc 4 tầng chuẩn mực (Domain, Application, Infrastructure, Presentation).
- Việc giao tiếp giữa các module được thực hiện nghiêm ngặt qua Service Interface công khai (`backend/src/modules/*/index.ts`) hoặc thông qua EventBus nội bộ (`node:events`), tuyệt đối không truy cập trực tiếp các thành phần nội bộ của module khác.

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Tối ưu hóa hiệu năng giao tiếp nội bộ (In-memory execution), đơn giản hóa môi trường phát triển và quá trình kiểm thử tự động (Unit/Integration Test).
- **Hạn chế**: Đòi hỏi quy trình Code Review nghiêm ngặt để đảm bảo các lập trình viên không vi phạm ranh giới module (module encapsulation).
- **Khả năng mở rộng**: Cấu trúc module hóa sạch sẽ cho phép dễ dàng bóc tách từng phân hệ thành dịch vụ độc lập (Microservice) khi xuất hiện yêu cầu về tải hoặc giới hạn tài nguyên tính toán (CPU/Memory).

---

## ADR-002: Dùng Socket.IO làm Gateway truyền dữ liệu nến và xếp hạng realtime

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Hệ thống yêu cầu phản hồi thời gian thực đối với hai luồng dữ liệu chính:
1. Dữ liệu nến giá thị trường (Candlestick Stream) cập nhật theo từng chu kỳ giây từ Binance WebSocket.
2. Cập nhật thứ hạng và chỉ số của Bảng xếp hạng Top-K chiến lược ngay sau khi quy trình backtesting hoàn tất.

Các giải pháp được đưa vào đánh giá:
- **HTTP Polling**: Bị loại bỏ do lãng phí tài nguyên máy chủ và gây ra độ trễ dữ liệu (latency).
- **Server-Sent Events (SSE)**: Hạn chế do chỉ hỗ trợ truyền dữ liệu một chiều (unidirectional) và thiếu cơ chế quản lý kênh/phòng (Channels/Rooms) linh hoạt.
- **Socket.IO / WebSocket**: Hỗ trợ truyền dữ liệu hai chiều (bidirectional), tích hợp sẵn cơ chế Namespace/Room và khả năng tự động khôi phục kết nối (reconnection & fallback mechanism).

### Quyết định
Lựa chọn **Socket.IO** làm chuẩn giao thức Realtime Transport Gateway (`backend/src/server.ts`):
- Phân chia kênh truyền thông điệp thành các không gian riêng biệt: `market:candles` cho dữ liệu giá thị trường, `leaderboard:updates` cho xếp hạng chiến lược và `loop:progress` cho tiến trình chu trình tự động Continuous Loop.
- Frontend thực hiện đăng ký (subscribe) vào đúng sự kiện và phòng (room) tương ứng để tối ưu băng thông truyền tải.

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Đảm bảo tính liên tục của dữ liệu, giảm thiểu độ trễ giao diện và tối ưu trải nghiệm người dùng với các cập nhật chỉ số tức thì.
- **Hạn chế**: Cần kiểm soát chặt chẽ lifecycle của socket connection ở Client (cleanup listeners khi component unmount) để tránh hiện tượng rò rỉ bộ nhớ (memory leaks).

---

## ADR-003: Áp dụng Plugin Architecture và Composite Pattern cho Strategy Engine

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Phân hệ Strategy Engine cần đáp ứng khả năng mở rộng liên tục các chỉ báo kỹ thuật (Moving Average, RSI, Bollinger Bands, Support/Resistance, SMC/Wyckoff, Sentiment) cũng như hỗ trợ khả năng kết hợp đa chiến lược dựa trên hệ thống trọng số linh hoạt.

Nếu áp dụng hướng tiếp cận cấu trúc điều kiện cứng (`if/else` hoặc `switch/case`), hệ thống sẽ đối mặt với rủi ro vi phạm nguyên lý Open-Closed Principle (OCP), gây khó khăn khi bổ sung chiến lược mới và tăng nguy cơ phát sinh lỗi regression trong mã nguồn hiện có.

### Quyết định
Áp dụng kết hợp hai mẫu thiết kế phần mềm (Design Patterns):
1. **Plugin Architecture**: Định nghĩa hợp đồng giao diện `IStrategy` với phương thức chuẩn `evaluate(context: StrategyContext): TradingSignal`. Mỗi chỉ báo được đóng gói thành một lớp Plugin độc lập mở rộng từ `BaseStrategy` và được đăng ký thông qua `StrategyRegistry`.
2. **Composite Pattern**: Triển khai lớp `WeightedCombinationStrategy` tuân thủ giao diện `IStrategy`. Lớp này chứa tập hợp các chiến lược con và tổng hợp tín hiệu giao dịch mua/bán (Buy/Sell/Hold) dựa trên công thức tính trọng số cấu hình.

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Tuân thủ triệt để nguyên lý OCP; việc tích hợp chiến lược mới chỉ đòi hỏi tạo class plugin mới mà không ảnh hưởng tới core engine.
- **Hạn chế**: Đòi hỏi cơ chế ghi log chi tiết (structured logging) từng trọng số thành phần để phục vụ công tác truy vết và kiểm thử tín hiệu tổng hợp.

---

## ADR-004: Xử lý chạy ngầm hàng đợi backtest bằng BullMQ và Redis Outbox Pattern

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Trong các tác vụ có chi phí tính toán cao như Strategy Search hoặc Continuous Loop, hệ thống cần thực hiện mô phỏng lịch sử (backtesting) đồng thời cho hàng trăm cấu hình chiến lược trên chuỗi dữ liệu nến lớn.

Việc xử lý đồng bộ (synchronous execution) trong luồng xử lý HTTP request (Express Route Handler) sẽ dẫn đến các vấn đề nghiêm trọng:
- Hiện tượng nghẽn luồng xử lý (blocking event loop) và lỗi HTTP Gateway Timeout.
- Nguy cơ quá tải tài nguyên máy chủ (CPU starvation) khi phát sinh nhiều yêu cầu đồng thời.

### Quyết định
Triển khai mô hình hàng đợi bất đồng bộ **BullMQ Queue** trên nền tảng **Redis** kết hợp **Outbox Pattern**:
- HTTP Controller tiếp nhận yêu cầu, đóng gói thông tin tác vụ thành Job và đưa vào BullMQ Queue, trả về ngay phản hồi chứa `jobId` cho Client.
- Các tiến trình tính toán độc lập (`EvaluationWorker`) rút tác vụ từ hàng đợi và thực thi công việc dưới nền (background process).
- Kết quả hoàn tất được lưu trữ bền vững vào cơ sở dữ liệu PostgreSQL và phát tín hiệu thông báo qua Socket.IO Gateway.

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Giải phóng hoàn toàn luồng xử lý HTTP, đảm bảo tính sẵn sàng (Availability) của máy chủ và khả năng điều tiết tải (Rate Limiting / Workload Throttling).
- **Hạn chế**: Đòi hỏi bổ sung dịch vụ trung gian Redis vào kiến trúc hạ tầng và cơ chế giám sát trạng thái tác vụ.

---

## ADR-005: Tách Sentiment Service riêng và dùng Gemini API cùng cơ chế Circuit Breaker

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Phân hệ phân tích cảm xúc tin tức thị trường (Sentiment Analysis) cung cấp dữ liệu đầu vào cho `SentimentStrategy`. Việc áp dụng các phương pháp phân tích ngữ văn đơn giản (Rule-based / Lexicon Matching) không đảm bảo độ chính xác đối với ngữ cảnh đặc thù và thuật ngữ chuyên ngành của thị trường tiền mã hóa.

Nhóm quyết định tích hợp dịch vụ trí tuệ nhân tạo **Google Gemini LLM API** (`gemini-2.5-flash` / `gemini-1.5-flash`). Tuy nhiên, việc phụ thuộc vào dịch vụ bên ngoài phát sinh rủi ro về độ tin cậy khi gặp sự cố gián đoạn mạng, vượt giới hạn hạn mức (rate limit) hoặc tăng độ trễ dịch vụ.

### Quyết định
- Đóng gói phân hệ sentiment độc lập thông qua giao diện `ISentimentAnalyzer`.
- Tích hợp mẫu thiết kế **Circuit Breaker** tại `backend/src/modules/news/infrastructure/CircuitBreaker.ts` với 3 trạng thái hoạt động:
  - `CLOSED`: Gửi yêu cầu phân tích tới Gemini API bình thường.
  - `OPEN`: Khi ngưỡng lỗi vượt quá 3 lần liên tiếp, Circuit Breaker tự động ngắt kết nối Gemini API và kích hoạt phương án dự phòng (Rule-based Fallback Sentiment Engine) để đảm bảo tiến trình chung không bị gián đoạn.
  - `HALF-OPEN`: Tự động thử nghiệm khôi phục kết nối sau một khoảng thời gian chờ (cooldown period).

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Nâng cao độ chính xác khi phân tích định tính văn bản tin tức, đồng thời đảm bảo tính dung lỗi (Fault Tolerance) của toàn bộ hệ thống trước sự cố dịch vụ bên ngoài.
- **Hạn chế**: Phụ thuộc vào hạn mức truy cập và chi phí của nhà cung cấp dịch vụ LLM.

---

## ADR-006: Xây dựng cơ chế Continuous Strategy Loop chạy tự động khép kín

### Trạng thái
Đã đồng ý triển khai (Accepted)

### Bối cảnh & Đánh giá
Quy trình tìm kiếm và tối ưu hóa chiến lược thủ công (cấu hình tham số -> thực thi backtest -> phân tích kết quả -> hiệu chỉnh tham số) đòi hỏi nhiều chi phí thời gian và tiềm ẩn rủi ro sai sót do yếu tố con người. Hệ thống cần một cơ chế tự động hóa quy trình đánh giá và tiến hóa chiến lược (Autonomous Verification Loop).

### Quyết định
Xây dựng phân hệ **Continuous Strategy Loop Engine** vận hành theo chu trình tự động 6 giai đoạn:
1. **Generate**: Tự động khởi tạo tập ứng viên chiến lược (kết hợp Random Search và Domain-guided Search).
2. **Execute**: Chuyển các tác vụ thử nghiệm vào hàng đợi BullMQ để thực thi backtest bất đồng bộ.
3. **Measure**: Đo lường và trích xuất bộ chỉ số hiệu năng (Total Return, Win Rate, Max Drawdown, Sharpe Ratio).
4. **Rank**: Cập nhật các chiến lược đạt tiêu chuẩn vào Bảng xếp hạng Top-K (Leaderboard).
5. **Improve**: Trích xuất các tham số tối ưu làm cơ sở tiến hóa cho các chu kỳ tiếp theo.
6. **Verify**: Kiểm tra lại độ ổn định của chiến lược trên các khung thời gian và tập dữ liệu khác nhau.

### Đánh đổi thực tế & Bài học
- **Ưu điểm**: Tự động hóa toàn diện quy trình tìm kiếm và đánh giá chiến lược, giảm thiểu thao tác thủ công và tối ưu hóa hiệu quả vận hành.
- **Hạn chế**: Cần thiết lập cơ chế kiểm soát ngưỡng tối đa (Maximum Iterations) và chức năng tạm dừng/hủy bỏ (Pause/Cancel) để quản lý tài nguyên hệ thống.

