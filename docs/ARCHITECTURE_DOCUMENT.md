# Architecture Document - Crypto Strategy Lab

Đặc tả Kiến trúc Phần mềm Nền tảng Crypto Strategy Lab.

---

## 1. System Context (C4 Level 1)

Hệ thống **Crypto Strategy Lab** đứng ở vị trí trung tâm trong việc thu thập dữ liệu thị trường, tin tức xã hội, phân tích cảm xúc và tự động hóa thử nghiệm chiến lược giao dịch.

```mermaid
graph TD
    User[Trình duyệt Người dùng / Nhà nghiên cứu]
    System[Crypto Strategy Lab System]
    Binance[Binance WebSocket / REST API]
    NewsProvider[RSS Feeds / News API]
    LLM[Google Gemini LLM API]

    User <-->|HTTP / Socket.IO| System
    System <-->|WebSocket Tick Stream| Binance
    System -->|HTTP Crawl| NewsProvider
    System <-->|REST AI Analysis| LLM
```

### Các Tác nhân và Hệ thống Bên ngoài:
1. **User (Nhà nghiên cứu / Trader)**: Tương tác qua giao diện Web React để cấu hình chỉ báo, chạy thuật toán tìm kiếm chiến lược, thực hiện backtest và theo dõi vòng lặp liên tục (Loop).
2. **Binance Exchange**: Nguồn cung cấp dữ liệu giá nến (OHLCV) theo thời gian thực qua giao thức WebSocket và dữ liệu lịch sử qua REST API.
3. **News Providers (RSS / News API)**: Cung cấp nguồn tin tức thị trường cryptocurrency theo dạng dòng sự kiện.
4. **Google Gemini LLM API**: Dịch vụ trí tuệ nhân tạo bên ngoài được tích hợp để phân tích định tính văn bản tin tức, trích xuất điểm số cảm xúc (Sentiment score) và thực thể liên quan.

---

## 2. Module / Container Decomposition (C4 Level 2)

Hệ thống Backend được xây dựng theo mô hình **Modular Monolith** kết hợp với kiến trúc hướng sự kiện (Event-Driven Architecture) và cơ chế xử lý bất đồng bộ qua Queue / Worker.

```mermaid
graph TD
    %% --- FRONTEND ---
    subgraph Frontend ["Frontend Container"]
        ReactUI["React 18 SPA (Vite + TailwindCSS + Lightweight Charts)"]
    end

    %% --- TRANSPORT LAYER ---
    subgraph Transport ["Transport Layer"]
        ExpressApp["Express.js REST Gateway"]
        SocketIO["Socket.IO Realtime Gateway"]
    end

    %% --- BACKEND MONOLITH ---
    subgraph Backend ["Backend Core (Modular Monolith)"]
        subgraph DataPipeline ["Data & Sentiment Pipeline"]
            MarketData["Market Data Module"]
            NewsCrawler["News Crawler Engine"]
            SentimentModule["Sentiment Analysis Service"]
        end

        subgraph CoreEngine ["Strategy & Automation Engine"]
            LoopController["Continuous Loop Controller"]
            SearchEngine["Strategy Search Engine"]
            StrategyEngine["Strategy Engine & Plugins"]
            BacktestEngine["Backtest Engine"]
            LeaderboardModule["Leaderboard Module"]
        end
    end

    %% --- STORAGE & INFRASTRUCTURE ---
    subgraph Storage ["Storage & Infrastructure"]
        RedisCache[("Redis Cache & Outbox")]
        BullQueue["BullMQ Worker Queue"]
        Postgres[("PostgreSQL Database")]
    end

    %% --- CONNECTIONS ---
    ReactUI <--> ExpressApp
    ReactUI <--> SocketIO

    ExpressApp --> LoopController
    ExpressApp --> SearchEngine
    ExpressApp --> StrategyEngine
    ExpressApp --> BacktestEngine
    ExpressApp --> NewsCrawler

    SocketIO <--> MarketData
    SocketIO <--> LeaderboardModule
    SocketIO <--> LoopController

    MarketData --> RedisCache
    NewsCrawler --> BullQueue
    BullQueue --> SentimentModule
    SentimentModule --> StrategyEngine

    LoopController --> SearchEngine
    LoopController --> BacktestEngine
    LoopController --> LeaderboardModule
    SearchEngine --> BacktestEngine
    BacktestEngine --> LeaderboardModule

    MarketData --> Postgres
    StrategyEngine --> Postgres
    BacktestEngine --> Postgres
    LeaderboardModule --> Postgres
    NewsCrawler --> Postgres
    SentimentModule --> Postgres
    LoopController --> Postgres
```

---

## 3. Component Responsibilities & Boundaries (C4 Level 3)

```mermaid
graph TD
    subgraph Component_Responsibilities["Component Responsibilities & Boundaries"]
        MD["Market Data Component<br/>(CandleStreamer, MarketDataRepo)"]
        SE["Strategy Engine Component<br/>(IStrategy, StrategyRegistry)"]
        BT["Backtest Engine Component<br/>(HistoricalSimulator, MetricsCalc)"]
        SS["Search Engine Component<br/>(RandomGen, DomainGuidedGen)"]
        LB["Leaderboard Component<br/>(RankingRepo, TopKManager)"]
        NC["News & Sentiment Component<br/>(NewsCrawler, GeminiAnalyzer)"]
        LP["Continuous Loop Component<br/>(LoopController, EvolveEngine)"]
    end

    MD -->|OHLCV Data| SE
    MD -->|OHLCV Data| BT
    NC -->|Sentiment Score| SE
    SS -->|Candidate Strategies| BT
    BT -->|Performance Metrics| LB
    LP -->|Orchestrates| SS
    LP -->|Orchestrates| BT
    LP -->|Orchestrates| LB
```

### 3.1 Market Data Module
- **Trách nhiệm**: Kết nối và duy trì kết nối WebSocket tới Binance/CoinGecko. Thu thập tick giá realtime và tổng hợp thành các cây nến (Candlestick) ở các khung thời gian: 1m, 5m, 15m, 1h, 4h, 1d.
- **Ranh giới (Boundary)**: Cung cấp giao diện `IMarketDataRepository` và `CandleStreamer` cho các module khác. Không phụ thuộc vào logic giao dịch hay chiến lược.

### 3.2 Strategy Engine & Plugin Architecture
- **Trách nhiệm**: Cung cấp giao diện chuẩn `IStrategy` và lớp cơ sở `BaseStrategy`. Cài đặt các chiến lược kỹ thuật cốt lõi:
  - Moving Average Crossover (MA)
  - Relative Strength Index (RSI)
  - Bollinger Bands (BB)
  - Support & Resistance (SR)
  - SentimentStrategy (Tích hợp điểm cảm xúc thị trường)
- **Cơ chế Plugin**: Cho phép đăng ký mới bất kỳ chiến lược nào qua `StrategyRegistry` mà không làm thay đổi mã nguồn hiện có (Open-Closed Principle).
- **Composite Strategy**: Kết hợp các tín hiệu đơn lẻ thành chiến lược phức hợp dựa trên trọng số (`WeightedCombinationStrategy`).

### 3.3 Strategy Search Engine
- **Trách nhiệm**: Tự động sinh ra không gian chiến lược  từ các  tham số và tổ hợp.
- **Thuật toán Tìm kiếm**:
  - **Random Search**: Lấy mẫu ngẫu nhiên tổ hợp tham số và trọng số.
  - **Domain-guided Search**: Sử dụng tri thức chuyên ngành để ưu tiên các cặp chỉ báo có tính bổ trợ cao (ví dụ: Trend-following MA kết hợp với Oscillator RSI).

### 3.4 Backtesting Engine
- **Trách nhiệm**: Mô phỏng khớp lệnh lịch sử dựa trên dữ liệu nến quá khứ.
- **Tính toán Chỉ số (Metrics)**:
  - Total Return (%)
  - Win Rate (%)
  - Max Drawdown - MDD (%)
  - Sharpe Ratio
  - Profit Factor & Total Trades


### 3.5 Leaderboard Module
- **Trách nhiệm**: Lưu trữ, quản lý và xếp hạng danh sách Top-K chiến lược hiệu quả nhất dựa trên chỉ số tổng hợp (Composite Score / Sharpe Ratio).
- **Cập nhật Realtime**: Phát sự kiện qua Socket.IO để cập nhật giao diện người dùng ngay lập tức khi một chiến lược mới ghi điểm cao hơn.

### 3.6 News Crawler Engine & Sentiment Analysis
- **Trách nhiệm**:
  - `News Crawler`: Thu thập bài viết từ RSS / NewsAPI theo chu kỳ. Có cơ chế `CircuitBreaker` tự khắc phục sự cố khi nguồn tin bị hỏng.
  - `Sentiment Analysis Service`: Gửi nội dung tin tức tới Google Gemini LLM API để phân loại cảm xúc (Positive, Neutral, Negative) và trả về điểm số từ -1.0 đến +1.0.

### 3.7 Continuous Strategy Loop Engine
- **Trách nhiệm**: Điều phối chu trình tự động hóa khép kín:
  1. Generate: Sinh ra tập chiến lược ứng viên mới.
  2. Execute: Gửi công việc backtest vào Queue.
  3. Measure: Thu thập kết quả và tính điểm hiệu năng.
  4. Rank: Cập nhật thứ hạng vào Leaderboard.
  5. Evolve & Verify: Lựa chọn các mẫu chiến lược tốt nhất để lai ghép hoặc tinh chỉnh cho vòng lặp tiếp theo.

---

## 4. Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Binance as Binance API
    participant MD as Market Data Module
    participant DB as PostgreSQL DB
    participant Queue as BullMQ Worker
    participant Strategy as Strategy Engine
    participant Backtest as Backtest Engine
    participant LB as Leaderboard Module
    participant UI as Frontend UI

    Binance ->> MD: Tick Stream / OHLCV Data
    MD ->> DB: Persist Candlesticks
    UI ->> Strategy: Configure Strategy / Search Request
    Strategy ->> Queue: Push Backtest Task
    Queue ->> Backtest: Execute Historical Simulation
    Backtest ->> DB: Save Trades & Backtest Results
    Backtest ->> LB: Submit Performance Metrics
    LB ->> DB: Update Top-K Rankings
    LB ->> UI: Broadcast Leaderboard Update via Socket.IO
```

### Mô tả Dòng dữ liệu:
1. **Dữ liệu Nến**: Nhận từ Binance WebSocket -> Chuẩn hóa định dạng OHLCV -> Lưu trữ dài hạn trong PostgreSQL.
2. **Dữ liệu Tin tức & Cảm xúc**: Crawl bài báo  -> Worker gọi Gemini API -> Lưu điểm Sentiment theo mốc thời gian -> Cung cấp cho SentimentStrategy.
3. **Dữ liệu Đánh giá Chiến lược**: Chiến lược tạo ra tín hiệu (1: BUY, -1: SELL, 0: HOLD) -> Engine giả lập khớp lệnh -> Lưu chi tiết giao dịch (Trades) -> Xuất chỉ số thống kê -> Đẩy lên Leaderboard.

---

## 5. Realtime Flow (Socket.IO Stream)

```mermaid
sequenceDiagram
    autonumber
    participant Binance as Binance WebSocket
    participant Streamer as CandleStreamer
    participant Gateway as Socket.IO Gateway
    participant Worker as Backtest / Loop Worker
    participant LB as Leaderboard Service
    participant Client as React Client (UI)

    Binance ->> Streamer: WebSocket Trade Tick
    Streamer ->> Streamer: Aggregate OHLCV Candle
    Streamer ->> Gateway: Broadcast 'candle:update' (Room: market:candles)
    Gateway ->> Client: Push Realtime Candle Data to Chart

    Worker ->> LB: Complete Backtest Job & Calculate Score
    LB ->> Gateway: Broadcast 'leaderboard:ranked' (Room: leaderboard:updates)
    Gateway ->> Client: Update Top-K Leaderboard Table

    Worker ->> Gateway: Broadcast 'loop:step' (Room: loop:progress)
    Gateway ->> Client: Update Continuous Loop Status Progress
```

Hệ thống sử dụng **Socket.IO Gateway** để quản lý các kênh kết nối thời gian thực:

1. **Kênh `market:candles`**:
   - Phát các sự kiện `candle:update` mỗi khi có cây nến mới hoặc giá nến đang chạy thay đổi.
   - Frontend hiển thị biểu đồ nến realtime mượt mà mà không cần re-fetch API.

2. **Kênh `leaderboard:updates`**:
   - Phát sự kiện `leaderboard:ranked` mỗi khi một backtest hoàn tất có điểm số nằm trong Top-K.
   - Bảng xếp hạng trên UI lập tức thay đổi vị trí mượt mà với hoạt ảnh highlight.

3. **Kênh `loop:progress`**:
   - Phát sự kiện `loop:step` thông báo tiến trình của vòng lặp Continuous Loop.

---

## 6. Strategy Flow & Plugin System

```mermaid
graph LR
    subgraph Indicator Input
        MA[Moving Average]
        RSI[Relative Strength Index]
        BB[Bollinger Bands]
        SR[Support / Resistance]
        Sentiment[Sentiment Score]
    end

    subgraph Strategy Interface
        IStrategy[IStrategy Interface]
    end

    subgraph Combination Engine
        Weighting[Weighted Combination Engine]
    end

    subgraph Signal Generation
        Signal[Trading Signal: BUY / SELL / HOLD]
    end

    MA --> IStrategy
    RSI --> IStrategy
    BB --> IStrategy
    SR --> IStrategy
  
    Sentiment --> IStrategy
    IStrategy --> Weighting
    Weighting --> Signal
```

### Thuật toán Kết hợp Chiến lược (Composite Combination):
Cho $N$ chiến lược con $S_1, S_2, ..., S_N$ với trọng số tương ứng $w_1, w_2, ..., w_N$ (sao cho $\sum w_i = 1$) và tín hiệu từ mỗi chiến lược $s_i \in \{-1, 0, 1\}$:

Dạng tín hiệu tổng hợp:
$$S_{composite} = \sum_{i=1}^{N} w_i \cdot s_i$$

Nếu $S_{composite} \ge \text{Threshold}_{buy}$ -> Quyết định BUY (1).  
Nếu $S_{composite} \le -\text{Threshold}_{sell}$ -> Quyết định SELL (-1).  
Ngược lại -> Quyết định HOLD (0).

---

## 7. Search & Backtest Flow

```mermaid
graph TD
    Start[Bắt đầu Tìm kiếm] --> GenCandidates[Sinh danh sách Ứng viên]
    GenCandidates --> CheckType{Loại Tìm kiếm?}
    CheckType -->|Random Search| RndGen[Lấy mẫu Ngẫu nhiên Tham số & Trọng số]
    CheckType -->|Domain-guided| DomGen[Lọc Tổ hợp Bổ trợ theo Tri thức]
    RndGen --> DispatchTask[Gửi công việc vào BullMQ Task Queue]
    DomGen --> DispatchTask
    DispatchTask --> WorkerExec[Worker thực thi Backtest trên Dữ liệu Lịch sử]
    WorkerExec --> MetricCalc[Tính toán Return, Win Rate, MDD, Sharpe]
    MetricCalc --> RankCheck{Thuộc Top-K?}
    RankCheck -->|Có| UpdateLB[Cập nhật Leaderboard & Phát Realtime Signal]
    RankCheck -->|Không| NextCand[Chuyển sang Ứng viên tiếp theo]
    UpdateLB --> NextCand
    NextCand --> Finish{Đã duyệt xong?}
    Finish -->|Chưa| GenCandidates
    Finish -->|Rồi| End[Hoàn tất Tìm kiếm]
```

### Các Chỉ số Đánh giá Hiệu năng (Metrics Calculation):
1. **Total Return**:
   $$\text{Return} = \frac{V_{final} - V_{initial}}{V_{initial}} \times 100\%$$
2. **Win Rate**:
   $$\text{Win Rate} = \frac{\text{Số giao dịch có lợi nhuận}}{\text{Tổng số giao dịch}} \times 100\%$$
3. **Max Drawdown (MDD)**:
   $$\text{MDD} = \max_{t} \left( \frac{P_{peak} - P_t}{P_{peak}} \right) \times 100\%$$
4. **Sharpe Ratio**:
   $$\text{Sharpe Ratio} = \frac{R_p - R_f}{\sigma_p}$$
