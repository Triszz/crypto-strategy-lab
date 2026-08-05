# Software Requirements Specification (SRS)

# Crypto Strategy Lab

**Version:** 1.0

**Status:** Draft

**Course:** Software Architecture

**Team Members**

| Student | Responsibility |
| ------- | -------------- |
| Trí     | TBD            |
| Bảo     | TBD            |
| Huy     | TBD            |
| Nhân    | TBD            |

---

# Revision History

| Version | Date | Author | Description                       |
| ------- | ---- | ------ | --------------------------------- |
| 1.0     | TBD  | Team   | Initial Requirement Specification |

---

# Table of Contents

1. Introduction
2. Project Overview
3. Stakeholders
4. Business Objectives
5. System Scope
6. Assumptions and Constraints
7. User Characteristics
8. Functional Requirements
9. Non-functional Requirements
10. Business Rules
11. Use Cases
12. User Stories
13. Acceptance Criteria
14. Out of Scope
15. Requirement Traceability Matrix
16. Appendix

---

# 1. Introduction

## 1.1 Purpose

Tài liệu này mô tả toàn bộ yêu cầu của hệ thống **Crypto Strategy Lab**, được xây dựng trong khuôn khổ đồ án môn học **Software Architecture**.

Tài liệu đóng vai trò là nguồn tham chiếu chính cho toàn bộ vòng đời phát triển phần mềm, bao gồm:

- Requirement Analysis
- Software Architecture Design
- Database Design
- API Design
- UI/UX Design
- Development
- Testing
- Deployment
- Maintenance

Ngoài việc mô tả các yêu cầu chức năng và phi chức năng, tài liệu còn xác định rõ phạm vi của hệ thống, các ràng buộc, giả định và các quyết định thiết kế được nhóm thống nhất trước khi triển khai.

---

## 1.2 Project Background

Thị trường Cryptocurrency là một thị trường tài chính hoạt động liên tục 24 giờ mỗi ngày và 7 ngày mỗi tuần.

Nhà giao dịch (Trader) thường sử dụng nhiều phương pháp phân tích kỹ thuật khác nhau như:

- Moving Average (MA)
- Relative Strength Index (RSI)
- Bollinger Bands
- Support / Resistance
- Smart Money Concepts (SMC)
- Wyckoff
- ...

để xác định thời điểm:

- Buy
- Sell
- Hold

Tuy nhiên, không có một chiến lược đơn lẻ nào hoạt động tốt trong mọi điều kiện thị trường.

Một chiến lược có thể đạt hiệu quả cao khi thị trường có xu hướng tăng nhưng lại hoạt động kém trong thị trường đi ngang hoặc biến động mạnh.

Vì vậy, nhu cầu đặt ra là xây dựng một nền tảng có khả năng:

- quản lý nhiều strategy khác nhau,
- kết hợp các strategy thành composite strategy,
- backtest trên dữ liệu lịch sử,
- đánh giá hiệu quả,
- xếp hạng,
- và liên tục tìm kiếm các combination strategy tốt hơn.

Theo đề bài, trọng tâm của đồ án **không phải là tìm ra chiến lược đầu tư sinh lời tốt nhất**, mà là thiết kế một kiến trúc phần mềm có khả năng mở rộng, thay đổi và bảo trì lâu dài.

---

## 1.3 Purpose of the System

Crypto Strategy Lab được xây dựng nhằm hỗ trợ Trader thực hiện quá trình nghiên cứu và đánh giá các chiến lược giao dịch Cryptocurrency một cách có hệ thống.

Hệ thống cho phép:

- thu thập dữ liệu thị trường từ Binance,
- hiển thị biểu đồ giá theo thời gian thực,
- quản lý nhiều technical strategies,
- tạo composite strategy,
- thực hiện backtesting,
- đánh giá hiệu quả giao dịch,
- xếp hạng các strategy,
- trực quan hóa kết quả,
- thu thập tin tức,
- phân tích sentiment,
- và hỗ trợ mở rộng thêm strategy hoặc data provider trong tương lai.

---

## 1.4 Definitions

| Term                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| Strategy            | Thuật toán phân tích dữ liệu thị trường để đưa ra tín hiệu giao dịch. |
| Composite Strategy  | Chiến lược được tạo từ nhiều strategy đơn lẻ.                         |
| Backtesting         | Mô phỏng giao dịch trên dữ liệu lịch sử.                              |
| Technical Indicator | Chỉ báo kỹ thuật như MA, RSI, Bollinger Bands...                      |
| Strategy Search     | Module sinh các tổ hợp strategy để thử nghiệm.                        |
| Experiment          | Một lần chạy backtest trên một strategy hoặc composite strategy.      |
| Leaderboard         | Bảng xếp hạng các strategy tốt nhất.                                  |
| Historical Data     | Dữ liệu thị trường trong quá khứ.                                     |
| Realtime Data       | Dữ liệu thị trường đang thay đổi liên tục.                            |
| Sentiment Analysis  | Phân tích cảm xúc của tin tức.                                        |

---

# 2. Project Overview

## 2.1 Project Name

Crypto Strategy Lab

---

## 2.2 Project Type

Software Architecture Course Project

---

## 2.3 Problem Statement

Các nhà giao dịch thường phải thử nghiệm rất nhiều chiến lược khác nhau trước khi tìm được một phương pháp phù hợp.

Việc thử nghiệm thủ công gặp nhiều hạn chế:

- Khó quản lý số lượng lớn strategy.
- Không dễ so sánh nhiều strategy cùng lúc.
- Không có cơ chế tự động tạo strategy mới.
- Thiếu hệ thống đánh giá khách quan.
- Không trực quan hóa được toàn bộ quá trình giao dịch.
- Khó mở rộng khi xuất hiện indicator mới hoặc nguồn dữ liệu mới.

Do đó cần một nền tảng có khả năng tự động hóa toàn bộ quy trình nghiên cứu strategy.

---

## 2.4 Proposed Solution

Crypto Strategy Lab cung cấp một nền tảng thống nhất bao gồm:

- Market Data Service
- Multi-Timeframe Chart
- Strategy Engine
- Composite Strategy Engine
- Strategy Search Engine
- Backtesting Engine
- Evaluation Engine
- Leaderboard
- News Collector
- Sentiment Analysis
- Visualization Dashboard

Kiến trúc của hệ thống được thiết kế theo hướng module hóa nhằm giảm coupling giữa các thành phần và hỗ trợ khả năng mở rộng trong tương lai.

---

## 2.5 Development Stack

### Frontend

- ReactJS
- TypeScript

### Backend

- Node.js
- Express.js
- TypeScript

### Database

- PostgreSQL
- Supabase

### Queue

- BullMQ

### Event Bus

- Node EventEmitter

### Realtime Communication

- Socket.IO

### News Provider

- CryptoPanic API

### Sentiment Analysis

- Gemini

### Chart Library

- TradingView Lightweight Charts

### Operating System

- Windows

### IDE

- Cursor

---

# 3. Stakeholders

## 3.1 Primary Stakeholder

### Trader

Trader là người sử dụng trực tiếp hệ thống.

Trader có thể:

- theo dõi dữ liệu thị trường,
- cấu hình strategy,
- chạy backtest,
- tạo composite strategy,
- theo dõi leaderboard,
- xem lịch sử giao dịch,
- theo dõi tin tức,
- xem sentiment.

Trong phạm vi MVP, hệ thống chỉ hỗ trợ một vai trò duy nhất là Trader và chưa triển khai cơ chế phân quyền người dùng.

---

## 3.2 Development Team

Nhóm phát triển chịu trách nhiệm:

- Requirement Analysis
- Software Architecture
- Database Design
- Backend Development
- Frontend Development
- Testing
- Documentation

---

## 3.3 Course Instructor

Giảng viên đóng vai trò:

- Customer
- Product Owner
- Architecture Reviewer

Giảng viên đánh giá:

- Chất lượng Requirement
- Chất lượng Architecture
- Khả năng mở rộng
- Khả năng thay đổi
- Khả năng bảo trì
- Khả năng demo hệ thống

---

# 4. Business Objectives

Hệ thống hướng đến các mục tiêu chính sau.

## BO-01

Xây dựng một nền tảng thống nhất để nghiên cứu các chiến lược giao dịch Cryptocurrency.

---

## BO-02

Cho phép bổ sung strategy mới mà không ảnh hưởng đến các strategy hiện có.

---

## BO-03

Cho phép thay đổi nguồn dữ liệu thị trường mà không làm thay đổi Frontend.

---

## BO-04

Tự động sinh và đánh giá nhiều composite strategy.

---

## BO-05

Backtest các strategy trên dữ liệu lịch sử.

---

## BO-06

Đánh giá hiệu quả giao dịch bằng nhiều chỉ số khác nhau thay vì chỉ Profit.

---

## BO-07

Xếp hạng các strategy dựa trên kết quả đánh giá.

---

## BO-08

Trực quan hóa toàn bộ tín hiệu giao dịch trên biểu đồ.

---

## BO-09

Thu thập và phân tích tin tức Cryptocurrency.

---

## BO-10

Thiết kế kiến trúc theo hướng dễ mở rộng, dễ thay đổi và dễ bảo trì nhằm đáp ứng trọng tâm của học phần Software Architecture.

# 5. System Scope

## 5.1 In Scope

Trong phạm vi đồ án, hệ thống sẽ cung cấp các chức năng sau.

### Market Data

- Kết nối Binance để lấy Historical Market Data.
- Kết nối Binance WebSocket để nhận Realtime Market Data.
- Chuẩn hóa dữ liệu thị trường thông qua Market Data Service.
- Lưu Historical Candlestick Data vào PostgreSQL.
- Hỗ trợ nhiều Timeframe.
- Thiết kế theo Adapter Pattern để có thể bổ sung Exchange mới trong tương lai.

---

### Multi-Timeframe Chart

- Hiển thị tối đa 4 biểu đồ đồng thời.
- Mỗi biểu đồ có thể lựa chọn Timeframe riêng.
- Thay đổi Timeframe mà không ảnh hưởng các biểu đồ còn lại.
- Hiển thị Candlestick.
- Hiển thị Volume.
- Hiển thị Technical Indicators.
- Hiển thị Buy/Sell Signal.
- Hiển thị Entry/Exit Point.
- Hiển thị Support/Resistance.

---

### Strategy Management

Hệ thống hỗ trợ tối thiểu bốn Strategy:

- Moving Average
- RSI
- Bollinger Bands
- Support / Resistance

Mỗi Strategy hoạt động độc lập và chỉ chịu trách nhiệm phân tích dữ liệu thị trường để sinh tín hiệu giao dịch.

Strategy không được:

- truy cập Database trực tiếp,
- gọi Binance API,
- cập nhật giao diện,
- thực hiện Backtesting.

---

### Composite Strategy

Hệ thống cho phép:

- kết hợp nhiều Strategy đơn lẻ,
- tính tín hiệu tổng hợp bằng Weighted Combination,
- mở rộng thêm phương pháp kết hợp khác trong tương lai.

---

### Strategy Search

Hệ thống hỗ trợ:

- Random Search
- Domain-guided Search

Search Engine phải có khả năng sinh Candidate Strategy mà không phụ thuộc vào Backtesting Engine.

---

### Backtesting

Cho phép:

- mô phỏng giao dịch trên Historical Data,
- hỗ trợ Long Position,
- hỗ trợ Short Position,
- Fixed Position Size,
- tính toán kết quả giao dịch.

Không nằm trong phạm vi MVP:

- Leverage
- Margin Trading
- Trading Fee
- Slippage
- Position Sizing nâng cao

---

### Strategy Evaluation

Đánh giá Strategy dựa trên:

- Total Return
- Win Rate
- Maximum Drawdown
- Number of Trades

Kiến trúc phải cho phép bổ sung thêm các chỉ số đánh giá khác.

---

### Leaderboard

Hiển thị:

- Top-K Strategy
- Ranking
- Overall Score
- Return
- Win Rate
- Maximum Drawdown
- Number of Trades

Leaderboard được tính toán theo thời gian thực từ kết quả Backtest.

---

### News

- Thu thập tin tức từ CryptoPanic API.
- Chuẩn hóa dữ liệu News.
- Lưu News vào PostgreSQL.
- Hỗ trợ mở rộng thêm News Provider.

---

### Sentiment Analysis

- Phân tích Sentiment bằng Gemini.
- Phân loại:
  - Positive
  - Neutral
  - Negative
- Lưu Sentiment Score.
- Cho phép tích hợp thành Strategy trong tương lai.

---

### Experiment Management

Lưu toàn bộ:

- Candidate Strategy
- Parameter
- Dataset
- Backtest Result
- Evaluation Result
- Ranking History

Đảm bảo khả năng tái lập (Reproducibility).

---

### Dashboard

Trader có thể truy cập:

- Dashboard
- Strategies
- Backtest
- Leaderboard
- News
- Experiments
- Settings

---

## 5.2 Out of Scope

Các chức năng sau không thuộc phạm vi MVP.

### Authentication

- Login
- Register
- Role Management
- Permission Management

Hiện tại hệ thống chỉ hỗ trợ một Trader mặc định.

---

### Live Trading

Hệ thống không:

- đặt lệnh thật,
- kết nối tài khoản Binance,
- giao dịch trực tiếp.

---

### Portfolio Management

Không quản lý:

- số dư,
- ví,
- tài sản,
- lịch sử giao dịch thật.

---

### Advanced Risk Management

Không triển khai:

- Stop Loss
- Take Profit
- Trailing Stop
- Dynamic Position Size
- Risk Management Engine

---

### Advanced Search

Không bắt buộc:

- Genetic Algorithm
- Bayesian Optimization
- Reinforcement Learning
- Evolutionary Search

Kiến trúc vẫn phải hỗ trợ bổ sung các thuật toán này trong tương lai.

---

### Multiple Exchange

MVP chỉ kết nối Binance.

Kiến trúc phải hỗ trợ mở rộng:

- OKX
- Bybit
- Coinbase

---

### Multiple Coin

MVP sử dụng:

- BTCUSDT

Kiến trúc phải cho phép mở rộng nhiều Coin Pair.

---

# 6. Assumptions and Constraints

## 6.1 Assumptions

Nhóm phát triển đưa ra các giả định sau.

### AS-01

Binance API và Binance WebSocket luôn sẵn sàng trong quá trình phát triển.

---

### AS-02

CryptoPanic API có thể truy cập trong phạm vi giới hạn miễn phí.

---

### AS-03

Gemini API đủ khả năng phân tích Sentiment của tin tức Cryptocurrency.

---

### AS-04

Người sử dụng có kiến thức cơ bản về giao dịch Cryptocurrency.

---

### AS-05

Historical Market Data đủ để thực hiện Backtesting.

---

### AS-06

Một Trader chỉ thao tác trên một phiên làm việc.

---

## 6.2 Technical Constraints

### TC-01

Frontend sử dụng:

- ReactJS
- TypeScript

---

### TC-02

Backend sử dụng:

- Node.js
- Express.js
- TypeScript

---

### TC-03

Database:

- PostgreSQL
- Supabase

---

### TC-04

Realtime Communication:

- Socket.IO

---

### TC-05

Queue:

- BullMQ

---

### TC-06

Event Bus:

- Node EventEmitter

---

### TC-07

Chart Library:

- TradingView Lightweight Charts

---

### TC-08

Development Environment:

- Windows
- Cursor

---

## 6.3 Architectural Constraints

Kiến trúc phải đáp ứng các yêu cầu sau.

### AC-01

Strategy phải được thiết kế theo Plugin Architecture.

---

### AC-02

Market Data Provider phải thông qua Adapter.

---

### AC-03

Frontend không được phụ thuộc trực tiếp vào Binance API.

---

### AC-04

Search Algorithm phải có khả năng thay thế mà không ảnh hưởng Backtester.

---

### AC-05

Backtesting Engine phải tách biệt khỏi Strategy Implementation.

---

### AC-06

Evaluation Engine phải tách biệt khỏi Backtesting Engine.

---

### AC-07

News Provider phải có khả năng thay thế.

---

### AC-08

Sentiment Service phải độc lập với News Collector.

---

### AC-09

Leaderboard không được phụ thuộc trực tiếp vào Search Engine.

---

### AC-10

Các Module phải giao tiếp thông qua abstraction hoặc event nhằm giảm coupling.

---

# 7. User Characteristics

## 7.1 Primary User

Trong phạm vi MVP, hệ thống chỉ có một loại người dùng:

**Trader**

---

## 7.2 Responsibilities

Trader có thể:

- xem dữ liệu thị trường,
- lựa chọn Timeframe,
- bật/tắt Strategy,
- cấu hình Composite Strategy,
- chạy Search,
- chạy Backtest,
- xem kết quả Evaluation,
- theo dõi Leaderboard,
- xem Trade History,
- xem News,
- xem Sentiment.

---

## 7.3 User Knowledge

Trader được giả định:

- hiểu cơ bản về Cryptocurrency,
- biết đọc Candlestick Chart,
- biết các Technical Indicator cơ bản,
- có khả năng sử dụng Dashboard.

Hệ thống không yêu cầu Trader có kiến thức chuyên sâu về Machine Learning hoặc Software Architecture.

---

## 7.4 Permissions

Trong MVP:

Trader có toàn quyền sử dụng mọi chức năng của hệ thống.

Không tồn tại:

- Admin
- Moderator
- Guest

Kiến trúc vẫn phải đủ khả năng mở rộng để bổ sung User Authentication và Role-Based Access Control trong tương lai.

---

# 8. Functional Requirements

## 8.1 Requirement Naming Convention

Mỗi Functional Requirement được định danh theo mẫu:

```
FR-XXX
```

Ví dụ:

- FR-001
- FR-002
- FR-003

Mỗi Requirement bao gồm:

- Requirement ID
- Name
- Priority
- Description
- Acceptance Criteria

---

# 8.2 Market Data

### FR-001 Connect Binance

**Priority:** Must Have

Hệ thống phải kết nối được Binance để lấy Historical Market Data.

---

### FR-002 Receive Realtime Data

**Priority:** Must Have

Hệ thống phải nhận dữ liệu Realtime Market Data thông qua WebSocket.

---

### FR-003 Normalize Market Data

**Priority:** Must Have

Hệ thống phải chuẩn hóa dữ liệu thị trường trước khi cung cấp cho các module khác.

---

### FR-004 Store Historical Data

**Priority:** Must Have

Hệ thống phải lưu Historical Candlestick Data vào PostgreSQL.

---

### FR-005 Support Multiple Timeframes

**Priority:** Must Have

Hệ thống phải hỗ trợ nhiều Timeframe theo dữ liệu do Binance cung cấp.

---

# 8.3 Chart

### FR-006 Display Candlestick Chart

Hiển thị Candlestick Chart.

---

### FR-007 Display Maximum Four Charts

Cho phép hiển thị tối đa bốn biểu đồ đồng thời.

---

### FR-008 Independent Timeframe

Mỗi Chart có thể thay đổi Timeframe độc lập.

---

### FR-009 Display Indicators

Hiển thị:

- MA
- RSI
- Bollinger
- Support
- Resistance

---

### FR-010 Display Trading Signals

Hiển thị:

- Buy
- Sell
- Entry
- Exit

---

# 8.4 Strategy

### FR-011 Support MA Strategy

Hệ thống phải hỗ trợ Moving Average Strategy.

---

### FR-012 Support RSI Strategy

Hệ thống phải hỗ trợ RSI Strategy.

---

### FR-013 Support Bollinger Strategy

Hệ thống phải hỗ trợ Bollinger Bands Strategy.

---

### FR-014 Support Support/Resistance Strategy

Hệ thống phải hỗ trợ Support / Resistance Strategy.

---

### FR-015 Register Strategy Plugin

Cho phép đăng ký Strategy mới mà không cần sửa Strategy Engine.

---

### FR-016 Execute Strategy

Cho phép thực thi Strategy trên dữ liệu thị trường.

---

### FR-017 Generate Trading Signal

Strategy phải trả về một trong ba tín hiệu:

- BUY
- SELL
- HOLD

---

### FR-018 Configure Composite Strategy

Cho phép lựa chọn nhiều Strategy để tạo Composite Strategy.

---

### FR-019 Weighted Combination

Composite Strategy phải sử dụng Weighted Combination để tạo tín hiệu cuối cùng.

---

# 8.5 Strategy Search

### FR-020 Generate Candidate Strategy

**Priority:** Must Have

Hệ thống phải có khả năng sinh Candidate Strategy để phục vụ quá trình Backtesting.

---

### FR-021 Random Search

**Priority:** Must Have

Hệ thống phải hỗ trợ Random Search để tạo Candidate Strategy ngẫu nhiên.

---

### FR-022 Domain-guided Search

**Priority:** Should Have

Hệ thống phải hỗ trợ Domain-guided Search bằng cách kết hợp các Strategy thuộc các nhóm phân tích khác nhau nhằm tạo ra Composite Strategy hợp lý.

Ví dụ:

- Trend
- Momentum
- Structure

---

### FR-023 Configure Search Parameters

**Priority:** Must Have

Trader có thể cấu hình:

- Search Algorithm
- Maximum Candidate
- Timeframe
- Historical Dataset

trước khi bắt đầu Strategy Search.

---

### FR-024 Start Search

**Priority:** Must Have

Trader có thể bắt đầu quá trình Strategy Search.

---

### FR-025 Stop Search

**Priority:** Must Have

Trader có thể dừng quá trình Strategy Search bất kỳ lúc nào.

---

### FR-026 Loop Stop Condition

**Priority:** Must Have

Hệ thống phải tự động dừng Strategy Search khi:

- đạt số lượng Candidate đã cấu hình,
- hoặc Trader chủ động dừng.

---

### FR-027 Search Progress

**Priority:** Should Have

Hệ thống phải hiển thị tiến trình Search bao gồm:

- số Candidate đã sinh,
- số Candidate đã Backtest,
- số Candidate còn lại,
- thời gian thực hiện.

---

### FR-028 Publish Search Event

**Priority:** Should Have

Sau mỗi Candidate được sinh thành công, hệ thống phải phát sinh sự kiện để các module khác tiếp tục xử lý mà không phụ thuộc trực tiếp vào Search Engine.

---

# 8.6 Backtesting

### FR-029 Execute Backtest

**Priority:** Must Have

Hệ thống phải cho phép Backtest một Strategy hoặc Composite Strategy trên dữ liệu lịch sử.

---

### FR-030 Historical Dataset Selection

**Priority:** Must Have

Trader có thể lựa chọn:

- Coin Pair
- Timeframe
- Khoảng thời gian Historical Data

để Backtest.

---

### FR-031 Long Position Simulation

**Priority:** Must Have

Backtesting Engine phải mô phỏng Long Position.

---

### FR-032 Short Position Simulation

**Priority:** Must Have

Backtesting Engine phải mô phỏng Short Position.

---

### FR-033 Fixed Position Size

**Priority:** Must Have

Mỗi giao dịch Backtest sử dụng Fixed Position Size.

---

### FR-034 Trading Simulation

**Priority:** Must Have

Backtesting Engine phải mô phỏng toàn bộ lịch sử giao dịch phát sinh từ Strategy.

---

### FR-035 Generate Trade History

**Priority:** Must Have

Sau khi Backtest hoàn thành, hệ thống phải sinh lịch sử giao dịch.

Mỗi giao dịch bao gồm:

- Entry Time
- Entry Price
- Exit Time
- Exit Price
- Position
- Profit/Loss

---

### FR-036 Store Backtest Result

**Priority:** Must Have

Hệ thống phải lưu toàn bộ kết quả Backtest để phục vụ việc phân tích và tái lập kết quả.

---

### FR-037 Support Multiple Experiments

**Priority:** Should Have

Hệ thống phải cho phép thực hiện nhiều lần Backtest trên các Candidate Strategy khác nhau.

---

# 8.7 Strategy Evaluation

### FR-038 Calculate Total Return

**Priority:** Must Have

Hệ thống phải tính Total Return của Strategy.

---

### FR-039 Calculate Win Rate

**Priority:** Must Have

Hệ thống phải tính Win Rate.

---

### FR-040 Calculate Maximum Drawdown

**Priority:** Must Have

Hệ thống phải tính Maximum Drawdown.

---

### FR-041 Calculate Number of Trades

**Priority:** Must Have

Hệ thống phải tính tổng số giao dịch.

---

### FR-042 Calculate Overall Score

**Priority:** Must Have

Hệ thống phải tính Overall Score dựa trên các chỉ số đánh giá.

Công thức cụ thể sẽ được nhóm định nghĩa trong tài liệu Architecture Decision Record (ADR) và có thể thay đổi mà không ảnh hưởng đến các module khác.

---

### FR-043 Independent Evaluation Engine

**Priority:** Must Have

Evaluation Engine phải hoạt động độc lập với Strategy Engine và Backtesting Engine.

---

# 8.8 Leaderboard

### FR-044 Display Leaderboard

**Priority:** Must Have

Hệ thống phải hiển thị Leaderboard.

---

### FR-045 Top-K Strategy

**Priority:** Must Have

Leaderboard chỉ hiển thị Top-K Strategy.

Giá trị mặc định:

- Top 10

---

### FR-046 Real-time Leaderboard Update

**Priority:** Must Have

Leaderboard phải được cập nhật tự động khi có Strategy mới đạt kết quả tốt hơn.

---

### FR-047 Sort Leaderboard

**Priority:** Should Have

Trader có thể sắp xếp Leaderboard theo:

- Overall Score
- Total Return
- Win Rate
- Maximum Drawdown
- Number of Trades

---

### FR-048 Strategy Detail

**Priority:** Must Have

Trader có thể xem chi tiết Strategy trên Leaderboard.

Thông tin bao gồm:

- Parameters
- Metrics
- Trade History
- Version
- Composite Components

---

### FR-049 Ranking History

**Priority:** Should Have

Hệ thống phải lưu lịch sử thay đổi thứ hạng của Strategy.

---

# 8.9 News

### FR-050 Collect News

**Priority:** Must Have

Hệ thống phải thu thập tin tức Cryptocurrency từ CryptoPanic API.

---

### FR-051 Normalize News

**Priority:** Must Have

Toàn bộ dữ liệu News phải được chuẩn hóa về cùng một định dạng trước khi lưu trữ.

---

### FR-052 Store News

**Priority:** Must Have

Tin tức phải được lưu vào PostgreSQL.

---

### FR-053 Display News

**Priority:** Must Have

Trader có thể xem danh sách tin tức đã thu thập.

---

### FR-054 News Detail

**Priority:** Should Have

Trader có thể xem:

- tiêu đề,
- nội dung,
- nguồn,
- thời gian,
- Coin liên quan.

---

### FR-055 Support Multiple News Providers

**Priority:** Should Have

Kiến trúc phải cho phép bổ sung News Provider mới mà không ảnh hưởng đến các module phía sau.

---

# 8.10 Sentiment Analysis

### FR-056 Analyze Sentiment

**Priority:** Must Have

Hệ thống phải phân tích Sentiment của mỗi News bằng Gemini.

---

### FR-057 Sentiment Classification

**Priority:** Must Have

Kết quả phân tích phải thuộc một trong ba nhóm:

- Positive
- Neutral
- Negative

---

### FR-058 Sentiment Score

**Priority:** Must Have

Hệ thống phải lưu Sentiment Score cho từng News.

---

### FR-059 Display Sentiment

**Priority:** Must Have

Trader có thể xem kết quả Sentiment trên giao diện.

---

### FR-060 Independent Sentiment Service

**Priority:** Must Have

Sentiment Analysis phải được thiết kế độc lập với News Collector để có thể thay đổi mô hình AI trong tương lai.

---

# 8.11 Experiment Management

### FR-061 Store Experiment

**Priority:** Must Have

Hệ thống phải lưu toàn bộ thông tin của mỗi Experiment.

---

### FR-062 Experiment Version

**Priority:** Must Have

Mỗi Experiment phải liên kết với phiên bản Strategy tương ứng nhằm đảm bảo khả năng tái lập kết quả.

---

### FR-063 View Experiment History

**Priority:** Must Have

Trader có thể xem danh sách các Experiment đã thực hiện.

---

### FR-064 Compare Experiments

**Priority:** Should Have

Trader có thể so sánh kết quả giữa nhiều Experiment.

---

# 8.12 Dashboard

### FR-065 Dashboard Overview

**Priority:** Must Have

Dashboard phải hiển thị tổng quan hệ thống bao gồm:

- Market Data
- Charts
- Search Status
- Leaderboard
- News

---

### FR-066 Strategy Page

**Priority:** Must Have

Trader có thể quản lý và lựa chọn Strategy.

---

### FR-067 Backtest Page

**Priority:** Must Have

Trader có thể cấu hình và chạy Backtest.

---

### FR-068 Leaderboard Page

**Priority:** Must Have

Trader có thể xem bảng xếp hạng Strategy.

---

### FR-069 News Page

**Priority:** Must Have

Trader có thể xem danh sách tin tức và Sentiment.

---

### FR-070 Experiment Page

**Priority:** Must Have

Trader có thể xem lịch sử Experiment.

---

### FR-071 Settings Page

**Priority:** Should Have

Trader có thể cấu hình:

- Timeframe mặc định
- Top-K
- Search Parameters
- Realtime Options

---

### FR-072 Real-time Notification

**Priority:** Should Have

Hệ thống phải hiển thị thông báo khi:

- Backtest hoàn thành,
- Leaderboard thay đổi,
- Search kết thúc,
- xảy ra lỗi trong quá trình xử lý.

---

# 8.13 Logging & Monitoring

### FR-073 Record System Log

**Priority:** Must Have

Hệ thống phải ghi nhận các sự kiện quan trọng để phục vụ việc theo dõi và gỡ lỗi.

---

### FR-074 Record Search Progress

**Priority:** Should Have

Hệ thống phải lưu trạng thái thực hiện của Strategy Search.

---

### FR-075 Record Worker Status

**Priority:** Should Have

Hệ thống phải theo dõi trạng thái của các Backtest Worker.

---

### FR-076 Display System Status

**Priority:** Should Have

Dashboard phải hiển thị trạng thái của các thành phần chính như:

- Market Data Service
- Strategy Search
- Backtesting
- Queue
- WebSocket Connection

---

## 8.14 Functional Requirement Summary

| Module               | Requirement ID  |
| -------------------- | --------------- |
| Market Data          | FR-001 → FR-005 |
| Chart                | FR-006 → FR-010 |
| Strategy             | FR-011 → FR-019 |
| Strategy Search      | FR-020 → FR-028 |
| Backtesting          | FR-029 → FR-037 |
| Strategy Evaluation  | FR-038 → FR-043 |
| Leaderboard          | FR-044 → FR-049 |
| News                 | FR-050 → FR-055 |
| Sentiment            | FR-056 → FR-060 |
| Experiment           | FR-061 → FR-064 |
| Dashboard            | FR-065 → FR-072 |
| Logging & Monitoring | FR-073 → FR-076 |

# 9. Non-functional Requirements

## 9.1 Overview

Do trọng tâm của đồ án là **Software Architecture**, các yêu cầu phi chức năng (Non-functional Requirements - NFR) đóng vai trò quan trọng không kém các yêu cầu chức năng.

Các NFR dưới đây được xây dựng dựa trên:

- các Architectural Drivers trong đề bài,
- phạm vi MVP của nhóm,
- các quyết định kiến trúc đã thống nhất.

---

# 9.2 Requirement Naming Convention

Mỗi Non-functional Requirement được định danh theo mẫu:

```
NFR-XXX
```

Ví dụ:

- NFR-001
- NFR-002

Mỗi Requirement bao gồm:

- Requirement ID
- Category
- Priority
- Description
- Acceptance Criteria

---

# 9.3 Modifiability

Khả năng thay đổi là yêu cầu quan trọng nhất của hệ thống.

---

### NFR-001 Strategy Extensibility

**Category**

Modifiability

**Priority**

Must Have

**Description**

Hệ thống phải cho phép bổ sung một Strategy mới mà không cần sửa đổi Strategy Engine hoặc các Strategy hiện có.

**Acceptance Criteria**

Chỉ cần:

- tạo Strategy mới,
- đăng ký vào Strategy Registry.

Không phải chỉnh sửa:

- Controller
- Backtester
- Evaluation Engine
- Leaderboard
- UI

---

### NFR-002 Search Algorithm Extensibility

Hệ thống phải cho phép thay thế:

- Random Search

bằng:

- Domain-guided Search
- Genetic Search
- Evolutionary Search

mà không ảnh hưởng tới Backtesting Engine.

---

### NFR-003 Market Provider Extensibility

Có thể bổ sung:

- OKX
- Bybit
- Coinbase

mà không thay đổi Frontend.

---

### NFR-004 News Provider Extensibility

Có thể bổ sung:

- RSS
- CoinDesk
- CoinTelegraph

mà không sửa News Service.

---

### NFR-005 Sentiment Model Extensibility

Có thể thay Gemini bằng:

- OpenAI
- HuggingFace
- Local Model

mà không ảnh hưởng Strategy Engine.

---

### NFR-006 Indicator Extensibility

Cho phép bổ sung Indicator mới mà không phải sửa Indicator hiện có.

---

# 9.4 Scalability

---

### NFR-007 Backtesting Scalability

Backtesting Engine phải hỗ trợ mở rộng Worker trong tương lai.

---

### NFR-008 Queue Scalability

Hệ thống phải sử dụng Queue để tách quá trình Generate Strategy khỏi Backtesting.

---

### NFR-009 Event Scalability

Các module ưu tiên giao tiếp thông qua Event thay vì gọi trực tiếp.

---

### NFR-010 Future Horizontal Scaling

Kiến trúc phải hỗ trợ khả năng mở rộng nhiều Worker trong tương lai mà không cần thay đổi Business Logic.

---

# 9.5 Performance

---

### NFR-011 Realtime Update Latency

Realtime Market Data phải được cập nhật lên Dashboard với độ trễ thấp nhất có thể thông qua Socket.IO.

---

### NFR-012 Independent Chart Refresh

Khi Trader thay đổi Timeframe của một Chart thì chỉ Chart đó được cập nhật.

Không reload toàn bộ Dashboard.

---

### NFR-013 Historical Data Reuse

Historical Data sau khi tải về phải được lưu vào Database để tránh tải lại không cần thiết.

---

### NFR-014 Background Processing

Backtesting phải chạy nền.

Dashboard vẫn có thể tiếp tục sử dụng.

---

### NFR-015 Non-blocking Search

Quá trình Strategy Search không được làm treo Backend.

---

# 9.6 Reliability

---

### NFR-016 Binance Reconnection

Nếu Binance WebSocket bị mất kết nối, hệ thống phải tự động thực hiện cơ chế reconnect.

---

### NFR-017 Worker Failure Isolation

Nếu một Backtest Worker gặp lỗi thì các Worker khác vẫn tiếp tục hoạt động.

---

### NFR-018 Event Failure Isolation

Lỗi của một Event Handler không được làm dừng toàn bộ Event Bus.

---

### NFR-019 News Failure Isolation

Nếu News Collector gặp lỗi thì:

- Chart
- Strategy
- Backtesting

vẫn hoạt động bình thường.

---

### NFR-020 Graceful Error Handling

Hệ thống phải xử lý lỗi một cách an toàn và hiển thị thông báo phù hợp cho Trader.

Không được dừng toàn bộ ứng dụng do một lỗi đơn lẻ.

---

# 9.7 Maintainability

---

### NFR-021 Modular Architecture

Hệ thống phải được chia thành các Module độc lập.

---

### NFR-022 Low Coupling

Các Module phải giảm phụ thuộc trực tiếp vào nhau.

---

### NFR-023 High Cohesion

Mỗi Module chỉ chịu trách nhiệm cho một nhóm chức năng cụ thể.

---

### NFR-024 Layer Separation

Controller không được chứa Business Logic.

Repository không được chứa Business Logic.

---

### NFR-025 Single Responsibility

Mỗi Class chỉ nên có một trách nhiệm chính.

---

### NFR-026 Dependency Inversion

Các Module nên phụ thuộc vào Interface hoặc Abstraction thay vì Implementation cụ thể.

---

# 9.8 Availability

---

### NFR-027 Continuous Dashboard

Dashboard phải tiếp tục hoạt động ngay cả khi Strategy Search đang chạy.

---

### NFR-028 Background Search

Trader có thể tiếp tục sử dụng Dashboard trong khi Search Engine hoạt động.

---

# 9.9 Usability

---

### NFR-029 Responsive Dashboard

Dashboard phải hiển thị tốt trên các độ phân giải màn hình Desktop phổ biến.

---

### NFR-030 Simple Navigation

Các chức năng chính phải được truy cập thông qua Sidebar hoặc Navigation Menu.

---

### NFR-031 Consistent UI

Các màn hình phải thống nhất về:

- màu sắc,
- typography,
- spacing,
- icon,
- layout.

---

### NFR-032 Real-time Feedback

Trader luôn biết:

- Search đang chạy,
- Backtest đang chạy,
- Queue còn bao nhiêu Job,
- Leaderboard đã cập nhật hay chưa.

---

# 9.10 Security

Trong phạm vi MVP, hệ thống chưa triển khai Authentication hoàn chỉnh.

Tuy nhiên kiến trúc vẫn phải đủ khả năng mở rộng.

---

### NFR-033 Future Authentication

Kiến trúc phải hỗ trợ bổ sung:

- Login
- Register
- JWT
- RBAC

trong tương lai.

---

### NFR-034 Secure API Key

API Key của Binance, CryptoPanic và Gemini không được hard-code trong Source Code.

---

### NFR-035 Environment Configuration

Thông tin cấu hình phải được lưu trong Environment Variables.

---

# 9.11 Observability

---

### NFR-036 Application Logging

Hệ thống phải ghi Log cho các sự kiện quan trọng.

Ví dụ:

- Start Search
- End Search
- Start Backtest
- Worker Error
- WebSocket Disconnect

---

### NFR-037 Queue Monitoring

Có khả năng theo dõi:

- Pending Jobs
- Running Jobs
- Failed Jobs
- Completed Jobs

---

### NFR-038 Search Monitoring

Có thể theo dõi:

- số Candidate đã thử,
- Candidate hiện tại,
- thời gian thực hiện.

---

### NFR-039 Strategy Ranking Monitoring

Có thể xác định Strategy nào đang đứng Top 1.

---

### NFR-040 WebSocket Monitoring

Có thể theo dõi:

- Connected
- Reconnecting
- Disconnected

---

# 9.12 Reproducibility

---

### NFR-041 Strategy Versioning

Mỗi Strategy phải có Version riêng.

---

### NFR-042 Experiment Traceability

Mỗi Experiment phải xác định được:

- Strategy Version
- Dataset
- Parameters
- Timeframe

---

### NFR-043 Immutable Experiment Result

Kết quả Experiment sau khi lưu không được ghi đè.

Nếu Strategy thay đổi phải tạo Version mới.

---

# 9.13 Compatibility

---

### NFR-044 Browser Compatibility

Hệ thống phải hoạt động trên các trình duyệt hiện đại:

- Google Chrome
- Microsoft Edge

---

### NFR-045 Operating System Compatibility

Môi trường phát triển chính:

- Windows

Kiến trúc không phụ thuộc hệ điều hành.

---

# 9.14 Coding Standards

---

### NFR-046 Programming Language

Frontend và Backend đều sử dụng TypeScript.

---

### NFR-047 Code Convention

Toàn bộ Source Code phải tuân theo Coding Convention thống nhất.

---

### NFR-048 Layer Naming Convention

Tên Module, Package và Folder phải nhất quán theo Modular Layered Architecture.

---

### NFR-049 Documentation

Các Component quan trọng phải có tài liệu mô tả.

---

### NFR-050 Architecture Decision Record

Các quyết định kiến trúc quan trọng phải được ghi lại bằng ADR.

---

# 9.15 Non-functional Requirement Summary

| Category         | Requirement ID    |
| ---------------- | ----------------- |
| Modifiability    | NFR-001 → NFR-006 |
| Scalability      | NFR-007 → NFR-010 |
| Performance      | NFR-011 → NFR-015 |
| Reliability      | NFR-016 → NFR-020 |
| Maintainability  | NFR-021 → NFR-026 |
| Availability     | NFR-027 → NFR-028 |
| Usability        | NFR-029 → NFR-032 |
| Security         | NFR-033 → NFR-035 |
| Observability    | NFR-036 → NFR-040 |
| Reproducibility  | NFR-041 → NFR-043 |
| Compatibility    | NFR-044 → NFR-045 |
| Coding Standards | NFR-046 → NFR-050 |

# 10. Business Rules

## 10.1 Overview

Business Rules (BR) định nghĩa các quy tắc nghiệp vụ mà toàn bộ hệ thống phải tuân thủ trong quá trình xử lý dữ liệu và thực hiện các chức năng.

Các Business Rules được áp dụng xuyên suốt các module của hệ thống và là cơ sở để xây dựng Use Case, API, Database cũng như Business Logic.

---

## 10.2 Rule Naming Convention

Mỗi Business Rule được định danh theo mẫu:

```
BR-XXX
```

Ví dụ:

- BR-001
- BR-002

---

# 10.3 Market Data Rules

### BR-001

Hệ thống chỉ sử dụng dữ liệu thị trường đã được chuẩn hóa bởi Market Data Service.

Không module nào được truy cập trực tiếp Binance API.

---

### BR-002

Realtime Market Data phải được nhận thông qua WebSocket.

Frontend không được Polling liên tục để lấy dữ liệu giá.

---

### BR-003

Historical Market Data sau khi tải thành công phải được lưu vào Database để phục vụ Backtesting.

---

### BR-004

Mỗi Candlestick được xác định duy nhất bởi:

- Coin Pair
- Timeframe
- Open Time

---

# 10.4 Chart Rules

### BR-005

Một Dashboard chỉ được hiển thị tối đa bốn Chart đồng thời.

---

### BR-006

Mỗi Chart hoạt động độc lập.

Việc thay đổi Timeframe của một Chart không được làm ảnh hưởng đến các Chart còn lại.

---

### BR-007

Chart chỉ hiển thị dữ liệu đã được xử lý từ Backend.

Frontend không được tự tính Technical Indicator.

---

# 10.5 Strategy Rules

### BR-008

Mỗi Strategy chỉ chịu trách nhiệm sinh tín hiệu giao dịch.

Strategy không được:

- truy cập Database,
- gọi API,
- cập nhật giao diện,
- thực hiện Backtesting.

---

### BR-009

Mỗi Strategy chỉ được trả về một trong ba tín hiệu:

- BUY
- SELL
- HOLD

---

### BR-010

Mỗi Strategy phải có:

- ID
- Name
- Version
- Parameters

---

### BR-011

Mỗi Strategy phải có Version riêng.

Việc thay đổi tham số hoặc thuật toán phải tạo Version mới thay vì ghi đè lên Version cũ.

---

# 10.6 Composite Strategy Rules

### BR-012

Composite Strategy phải được tạo từ tối thiểu hai Strategy.

---

### BR-013

Composite Strategy sử dụng phương pháp Weighted Combination để tạo tín hiệu cuối cùng.

---

### BR-014

Tổng trọng số của các Strategy trong Composite Strategy phải bằng 1.0.

---

### BR-015

Nếu Composite Strategy chứa Strategy không hợp lệ thì Candidate đó không được thực hiện Backtest.

---

# 10.7 Strategy Search Rules

### BR-016

Strategy Search chỉ được tạo Candidate từ các Strategy đã đăng ký trong Strategy Registry.

---

### BR-017

Một Candidate Strategy không được chứa cùng một Strategy nhiều lần.

Ví dụ:

```
MA + MA + RSI
```

không hợp lệ.

---

### BR-018

Strategy Search phải dừng khi:

- đạt số lượng Candidate được cấu hình,
- hoặc Trader chủ động dừng.

---

### BR-019

Mỗi Candidate Strategy phải được gán một định danh duy nhất (Candidate ID).

---

# 10.8 Backtesting Rules

### BR-020

Backtesting chỉ sử dụng Historical Market Data.

---

### BR-021

Backtesting không được sử dụng Realtime Market Data.

---

### BR-022

Mỗi Backtest chỉ thực hiện trên một Coin Pair và một Timeframe tại một thời điểm.

---

### BR-023

Mỗi giao dịch phải có đầy đủ:

- Entry Time
- Entry Price
- Exit Time
- Exit Price
- Position
- Result

---

### BR-024

Backtesting sử dụng Fixed Position Size.

---

### BR-025

Không áp dụng:

- Leverage
- Trading Fee
- Slippage

trong phạm vi MVP.

---

# 10.9 Evaluation Rules

### BR-026

Evaluation chỉ được thực hiện sau khi Backtesting hoàn thành.

---

### BR-027

Evaluation Engine không được phụ thuộc trực tiếp vào Strategy Engine.

---

### BR-028

Overall Score phải được tính từ các chỉ số đánh giá.

Công thức tính có thể thay đổi mà không ảnh hưởng đến các module khác.

---

# 10.10 Leaderboard Rules

### BR-029

Leaderboard chỉ hiển thị Top-K Strategy.

---

### BR-030

Mặc định:

```
Top-K = 10
```

Trader có thể thay đổi giá trị này trong phần Settings.

---

### BR-031

Một Strategy chỉ được xuất hiện một lần trên Leaderboard.

---

### BR-032

Leaderboard chỉ được cập nhật khi Backtest và Evaluation hoàn tất.

---

# 10.11 News Rules

### BR-033

Mỗi News phải có:

- Source
- Published Time
- Crawled Time

---

### BR-034

Một News không được lưu trùng lặp.

---

### BR-035

Mỗi News chỉ được phân tích Sentiment một lần cho cùng một phiên bản mô hình.

---

# 10.12 Sentiment Rules

### BR-036

Sentiment chỉ thuộc một trong ba trạng thái:

- Positive
- Neutral
- Negative

---

### BR-037

Sentiment Score phải nằm trong khoảng:

```
-1.0 → 1.0
```

---

# 10.13 Experiment Rules

### BR-038

Mỗi Experiment phải lưu:

- Strategy Version
- Dataset
- Parameters
- Evaluation Result

---

### BR-039

Experiment sau khi hoàn thành không được chỉnh sửa.

Nếu chạy lại phải tạo Experiment mới.

---

# 10.14 Event Rules

### BR-040

Các module không nên gọi trực tiếp lẫn nhau khi có thể sử dụng Event.

---

### BR-041

Các Event phải được xử lý bất đồng bộ khi phù hợp.

---

### BR-042

Lỗi của một Event Handler không được làm dừng toàn bộ hệ thống.

---

# 10.15 Versioning Rules

### BR-043

Mỗi Strategy Version phải được lưu vĩnh viễn.

---

### BR-044

Mỗi Experiment phải truy vết được Strategy Version đã sử dụng.

---

### BR-045

Không được ghi đè dữ liệu lịch sử của Strategy hoặc Experiment.

---

# 10.16 Summary

Business Rules là tập hợp các quy tắc nghiệp vụ mà toàn bộ hệ thống phải tuân thủ trong quá trình vận hành.

Các quy tắc này là cơ sở để:

- xây dựng Use Case,
- thiết kế Database,
- thiết kế API,
- triển khai Business Logic,
- kiểm thử hệ thống.

Mọi thành phần của hệ thống đều phải tuân thủ các Business Rules được định nghĩa trong tài liệu này.

# 11. Use Case Specification

## 11.1 Overview

Use Case Specification mô tả các tương tác giữa **Trader** và hệ thống.

Trong phạm vi MVP, hệ thống chỉ có **một Actor duy nhất** là **Trader**.

Mỗi Use Case sẽ mô tả:

- Mục đích
- Điều kiện tiên quyết (Preconditions)
- Điều kiện sau khi hoàn thành (Postconditions)
- Luồng chính (Main Flow)
- Luồng thay thế (Alternative Flow)
- Functional Requirements liên quan

---

# 11.2 Primary Actor

## Trader

Trader là người sử dụng trực tiếp hệ thống.

Trader có thể:

- xem dữ liệu thị trường,
- lựa chọn Strategy,
- chạy Strategy Search,
- chạy Backtest,
- xem kết quả,
- theo dõi Leaderboard,
- xem News,
- xem Sentiment,
- quản lý Experiments.

---

# 11.3 Use Case List

| UC ID  | Use Case                  | Primary Actor |
| ------ | ------------------------- | ------------- |
| UC-001 | View Market Dashboard     | Trader        |
| UC-002 | Configure Strategy        | Trader        |
| UC-003 | Create Composite Strategy | Trader        |
| UC-004 | Execute Strategy Search   | Trader        |
| UC-005 | Execute Backtest          | Trader        |
| UC-006 | View Backtest Result      | Trader        |
| UC-007 | View Leaderboard          | Trader        |
| UC-008 | View News                 | Trader        |
| UC-009 | View Sentiment            | Trader        |
| UC-010 | View Experiment History   | Trader        |
| UC-011 | Configure System Settings | Trader        |

---

# UC-001 View Market Dashboard

## Goal

Cho phép Trader theo dõi dữ liệu thị trường theo thời gian thực.

---

## Primary Actor

Trader

---

## Preconditions

- Hệ thống đang hoạt động.
- Binance WebSocket đã được kết nối.

---

## Postconditions

- Dashboard hiển thị dữ liệu mới nhất.
- Trader có thể tiếp tục thực hiện các thao tác khác.

---

## Main Flow

1. Trader mở Dashboard.
2. Hệ thống tải Historical Market Data.
3. Hệ thống thiết lập kết nối WebSocket.
4. Dashboard hiển thị Candlestick Chart.
5. Dashboard hiển thị Technical Indicators.
6. Dashboard cập nhật Realtime Market Data.

---

## Alternative Flow

### A1

Nếu WebSocket mất kết nối:

- hiển thị trạng thái Reconnecting,
- tự động thực hiện kết nối lại.

---

## Related Functional Requirements

- FR-001
- FR-002
- FR-006
- FR-007
- FR-008
- FR-009

---

# UC-002 Configure Strategy

## Goal

Cho phép Trader lựa chọn Strategy để sử dụng.

---

## Primary Actor

Trader

---

## Preconditions

Danh sách Strategy đã được khởi tạo.

---

## Postconditions

Strategy được lưu vào cấu hình hiện tại.

---

## Main Flow

1. Trader mở trang Strategies.
2. Hệ thống hiển thị danh sách Strategy.
3. Trader chọn Strategy.
4. Trader cấu hình tham số (nếu có).
5. Hệ thống lưu cấu hình.

---

## Alternative Flow

### A1

Trader hủy thao tác.

Không có thay đổi nào được lưu.

---

## Related Functional Requirements

- FR-011
- FR-012
- FR-013
- FR-014
- FR-015
- FR-016

---

# UC-003 Create Composite Strategy

## Goal

Cho phép Trader tạo Composite Strategy.

---

## Preconditions

Có ít nhất hai Strategy khả dụng.

---

## Postconditions

Composite Strategy được tạo thành công.

---

## Main Flow

1. Trader chọn nhiều Strategy.
2. Trader cấu hình trọng số.
3. Hệ thống kiểm tra tổng trọng số.
4. Hệ thống tạo Composite Strategy.
5. Composite Strategy được lưu.

---

## Alternative Flow

### A1

Nếu tổng trọng số khác 1.0:

- hệ thống hiển thị lỗi,
- không cho phép lưu.

---

## Related Functional Requirements

- FR-018
- FR-019

---

# UC-004 Execute Strategy Search

## Goal

Tìm kiếm Candidate Strategy.

---

## Preconditions

- Strategy đã được cấu hình.
- Historical Data khả dụng.

---

## Postconditions

Danh sách Candidate Strategy được tạo.

---

## Main Flow

1. Trader mở trang Backtest.
2. Trader chọn Search Algorithm.
3. Trader cấu hình Maximum Candidate.
4. Trader nhấn Start Search.
5. Search Engine sinh Candidate Strategy.
6. Hệ thống cập nhật Progress.
7. Search kết thúc.

---

## Alternative Flow

### A1

Trader nhấn Stop.

Search kết thúc ngay sau Candidate hiện tại.

---

## Related Functional Requirements

- FR-020
- FR-021
- FR-022
- FR-023
- FR-024
- FR-025
- FR-026
- FR-027

---

# UC-005 Execute Backtest

## Goal

Đánh giá Strategy trên dữ liệu lịch sử.

---

## Preconditions

- Có Candidate Strategy hợp lệ.
- Historical Data đã sẵn sàng.

---

## Postconditions

Backtest hoàn thành.

---

## Main Flow

1. Trader chọn Candidate Strategy.
2. Trader chọn Timeframe.
3. Trader chọn khoảng thời gian Backtest.
4. Trader nhấn Start Backtest.
5. Backtesting Engine chạy mô phỏng.
6. Trade History được tạo.
7. Evaluation Engine tính toán các chỉ số.
8. Kết quả được lưu.

---

## Alternative Flow

### A1

Historical Data không tồn tại.

Hệ thống tải dữ liệu trước khi Backtest.

---

## Related Functional Requirements

- FR-029
- FR-030
- FR-031
- FR-032
- FR-033
- FR-034
- FR-035
- FR-036
- FR-038
- FR-039
- FR-040
- FR-041
- FR-042

---

# UC-006 View Backtest Result

## Goal

Cho phép Trader xem kết quả Backtest.

---

## Preconditions

Đã có ít nhất một Backtest hoàn thành.

---

## Postconditions

Trader xem được đầy đủ kết quả.

---

## Main Flow

1. Trader mở Experiment.
2. Chọn Backtest Result.
3. Hệ thống hiển thị:
   - Overall Score
   - Total Return
   - Win Rate
   - Maximum Drawdown
   - Number of Trades
4. Trader xem Trade History.
5. Trader xem biểu đồ Entry/Exit.

---

## Related Functional Requirements

- FR-035
- FR-036
- FR-038
- FR-039
- FR-040
- FR-041
- FR-042

---

# UC-007 View Leaderboard

## Goal

Theo dõi Strategy có kết quả tốt nhất.

---

## Preconditions

Đã có dữ liệu Evaluation.

---

## Postconditions

Leaderboard được hiển thị.

---

## Main Flow

1. Trader mở trang Leaderboard.
2. Hệ thống tải Top-K Strategy.
3. Hệ thống hiển thị:
   - Ranking
   - Strategy
   - Overall Score
   - Total Return
   - Win Rate
4. Trader xem chi tiết Strategy.

---

## Related Functional Requirements

- FR-044
- FR-045
- FR-046
- FR-047
- FR-048
- FR-049

---

# UC-008 View News

## Goal

Theo dõi tin tức Cryptocurrency.

---

## Preconditions

News Collector đã thu thập dữ liệu.

---

## Postconditions

Trader xem được danh sách News.

---

## Main Flow

1. Trader mở News Page.
2. Hệ thống tải News.
3. Hiển thị:
   - Title
   - Source
   - Publish Time
4. Trader mở chi tiết News.

---

## Related Functional Requirements

- FR-050
- FR-051
- FR-052
- FR-053
- FR-054

---

# UC-009 View Sentiment

## Goal

Xem kết quả phân tích Sentiment của từng News.

---

## Preconditions

News đã được phân tích.

---

## Postconditions

Trader xem được Sentiment.

---

## Main Flow

1. Trader mở News Detail.
2. Hệ thống hiển thị:
   - Positive / Neutral / Negative
   - Sentiment Score
3. Trader tiếp tục xem các News khác.

---

## Related Functional Requirements

- FR-056
- FR-057
- FR-058
- FR-059

---

# UC-010 View Experiment History

## Goal

Theo dõi các Experiment đã thực hiện.

---

## Preconditions

Có ít nhất một Experiment.

---

## Postconditions

Danh sách Experiment được hiển thị.

---

## Main Flow

1. Trader mở Experiments.
2. Hệ thống tải danh sách.
3. Trader chọn một Experiment.
4. Hệ thống hiển thị:
   - Strategy
   - Version
   - Parameters
   - Evaluation Result
5. Trader có thể so sánh các Experiment.

---

## Related Functional Requirements

- FR-061
- FR-062
- FR-063
- FR-064

---

# UC-011 Configure System Settings

## Goal

Cho phép Trader cấu hình các thiết lập chung của hệ thống.

---

## Preconditions

Trader đang sử dụng hệ thống.

---

## Postconditions

Các thiết lập mới được lưu và áp dụng.

---

## Main Flow

1. Trader mở trang Settings.
2. Hệ thống hiển thị các tùy chọn cấu hình.
3. Trader thay đổi:
   - Top-K Leaderboard
   - Search Parameters
   - Default Timeframe
4. Trader nhấn Save.
5. Hệ thống lưu cấu hình.

---

## Related Functional Requirements

- FR-071
- FR-072

---

# 11.4 Use Case Relationship Summary

| Actor  | Use Case                  |
| ------ | ------------------------- |
| Trader | View Market Dashboard     |
| Trader | Configure Strategy        |
| Trader | Create Composite Strategy |
| Trader | Execute Strategy Search   |
| Trader | Execute Backtest          |
| Trader | View Backtest Result      |
| Trader | View Leaderboard          |
| Trader | View News                 |
| Trader | View Sentiment            |
| Trader | View Experiment History   |
| Trader | Configure System Settings |

---

# 11.5 Use Case Traceability

| Use Case | Related FR      |
| -------- | --------------- |
| UC-001   | FR-001 → FR-010 |
| UC-002   | FR-011 → FR-017 |
| UC-003   | FR-018 → FR-019 |
| UC-004   | FR-020 → FR-028 |
| UC-005   | FR-029 → FR-043 |
| UC-006   | FR-035 → FR-042 |
| UC-007   | FR-044 → FR-049 |
| UC-008   | FR-050 → FR-055 |
| UC-009   | FR-056 → FR-060 |
| UC-010   | FR-061 → FR-064 |
| UC-011   | FR-071 → FR-072 |

# 12. User Stories

## 12.1 Overview

User Stories mô tả hệ thống từ góc nhìn của **Trader**.

Mỗi User Story được viết theo định dạng chuẩn Agile:

> **As a** <Actor>  
> **I want** <Goal>  
> **So that** <Business Value>

Mỗi User Story được liên kết với:

- Functional Requirements (FR)
- Use Cases (UC)

để đảm bảo khả năng truy vết (Traceability).

---

# 12.2 Story Naming Convention

Mỗi User Story được định danh theo mẫu:

```
US-XXX
```

Ví dụ:

- US-001
- US-002

---

# 12.3 Dashboard

---

## US-001 View Market Dashboard

**As a** Trader

**I want** xem dữ liệu thị trường theo thời gian thực

**So that** tôi có thể theo dõi diễn biến giá trước khi phân tích Strategy.

### Related Use Case

UC-001

### Related Functional Requirements

FR-001 → FR-010

---

## US-002 View Multiple Charts

**As a** Trader

**I want** xem nhiều biểu đồ cùng lúc

**So that** tôi có thể so sánh các Timeframe khác nhau.

### Related Use Case

UC-001

### Related Functional Requirements

FR-006
FR-007
FR-008

---

## US-003 View Technical Indicators

**As a** Trader

**I want** xem các Technical Indicators trên biểu đồ

**So that** tôi có thể đánh giá tín hiệu giao dịch trực quan.

### Related Functional Requirements

FR-009

---

# 12.4 Strategy

---

## US-004 Select Strategy

**As a** Trader

**I want** lựa chọn Strategy

**So that** tôi có thể thử nghiệm nhiều phương pháp giao dịch khác nhau.

### Related Use Case

UC-002

### Related Functional Requirements

FR-011 → FR-017

---

## US-005 Configure Strategy

**As a** Trader

**I want** cấu hình Strategy

**So that** tôi có thể thử nghiệm các thiết lập khác nhau.

### Related Functional Requirements

FR-016

---

## US-006 Create Composite Strategy

**As a** Trader

**I want** kết hợp nhiều Strategy

**So that** tôi có thể tận dụng ưu điểm của từng Strategy.

### Related Use Case

UC-003

### Related Functional Requirements

FR-018
FR-019

---

# 12.5 Strategy Search

---

## US-007 Execute Random Search

**As a** Trader

**I want** chạy Random Search

**So that** hệ thống có thể tự động sinh nhiều Candidate Strategy.

### Related Use Case

UC-004

### Related Functional Requirements

FR-020
FR-021

---

## US-008 Execute Domain-guided Search

**As a** Trader

**I want** chạy Domain-guided Search

**So that** hệ thống ưu tiên các Candidate Strategy có ý nghĩa hơn về mặt nghiệp vụ.

### Related Functional Requirements

FR-022

---

## US-009 Configure Search

**As a** Trader

**I want** cấu hình Search

**So that** tôi có thể kiểm soát phạm vi thử nghiệm.

### Related Functional Requirements

FR-023

---

## US-010 Stop Search

**As a** Trader

**I want** dừng Search

**So that** tôi có thể tiết kiệm thời gian khi đã có đủ Candidate.

### Related Functional Requirements

FR-025
FR-026

---

# 12.6 Backtesting

---

## US-011 Execute Backtest

**As a** Trader

**I want** chạy Backtest

**So that** tôi có thể đánh giá hiệu quả Strategy trên dữ liệu lịch sử.

### Related Use Case

UC-005

### Related Functional Requirements

FR-029 → FR-037

---

## US-012 View Trade History

**As a** Trader

**I want** xem lịch sử giao dịch

**So that** tôi có thể phân tích từng lệnh giao dịch.

### Related Functional Requirements

FR-035

---

## US-013 Compare Strategies

**As a** Trader

**I want** so sánh nhiều Strategy

**So that** tôi có thể lựa chọn Strategy tốt nhất.

### Related Functional Requirements

FR-037

---

# 12.7 Strategy Evaluation

---

## US-014 View Evaluation Metrics

**As a** Trader

**I want** xem các chỉ số đánh giá

**So that** tôi có thể đánh giá khách quan hiệu quả của Strategy.

### Related Functional Requirements

FR-038
FR-039
FR-040
FR-041
FR-042

---

## US-015 Compare Evaluation Result

**As a** Trader

**I want** so sánh kết quả giữa các Strategy

**So that** tôi có thể lựa chọn Strategy phù hợp.

### Related Functional Requirements

FR-042

---

# 12.8 Leaderboard

---

## US-016 View Leaderboard

**As a** Trader

**I want** xem bảng xếp hạng

**So that** tôi biết Strategy nào đang hoạt động tốt nhất.

### Related Use Case

UC-007

### Related Functional Requirements

FR-044 → FR-049

---

## US-017 View Strategy Detail

**As a** Trader

**I want** xem chi tiết Strategy trên Leaderboard

**So that** tôi hiểu lý do Strategy được xếp hạng cao.

### Related Functional Requirements

FR-048

---

# 12.9 News

---

## US-018 View Crypto News

**As a** Trader

**I want** xem tin tức Cryptocurrency

**So that** tôi nắm được các sự kiện có thể ảnh hưởng đến thị trường.

### Related Use Case

UC-008

### Related Functional Requirements

FR-050 → FR-055

---

## US-019 View News Detail

**As a** Trader

**I want** xem chi tiết tin tức

**So that** tôi hiểu đầy đủ nội dung trước khi đưa ra quyết định.

### Related Functional Requirements

FR-054

---

# 12.10 Sentiment

---

## US-020 View Sentiment

**As a** Trader

**I want** xem Sentiment của từng News

**So that** tôi có thêm thông tin hỗ trợ việc phân tích thị trường.

### Related Use Case

UC-009

### Related Functional Requirements

FR-056 → FR-060

---

# 12.11 Experiments

---

## US-021 View Experiment History

**As a** Trader

**I want** xem lịch sử Experiment

**So that** tôi có thể theo dõi các lần thử nghiệm trước.

### Related Use Case

UC-010

### Related Functional Requirements

FR-061
FR-062
FR-063

---

## US-022 Compare Experiments

**As a** Trader

**I want** so sánh nhiều Experiment

**So that** tôi có thể đánh giá sự thay đổi giữa các phiên bản Strategy.

### Related Functional Requirements

FR-064

---

# 12.12 Settings

---

## US-023 Configure System Settings

**As a** Trader

**I want** thay đổi các thiết lập của hệ thống

**So that** tôi có thể tùy chỉnh hệ thống theo nhu cầu sử dụng.

### Related Use Case

UC-011

### Related Functional Requirements

FR-071

---

## US-024 Receive Notifications

**As a** Trader

**I want** nhận thông báo khi Backtest hoặc Search hoàn thành

**So that** tôi không cần theo dõi liên tục trong quá trình xử lý.

### Related Functional Requirements

FR-072

---

# 12.13 User Story Summary

| Epic            | User Stories    |
| --------------- | --------------- |
| Dashboard       | US-001 → US-003 |
| Strategy        | US-004 → US-006 |
| Strategy Search | US-007 → US-010 |
| Backtesting     | US-011 → US-013 |
| Evaluation      | US-014 → US-015 |
| Leaderboard     | US-016 → US-017 |
| News            | US-018 → US-019 |
| Sentiment       | US-020          |
| Experiments     | US-021 → US-022 |
| Settings        | US-023 → US-024 |

---

# 12.14 User Story Traceability Matrix

| User Story | Use Case | Functional Requirements |
| ---------- | -------- | ----------------------- |
| US-001     | UC-001   | FR-001 → FR-010         |
| US-002     | UC-001   | FR-006 → FR-008         |
| US-003     | UC-001   | FR-009                  |
| US-004     | UC-002   | FR-011 → FR-017         |
| US-005     | UC-002   | FR-016                  |
| US-006     | UC-003   | FR-018 → FR-019         |
| US-007     | UC-004   | FR-020 → FR-021         |
| US-008     | UC-004   | FR-022                  |
| US-009     | UC-004   | FR-023                  |
| US-010     | UC-004   | FR-025 → FR-026         |
| US-011     | UC-005   | FR-029 → FR-037         |
| US-012     | UC-006   | FR-035                  |
| US-013     | UC-006   | FR-037                  |
| US-014     | UC-006   | FR-038 → FR-042         |
| US-015     | UC-006   | FR-042                  |
| US-016     | UC-007   | FR-044 → FR-049         |
| US-017     | UC-007   | FR-048                  |
| US-018     | UC-008   | FR-050 → FR-055         |
| US-019     | UC-008   | FR-054                  |
| US-020     | UC-009   | FR-056 → FR-060         |
| US-021     | UC-010   | FR-061 → FR-063         |
| US-022     | UC-010   | FR-064                  |
| US-023     | UC-011   | FR-071                  |
| US-024     | UC-011   | FR-072                  |

# 13. Acceptance Criteria

## 13.1 Overview

Acceptance Criteria (AC) định nghĩa các điều kiện mà hệ thống phải đáp ứng để một User Story hoặc Functional Requirement được xem là hoàn thành.

Acceptance Criteria được xây dựng nhằm:

- Xác định tiêu chí nghiệm thu rõ ràng.
- Giảm sự mơ hồ trong quá trình phát triển.
- Làm cơ sở để xây dựng Test Case.
- Hỗ trợ quá trình kiểm thử và đánh giá cuối kỳ.

Mỗi Acceptance Criteria được liên kết trực tiếp với:

- User Story (US)
- Use Case (UC)
- Functional Requirement (FR)

---

# 13.2 Acceptance Criteria Naming Convention

Mỗi Acceptance Criteria được định danh theo mẫu:

```
AC-XXX
```

Ví dụ:

- AC-001
- AC-002

---

# 13.3 Dashboard

## AC-001 Display Realtime Market Data

### Related User Story

US-001

### Related Functional Requirements

FR-001
FR-002

### Acceptance Criteria

- Dashboard hiển thị dữ liệu thị trường sau khi kết nối thành công.
- Giá được cập nhật theo thời gian thực.
- Không cần tải lại toàn bộ trang để nhận dữ liệu mới.

---

## AC-002 Display Multiple Charts

### Related User Story

US-002

### Related Functional Requirements

FR-006
FR-007
FR-008

### Acceptance Criteria

- Trader có thể mở tối đa bốn biểu đồ.
- Mỗi biểu đồ có thể chọn Timeframe riêng.
- Thay đổi Timeframe của một biểu đồ không ảnh hưởng các biểu đồ còn lại.

---

## AC-003 Display Technical Indicators

### Related User Story

US-003

### Related Functional Requirements

FR-009

### Acceptance Criteria

- Hệ thống hiển thị đầy đủ các Indicator được hỗ trợ.
- Indicator hiển thị đúng theo dữ liệu thị trường hiện tại.

---

# 13.4 Strategy

## AC-004 Configure Strategy

### Related User Story

US-004
US-005

### Related Functional Requirements

FR-011 → FR-017

### Acceptance Criteria

- Trader có thể lựa chọn Strategy.
- Hệ thống lưu cấu hình Strategy thành công.
- Strategy có thể được sử dụng trong Backtest.

---

## AC-005 Create Composite Strategy

### Related User Story

US-006

### Related Functional Requirements

FR-018
FR-019

### Acceptance Criteria

- Composite Strategy gồm tối thiểu hai Strategy.
- Tổng trọng số bằng 1.0.
- Composite Strategy được lưu thành công.

---

# 13.5 Strategy Search

## AC-006 Execute Search

### Related User Story

US-007
US-008
US-009

### Related Functional Requirements

FR-020 → FR-028

### Acceptance Criteria

- Trader có thể chọn thuật toán Search.
- Search sinh Candidate Strategy.
- Tiến trình Search được hiển thị.
- Search dừng khi đạt số Candidate hoặc khi Trader nhấn Stop.

---

# 13.6 Backtesting

## AC-007 Execute Backtest

### Related User Story

US-011

### Related Functional Requirements

FR-029 → FR-037

### Acceptance Criteria

- Trader có thể chọn Strategy.
- Trader có thể chọn Timeframe và khoảng thời gian.
- Backtest hoàn thành mà không phát sinh lỗi.
- Trade History được tạo.
- Kết quả được lưu.

---

## AC-008 View Trade History

### Related User Story

US-012

### Related Functional Requirements

FR-035

### Acceptance Criteria

Mỗi giao dịch phải hiển thị:

- Entry Time
- Entry Price
- Exit Time
- Exit Price
- Position
- Profit/Loss

---

# 13.7 Evaluation

## AC-009 Calculate Evaluation Metrics

### Related User Story

US-014
US-015

### Related Functional Requirements

FR-038 → FR-042

### Acceptance Criteria

Hệ thống tính được:

- Total Return
- Win Rate
- Maximum Drawdown
- Number of Trades
- Overall Score

---

# 13.8 Leaderboard

## AC-010 Display Leaderboard

### Related User Story

US-016
US-017

### Related Functional Requirements

FR-044 → FR-049

### Acceptance Criteria

- Leaderboard hiển thị Top-K Strategy.
- Có thể xem chi tiết từng Strategy.
- Leaderboard cập nhật sau khi có kết quả Backtest mới.

---

# 13.9 News

## AC-011 Display News

### Related User Story

US-018
US-019

### Related Functional Requirements

FR-050 → FR-055

### Acceptance Criteria

- Danh sách News được hiển thị.
- Có thể xem chi tiết từng News.
- Mỗi News hiển thị nguồn và thời gian công bố.

---

# 13.10 Sentiment

## AC-012 Display Sentiment

### Related User Story

US-020

### Related Functional Requirements

FR-056 → FR-060

### Acceptance Criteria

- Mỗi News có kết quả Sentiment.
- Sentiment thuộc một trong ba nhóm:
  - Positive
  - Neutral
  - Negative
- Sentiment Score được hiển thị.

---

# 13.11 Experiments

## AC-013 View Experiment History

### Related User Story

US-021
US-022

### Related Functional Requirements

FR-061 → FR-064

### Acceptance Criteria

- Trader xem được danh sách Experiment.
- Có thể xem chi tiết từng Experiment.
- Có thể so sánh nhiều Experiment.

---

# 13.12 Settings

## AC-014 Configure System Settings

### Related User Story

US-023
US-024

### Related Functional Requirements

FR-071
FR-072

### Acceptance Criteria

- Trader thay đổi được các thiết lập được hỗ trợ.
- Hệ thống lưu cấu hình thành công.
- Các thay đổi được áp dụng trong các phiên làm việc tiếp theo (nếu có cơ chế lưu cấu hình).

---

# 13.13 Acceptance Criteria Summary

| Acceptance Criteria | Related User Story | Related Functional Requirements |
| ------------------- | ------------------ | ------------------------------- |
| AC-001              | US-001             | FR-001 → FR-002                 |
| AC-002              | US-002             | FR-006 → FR-008                 |
| AC-003              | US-003             | FR-009                          |
| AC-004              | US-004 → US-005    | FR-011 → FR-017                 |
| AC-005              | US-006             | FR-018 → FR-019                 |
| AC-006              | US-007 → US-010    | FR-020 → FR-028                 |
| AC-007              | US-011             | FR-029 → FR-037                 |
| AC-008              | US-012             | FR-035                          |
| AC-009              | US-014 → US-015    | FR-038 → FR-042                 |
| AC-010              | US-016 → US-017    | FR-044 → FR-049                 |
| AC-011              | US-018 → US-019    | FR-050 → FR-055                 |
| AC-012              | US-020             | FR-056 → FR-060                 |
| AC-013              | US-021 → US-022    | FR-061 → FR-064                 |
| AC-014              | US-023 → US-024    | FR-071 → FR-072                 |

# 14. Requirement Traceability Matrix (RTM)

## 14.1 Overview

Requirement Traceability Matrix (RTM) là bảng truy vết giúp liên kết các yêu cầu xuyên suốt vòng đời phát triển phần mềm.

RTM được sử dụng để:

- Đảm bảo mọi Business Objective đều được hiện thực hóa.
- Kiểm tra mọi Functional Requirement đều có Use Case và User Story tương ứng.
- Đảm bảo mọi User Story đều có Acceptance Criteria.
- Hỗ trợ đánh giá mức độ bao phủ yêu cầu (Requirement Coverage).
- Hỗ trợ kiểm thử và bảo trì hệ thống.

---

# 14.2 Traceability Levels

Trong tài liệu này, việc truy vết yêu cầu được thực hiện theo chuỗi sau:

```text
Business Objective
        ↓
Functional Requirement
        ↓
Use Case
        ↓
User Story
        ↓
Acceptance Criteria
```

Chuỗi truy vết này đảm bảo mỗi yêu cầu đều có:

- Nguồn gốc rõ ràng.
- Chức năng hiện thực tương ứng.
- Tiêu chí nghiệm thu cụ thể.

---

# 14.3 Business Objective to Functional Requirement

| Business Objective                                       | Functional Requirements |
| -------------------------------------------------------- | ----------------------- |
| BO-001 Build a modular crypto strategy platform          | FR-011 → FR-028         |
| BO-002 Support automated strategy evaluation             | FR-029 → FR-043         |
| BO-003 Provide real-time market monitoring               | FR-001 → FR-010         |
| BO-004 Provide market insight through news and sentiment | FR-050 → FR-060         |
| BO-005 Record and compare experiment results             | FR-061 → FR-064         |
| BO-006 Provide strategy ranking                          | FR-044 → FR-049         |
| BO-007 Provide an integrated trading dashboard           | FR-065 → FR-072         |

---

# 14.4 Functional Requirement to Use Case

| Functional Requirement | Use Case                         |
| ---------------------- | -------------------------------- |
| FR-001 → FR-010        | UC-001 View Market Dashboard     |
| FR-011 → FR-017        | UC-002 Configure Strategy        |
| FR-018 → FR-019        | UC-003 Create Composite Strategy |
| FR-020 → FR-028        | UC-004 Execute Strategy Search   |
| FR-029 → FR-043        | UC-005 Execute Backtest          |
| FR-035 → FR-042        | UC-006 View Backtest Result      |
| FR-044 → FR-049        | UC-007 View Leaderboard          |
| FR-050 → FR-055        | UC-008 View News                 |
| FR-056 → FR-060        | UC-009 View Sentiment            |
| FR-061 → FR-064        | UC-010 View Experiment History   |
| FR-071 → FR-072        | UC-011 Configure System Settings |

---

# 14.5 Use Case to User Story

| Use Case | User Stories    |
| -------- | --------------- |
| UC-001   | US-001 → US-003 |
| UC-002   | US-004 → US-005 |
| UC-003   | US-006          |
| UC-004   | US-007 → US-010 |
| UC-005   | US-011          |
| UC-006   | US-012 → US-015 |
| UC-007   | US-016 → US-017 |
| UC-008   | US-018 → US-019 |
| UC-009   | US-020          |
| UC-010   | US-021 → US-022 |
| UC-011   | US-023 → US-024 |

---

# 14.6 User Story to Acceptance Criteria

| User Story      | Acceptance Criteria |
| --------------- | ------------------- |
| US-001          | AC-001              |
| US-002          | AC-002              |
| US-003          | AC-003              |
| US-004 → US-005 | AC-004              |
| US-006          | AC-005              |
| US-007 → US-010 | AC-006              |
| US-011          | AC-007              |
| US-012          | AC-008              |
| US-014 → US-015 | AC-009              |
| US-016 → US-017 | AC-010              |
| US-018 → US-019 | AC-011              |
| US-020          | AC-012              |
| US-021 → US-022 | AC-013              |
| US-023 → US-024 | AC-014              |

---

# 14.7 Requirement Coverage Summary

## Functional Requirements

| Requirement Type        | Count |
| ----------------------- | ----: |
| Functional Requirements |    76 |
| Covered by Use Cases    |    76 |
| Coverage                |  100% |

---

## Use Cases

| Item                    | Count |
| ----------------------- | ----: |
| Use Cases               |    11 |
| Covered by User Stories |    11 |
| Coverage                |  100% |

---

## User Stories

| Item                           | Count |
| ------------------------------ | ----: |
| User Stories                   |    24 |
| Covered by Acceptance Criteria |    24 |
| Coverage                       |  100% |

---

# 14.8 End-to-End Traceability Examples

## Example 1 – Execute Backtest

| Level                   | Reference               |
| ----------------------- | ----------------------- |
| Business Objective      | BO-002                  |
| Functional Requirements | FR-029 → FR-043         |
| Use Case                | UC-005 Execute Backtest |
| User Story              | US-011 Execute Backtest |
| Acceptance Criteria     | AC-007 Execute Backtest |

---

## Example 2 – View Market Dashboard

| Level                   | Reference                           |
| ----------------------- | ----------------------------------- |
| Business Objective      | BO-003                              |
| Functional Requirements | FR-001 → FR-010                     |
| Use Case                | UC-001 View Market Dashboard        |
| User Story              | US-001 View Market Dashboard        |
| Acceptance Criteria     | AC-001 Display Realtime Market Data |

---

## Example 3 – View Leaderboard

| Level                   | Reference                  |
| ----------------------- | -------------------------- |
| Business Objective      | BO-006                     |
| Functional Requirements | FR-044 → FR-049            |
| Use Case                | UC-007 View Leaderboard    |
| User Story              | US-016 View Leaderboard    |
| Acceptance Criteria     | AC-010 Display Leaderboard |

---

# 14.9 Requirement Verification Strategy

Các yêu cầu trong tài liệu này sẽ được xác minh bằng các phương pháp sau:

| Verification Method           | Mô tả                                                  |
| ----------------------------- | ------------------------------------------------------ |
| Demonstration                 | Trình diễn chức năng hoạt động đúng trên hệ thống      |
| Inspection                    | Kiểm tra tài liệu, mã nguồn hoặc cấu hình              |
| Functional Testing            | Kiểm thử các Functional Requirements                   |
| Integration Testing           | Kiểm thử sự tương tác giữa các module                  |
| Performance Observation       | Quan sát khả năng cập nhật thời gian thực và xử lý nền |
| User Acceptance Testing (UAT) | Đánh giá hệ thống theo Acceptance Criteria             |

---

# 14.10 RTM Summary

Requirement Traceability Matrix đảm bảo rằng:

- Mọi Business Objective đều được hiện thực hóa thành Functional Requirements.
- Mọi Functional Requirement đều có Use Case tương ứng.
- Mọi Use Case đều được phản ánh qua User Stories.
- Mọi User Story đều có Acceptance Criteria để kiểm thử.
- Toàn bộ yêu cầu có thể truy vết xuyên suốt từ giai đoạn phân tích đến kiểm thử và nghiệm thu.

RTM là cơ sở để nhóm phát triển, nhóm kiểm thử và giảng viên đánh giá mức độ đầy đủ và nhất quán của tài liệu Software Requirements Specification.

# 15. Glossary

## 15.1 Overview

Phần này định nghĩa các thuật ngữ, từ viết tắt và khái niệm được sử dụng xuyên suốt tài liệu Software Requirements Specification nhằm đảm bảo tất cả thành viên trong nhóm và các bên liên quan có cùng cách hiểu.

---

# 15.2 Terms and Definitions

| Term                   | Definition                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trader                 | Người dùng duy nhất của hệ thống trong phạm vi MVP, sử dụng hệ thống để theo dõi thị trường, cấu hình Strategy, chạy Backtest và phân tích kết quả. |
| Strategy               | Thuật toán hoặc tập hợp quy tắc tạo tín hiệu giao dịch dựa trên dữ liệu thị trường.                                                                 |
| Composite Strategy     | Strategy được tạo bằng cách kết hợp nhiều Strategy đơn lẻ theo một phương pháp kết hợp xác định.                                                    |
| Strategy Search        | Quá trình tự động sinh Candidate Strategy để phục vụ Backtesting.                                                                                   |
| Candidate Strategy     | Một Strategy hoặc Composite Strategy được tạo ra trong quá trình Search và chờ được đánh giá.                                                       |
| Strategy Registry      | Thành phần quản lý danh sách các Strategy khả dụng trong hệ thống.                                                                                  |
| Indicator              | Chỉ báo kỹ thuật được sử dụng để phân tích dữ liệu thị trường, ví dụ: MA, RSI và Bollinger Bands.                                                   |
| Historical Market Data | Dữ liệu thị trường trong quá khứ được sử dụng để Backtesting.                                                                                       |
| Realtime Market Data   | Dữ liệu thị trường được cập nhật liên tục từ Binance WebSocket.                                                                                     |
| Candlestick            | Dữ liệu biểu diễn giá mở cửa, cao nhất, thấp nhất và đóng cửa (OHLC) của một khoảng thời gian giao dịch.                                            |
| Timeframe              | Khoảng thời gian của một cây nến, ví dụ: 1m, 5m, 15m, 1h hoặc 1d.                                                                                   |
| Backtesting            | Quá trình mô phỏng Strategy trên dữ liệu lịch sử nhằm đánh giá hiệu quả giao dịch.                                                                  |
| Trade History          | Danh sách các giao dịch được tạo ra trong quá trình Backtest.                                                                                       |
| Evaluation             | Quá trình tính toán các chỉ số đánh giá hiệu quả của Strategy sau khi Backtest.                                                                     |
| Experiment             | Một lần chạy Backtest hoàn chỉnh bao gồm Strategy, Dataset, Parameters và Evaluation Result.                                                        |
| Leaderboard            | Bảng xếp hạng các Strategy dựa trên kết quả đánh giá.                                                                                               |
| News Collector         | Thành phần thu thập tin tức từ các nguồn bên ngoài.                                                                                                 |
| Sentiment Analysis     | Quá trình phân tích cảm xúc của tin tức bằng mô hình AI.                                                                                            |
| Overall Score          | Điểm tổng hợp dùng để xếp hạng Strategy trên Leaderboard.                                                                                           |
| Worker                 | Tiến trình xử lý nền thực hiện Backtest thông qua hàng đợi (Queue).                                                                                 |
| Queue                  | Hàng đợi quản lý các tác vụ bất đồng bộ như Backtesting.                                                                                            |
| Event                  | Thông điệp được phát sinh để các module trao đổi với nhau theo cơ chế Event-driven.                                                                 |

---

# 15.3 Abbreviations

| Abbreviation | Meaning                             |
| ------------ | ----------------------------------- |
| API          | Application Programming Interface   |
| REST         | Representational State Transfer     |
| HTTP         | Hypertext Transfer Protocol         |
| JSON         | JavaScript Object Notation          |
| JWT          | JSON Web Token                      |
| UI           | User Interface                      |
| UX           | User Experience                     |
| DB           | Database                            |
| SQL          | Structured Query Language           |
| CRUD         | Create, Read, Update, Delete        |
| OHLC         | Open, High, Low, Close              |
| MA           | Moving Average                      |
| RSI          | Relative Strength Index             |
| BB           | Bollinger Bands                     |
| ATR          | Average True Range                  |
| SR           | Support and Resistance              |
| MVP          | Minimum Viable Product              |
| FR           | Functional Requirement              |
| NFR          | Non-functional Requirement          |
| BR           | Business Rule                       |
| UC           | Use Case                            |
| US           | User Story                          |
| AC           | Acceptance Criteria                 |
| RTM          | Requirement Traceability Matrix     |
| SRS          | Software Requirements Specification |
| SAD          | Software Architecture Document      |
| ADR          | Architecture Decision Record        |
| QAS          | Quality Attribute Scenario          |

---

# 15.4 Technologies

| Technology      | Purpose                         |
| --------------- | ------------------------------- |
| ReactJS         | Frontend Framework              |
| TypeScript      | Programming Language            |
| Node.js         | Backend Runtime                 |
| Express.js      | Backend Web Framework           |
| PostgreSQL      | Relational Database             |
| Supabase        | Managed PostgreSQL Platform     |
| BullMQ          | Job Queue Framework             |
| Socket.IO       | Realtime Communication          |
| EventEmitter    | Event-driven Communication      |
| Binance API     | Cryptocurrency Market Data      |
| CryptoPanic API | Cryptocurrency News Provider    |
| Gemini          | AI Model for Sentiment Analysis |

---

# 15.5 Document References

Các thuật ngữ được sử dụng nhất quán trong toàn bộ tài liệu SRS và sẽ tiếp tục được sử dụng trong Software Architecture Document (SAD).

---

# 16. Appendix

## 16.1 Overview

Phần phụ lục cung cấp các tài liệu tham khảo, tiêu chuẩn, liên kết kỹ thuật và thông tin bổ sung được sử dụng trong quá trình phân tích, thiết kế và phát triển hệ thống.

---

# 16.2 Reference Documents

| ID      | Document                                                                |
| ------- | ----------------------------------------------------------------------- |
| REF-001 | Course Project Specification – Software Architecture                    |
| REF-002 | Software Requirements Specification (tài liệu này)                      |
| REF-003 | Software Architecture Document (sẽ được xây dựng ở giai đoạn tiếp theo) |
| REF-004 | Architecture Decision Records (ADR)                                     |
| REF-005 | Project Source Code Repository                                          |

---

# 16.3 External APIs

| Service         | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| Binance API     | Cung cấp dữ liệu thị trường Cryptocurrency theo thời gian thực và dữ liệu lịch sử. |
| CryptoPanic API | Cung cấp tin tức Cryptocurrency.                                                   |
| Gemini API      | Phân tích Sentiment của các bài viết tin tức.                                      |

---

# 16.4 Development Environment

| Item                | Technology                        |
| ------------------- | --------------------------------- |
| Frontend            | ReactJS + TypeScript              |
| Backend             | Node.js + Express.js + TypeScript |
| Database            | PostgreSQL (Supabase)             |
| Operating System    | Windows                           |
| IDE / Editor        | Cursor                            |
| Version Control     | Git                               |
| Source Code Hosting | GitHub                            |

---

# 16.5 Architectural Principles

Trong phạm vi MVP, hệ thống tuân thủ các nguyên tắc kiến trúc sau:

- Modular Layered Architecture.
- High Cohesion.
- Low Coupling.
- Separation of Concerns.
- Event-driven Communication.
- Asynchronous Processing.
- Extensibility by Design.

Các nguyên tắc này sẽ được phân tích chi tiết trong tài liệu Software Architecture Document (SAD).

---

# 16.6 Assumptions

Các giả định chính của hệ thống bao gồm:

- Chỉ hỗ trợ một vai trò người dùng (Trader).
- Chỉ hỗ trợ cặp giao dịch BTCUSDT trong MVP.
- Chỉ sử dụng Binance làm nguồn dữ liệu thị trường.
- Chỉ sử dụng CryptoPanic làm nguồn tin tức.
- Chỉ sử dụng Gemini để phân tích Sentiment.
- Chưa triển khai cơ chế Authentication và Authorization hoàn chỉnh.
- Kiến trúc được thiết kế để có thể mở rộng trong các phiên bản tương lai.

---

# 16.7 Future Enhancements

Các khả năng mở rộng dự kiến trong tương lai:

- Hỗ trợ nhiều Coin Pair.
- Hỗ trợ nhiều Exchange.
- Hỗ trợ nhiều News Provider.
- Bổ sung Strategy mới.
- Bổ sung Search Algorithm mới.
- Hỗ trợ Genetic Algorithm.
- Hỗ trợ Evolutionary Search.
- Triển khai Authentication và Authorization.
- Hỗ trợ nhiều người dùng.
- Hỗ trợ Portfolio Management.
- Hỗ trợ Paper Trading.
- Hỗ trợ Live Trading.

---

# 16.8 Document Completion

Tài liệu **Software Requirements Specification (SRS)** mô tả đầy đủ các yêu cầu chức năng và phi chức năng của hệ thống Crypto Strategy Optimization Platform trong phạm vi MVP.

Tài liệu này là cơ sở cho các hoạt động:

- Thiết kế kiến trúc phần mềm (Software Architecture).
- Thiết kế cơ sở dữ liệu.
- Thiết kế API.
- Thiết kế giao diện người dùng.
- Lập kế hoạch phát triển.
- Kiểm thử và nghiệm thu hệ thống.

Mọi thay đổi đối với yêu cầu hệ thống cần được xem xét, đánh giá tác động và cập nhật trong tài liệu này nhằm đảm bảo tính nhất quán trong suốt vòng đời phát triển phần mềm.
