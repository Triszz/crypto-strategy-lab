# Crypto Strategy Lab – Đồ án cuối kỳ

> **Nền tảng phân tích, kết hợp và đánh giá chiến lược giao dịch Crypto**

---

## Mục lục

1. [Bối cảnh bài toán](#1-bối-cảnh-bài-toán)
2. [Mục tiêu tổng thể](#2-mục-tiêu-tổng-thể)
3. [Ví dụ tổng thể](#3-một-ví-dụ-tổng-thể)
4. [Module 1 – Realtime Market Data](#4-module-1--realtime-market-data)
5. [Module 2 – Multi-Timeframe Chart](#5-module-2--multi-timeframe-chart)
6. [Module 3 – Strategy Engine](#6-module-3--strategy-engine)
7. [Strategy ví dụ 1 – Moving Average](#7-strategy-ví-dụ-1--moving-average)
8. [Strategy ví dụ 2 – RSI](#8-strategy-ví-dụ-2--rsi)
9. [Strategy ví dụ 3 – Bollinger Bands](#9-strategy-ví-dụ-3--bollinger-bands)
10. [Strategy ví dụ 4 – Support/Resistance](#10-strategy-ví-dụ-4--supportresistance)
11. [Strategy nâng cao – SMC, Wyckoff](#11-strategy-nâng-cao--smc-wyckoff)
12. [Module 4 – Strategy Plugin](#12-module-4--strategy-plugin)
13. [Module 5 – Composite Strategy](#13-module-5--composite-strategy)
14. [Weighted Combination](#14-weighted-combination)
15. [Module 6 – Strategy Search Engine](#15-module-6--strategy-search-engine)
16. [Cách tìm kiếm 1 – Random Search](#16-cách-tìm-kiếm-1--random-search)
17. [Cách tìm kiếm 2 – Domain-guided Search](#17-cách-tìm-kiếm-2--domain-guided-search)
18. [Cách tìm kiếm nâng cao](#18-cách-tìm-kiếm-nâng-cao)
19. [Module 7 – Backtesting Engine](#19-module-7--backtesting-engine)
20. [Không chỉ đánh giá Profit](#20-không-chỉ-đánh-giá-profit)
21. [Module 8 – Leaderboard](#21-module-8--leaderboard)
22. [Top-K Strategies](#22-top-k-strategies)
23. [Module 9 – Continuous Strategy Loop](#23-module-9--continuous-strategy-loop)
24. [Tại sao phần Loop quan trọng đối với Kiến trúc phần mềm?](#24-vì-sao-phần-loop-quan-trọng-đối-với-kiến-trúc-phần-mềm)
25. [Visualization Strategy](#25-visualization-strategy)
26. [Trade Detail](#26-trade-detail)
27. [Module 10 – News Crawler](#27-module-10--news-crawler)
28. [News không được gắn cứng với một crawler](#28-news-không-được-gắn-cứng-với-một-crawler)
29. [Module 11 – Sentiment Analysis](#29-module-11--sentiment-analysis)
30. [Sentiment có thể trở thành một Strategy](#30-sentiment-có-thể-trở-thành-một-strategy)
31. [Kiến trúc tổng thể gợi ý](#31-kiến-trúc-tổng-thể-gợi-ý)
32. [Những vấn đề Kiến trúc phần mềm mà đồ án phải giải quyết](#32-những-vấn-đề-kiến-trúc-phần-mềm-mà-đồ-án-phải-giải-quyết)
33. [Một luồng hoàn chỉnh của hệ thống](#33-một-luồng-hoàn-chỉnh-của-hệ-thống)
34. [Các Event có thể xuất hiện](#34-các-event-có-thể-xuất-hiện)
35. [Database](#35-database)
36. [Strategy phải có Version](#36-strategy-phải-có-version)
37. [Mức tối thiểu – MVP](#37-mức-tối-thiểu--mvp)
38. [Phần mở rộng](#38-phần-mở-rộng)
39. [Một ví dụ để hiểu đúng mục tiêu đồ án](#39-một-ví-dụ-để-hiểu-đúng-mục-tiêu-đồ-án)
40. [Câu hỏi kiến trúc trung tâm](#40-câu-hỏi-kiến-trúc-trung-tâm)
41. [Scenario đánh giá khả năng mở rộng](#41-scenario-đánh-giá-khả-năng-mở-rộng)
42. [Scenario đánh giá khả năng thay đổi](#42-scenario-đánh-giá-khả-năng-thay-đổi)
43. [Scenario đánh giá scalability](#43-scenario-đánh-giá-scalability)
44. [Các Anti-pattern nên tránh](#44-các-anti-pattern-nên-tránh)
45. [Deliverables](#45-deliverables)
46. [Demo scenario đề xuất](#46-demo-scenario-đề-xuất)
47. [Ý nghĩa cuối cùng của đồ án](#47-ý-nghĩa-cuối-cùng-của-đồ-án)

---

## 1. Bối cảnh bài toán

Thị trường cryptocurrency như Bitcoin, Ethereum hoạt động liên tục 24/7. Giá của các tài sản thay đổi theo thời gian và thường được biểu diễn bằng **biểu đồ nến – Candlestick Chart**.

Ví dụ với cặp giao dịch **BTC/USDT**, một cây nến 5 phút chứa:

| Thành phần | Ý nghĩa |
|---|---|
| **Open** | Giá BTC ở đầu 5 phút |
| **High** | Giá cao nhất trong 5 phút |
| **Low** | Giá thấp nhất trong 5 phút |
| **Close** | Giá cuối 5 phút |
| **Volume** | Khối lượng giao dịch trong 5 phút |

**Ví dụ cụ thể:**

```
BTCUSDT – khung 5 phút (09:00)
┌─────────────────────────────────┐
│ Open   = 118,000               │
│ High   = 118,200               │
│ Low    = 117,900               │
│ Close  = 118,150              │
│ Volume = 125 BTC               │
└─────────────────────────────────┘
```

Các trader thường sử dụng nhiều phương pháp phân tích kỹ thuật như:

- **Moving Average (MA)**
- **RSI**
- **Bollinger Bands**
- **Support/Resistance**
- **Smart Money Concepts (SMC)**
- **Wyckoff**

để tìm thời điểm thích hợp để **Buy**, **Sell** hoặc **không giao dịch**.

### Vấn đề: Một strategy đơn lẻ không hoạt động tốt trong mọi điều kiện thị trường

| Strategy | Tốt khi | Kém khi |
|---|---|---|
| **MA** | Thị trường có xu hướng | Thị trường đi ngang (sideways) |
| **RSI** | Phát hiện quá mua/quá bán | Tạo nhiều tín hiệu sai khi trend mạnh |
| **Support/Resistance** | Tìm vùng giá quan trọng | Xác định vùng có thể phụ thuộc thuật toán |

### Câu hỏi chính của đồ án

> **Có thể xây dựng một hệ thống cho phép bổ sung nhiều strategy khác nhau, tự động kết hợp chúng thành các strategy phức hợp, đánh giá hiệu quả và liên tục tìm ra những tổ hợp strategy tốt nhất hay không?**

---

## 2. Mục tiêu tổng thể

Xây dựng nền tảng **Crypto Strategy Lab** có khả năng:

| # | Mục tiêu |
|---|---|
| 1 | Nhận dữ liệu thị trường cryptocurrency từ Binance |
| 2 | Hiển thị biểu đồ giá realtime |
| 3 | Theo dõi đồng thời tối đa **4 khung thời gian** |
| 4 | Cho phép bổ sung các strategy phân tích kỹ thuật |
| 5 | Cho phép kết hợp nhiều strategy thành một chiến lược tổng hợp |
| 6 | Backtest các chiến lược trên dữ liệu lịch sử |
| 7 | Xếp hạng các strategy dựa trên hiệu quả giao dịch |
| 8 | Tự động tìm kiếm các combination strategy tốt hơn |
| 9 | Visualize tín hiệu và giao dịch lên biểu đồ |
| 10 | Thu thập tin tức liên quan đến coin/pair |
| 11 | Phân tích sentiment của tin tức bằng mô hình Machine Learning |
| 12 | Thiết kế hệ thống sao cho có thể mở rộng trong tương lai |

> **Trọng tâm của đồ án là Kiến trúc phần mềm, không phải tìm ra strategy đầu tư tốt nhất.**

---

## 3. Một ví dụ tổng thể

Giả sử người dùng chọn:

- **Pair:** BTCUSDT
- **Timeframes:** 5m, 15m, 1h, 4h

### 3.1 Dashboard hiển thị 4 biểu đồ

```
┌─────────────────────────┬─────────────────────────┐
│    BTCUSDT - 5m          │   BTCUSDT - 15m         │
│                          │                         │
│    Candlestick           │    Candlestick          │
│                          │                         │
├─────────────────────────┼─────────────────────────┤
│    BTCUSDT - 1h          │   BTCUSDT - 4h          │
│                          │                         │
│    Candlestick           │    Candlestick          │
└─────────────────────────┴─────────────────────────┘
```

Người dùng có thể đổi timeframe riêng lẻ mà **không phải reload** toàn bộ hệ thống:

- 5m → 1m
- 15m → 30m
- 1h → 2h
- 4h → 1d

### 3.2 Bật các chỉ báo

Sau đó người dùng bật: **MA**, **RSI**, **Bollinger Bands**, **Support/Resistance**

### 3.3 Hệ thống tạo các tổ hợp

| Tổ hợp | Chiến lược |
|--------|------------|
| A | MA |
| B | MA + RSI |
| C | MA + Bollinger |
| D | RSI + Support/Resistance |
| E | MA + RSI + Support/Resistance |
| F | MA + RSI + Bollinger + Support/Resistance |

### 3.4 Sau khi backtest – Leaderboard

| Rank | Strategy | Profit | Win Rate | Max Drawdown |
|------|----------|--------|----------|--------------|
| 1 | MA + RSI + SR | +18.2% | 61% | -6.1% |
| 2 | MA + Bollinger | +15.7% | 58% | -8.4% |
| 3 | RSI + SR | +13.1% | 64% | -7.2% |

---

## 4. Module 1 – Realtime Market Data

Hệ thống cần lấy dữ liệu giá crypto từ **Binance**. Có hai loại dữ liệu chính:

### 4.1 Historical Data

Dữ liệu trong quá khứ, phù hợp cho:

- Backtesting
- Tính indicator
- Huấn luyện ML
- Phân tích lịch sử

```
BTCUSDT – 01/07 → 30/07
Khung thời gian: 1p, 5p, 15p, 1h, 4h, 1d
```

### 4.2 Realtime Data

Dữ liệu giá đang thay đổi tại thời điểm hiện tại:

```
09:10:01  BTC = 118,021
09:10:02  BTC = 118,028
09:10:03  BTC = 118,017
...
```

Frontend cần nhận cập nhật mà **không liên tục gọi** `GET /price`.

### 4.3 Kiến trúc dòng dữ liệu

```
┌─────────┐    ┌──────────────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Binance │───▶│ Market Data     │───▶│  Event   │───▶│ Backend  │───▶│ Frontend │
│         │    │ Adapter         │    │ / Stream │    │          │    │          │
└─────────┘    └──────────────────┘    └──────────┘    └──────────┘    └──────────┘
                     ▲
                     │
               ┌──────┴──────┐
               │ Binance     │
               │ Adapter     │
               └─────────────┘
```

### 4.4 Yêu cầu kiến trúc

**Không nên:**

```
Frontend → Binance API (trực tiếp)
```

**Nên:**

```
Frontend
    │
    ▼
Market Data Service
    │
    ▼
Binance Adapter
    │
    ▼
Binance
```

Nhờ đó, sau này có thể bổ sung mà **frontend không phải thay đổi**:

- `BinanceAdapter`
- `OKXAdapter`
- `BybitAdapter`
- `CoinbaseAdapter`

---

## 5. Module 2 – Multi-Timeframe Chart

Hệ thống phải hỗ trợ **tối đa 4 chart** trên một màn hình.

### 5.1 Ví dụ cấu hình

| Chart | Pair | Timeframe |
|-------|------|-----------|
| 1 | BTCUSDT | 5m |
| 2 | BTCUSDT | 15m |
| 3 | BTCUSDT | 1h |
| 4 | BTCUSDT | 4h |

Mỗi chart có thể thay đổi timeframe riêng. Nếu người dùng đổi `5m → 1h`, chỉ **Chart 1** cần đổi dữ liệu.

### 5.2 Có thể visualize

- **Candlestick** (nến)
- **Volume** (khối lượng)
- **MA**
- **Bollinger Bands**
- Vùng **Support**
- Vùng **Resistance**
- **Buy Signal**
- **Sell Signal**
- Điểm **Entry**
- **Stop Loss**
- **Take Profit**

### 5.3 Ví dụ chart với tín hiệu

```
           Resistance 120K
─────────────────────────────────────────
              SELL ↓
                  █
             █    █
          █  █    █
       █  █  █
─────── MA ───────────────────────────────

              ↑ BUY
─────────────────────────────────────────
           Support 110K
```

---

## 6. Module 3 – Strategy Engine

Đây là **module quan trọng nhất** của hệ thống.

Một **strategy** nhận dữ liệu thị trường và tạo ra một tín hiệu.

### 6.1 Tín hiệu chuẩn hóa

**Cách 1:**

```typescript
enum Signal {
  BUY,
  SELL,
  HOLD
}
```

**Cách 2:**

```typescript
enum Signal {
  LONG,
  SHORT,
  NONE
}
```

### 6.2 Interface Strategy

```typescript
interface Strategy {
  analyze(context): Signal;
}

interface MarketContext {
  price: number;
  volume: number;
  candles: Candle[];
  timeframe: string;
  indicators: Record<string, number>;
  marketState: string;
  sentiment: number;
  // ...
}
```

---

## 7. Strategy ví dụ 1 – Moving Average

**Moving Average (MA)** là giá trung bình của một khoảng thời gian.

- `MA20` = trung bình giá của 20 candles gần nhất
- `MA50` = trung bình giá của 50 candles gần nhất

### 7.1 Strategy đơn giản

```
Nếu MA20 cắt lên MA50  →  BUY
Nếu MA20 cắt xuống MA50  →  SELL
```

### 7.2 Implementation

```typescript
class MAStrategy implements Strategy {
  private fastPeriod = 20;
  private slowPeriod = 50;

  analyze(context: MarketContext): Signal {
    const fastMA = calculateSMA(context.candles, this.fastPeriod);
    const slowMA = calculateSMA(context.candles, this.slowPeriod);

    if (fastMA > slowMA) return Signal.BUY;
    if (fastMA < slowMA) return Signal.SELL;
    return Signal.HOLD;
  }
}
```

### 7.3 Nguyên tắc kiến trúc quan trọng

> **MAStrategy chỉ nên chịu trách nhiệm về logic MA.**
>
> **Không nên chứa:**
>
> - Code gọi Binance
> - Code lưu database
> - Code vẽ chart
> - Code gửi notification

---

## 8. Strategy ví dụ 2 – RSI

**RSI** có giá trị từ: `0 → 100`

### 8.1 Rule đơn giản

```
RSI < 30  →  Oversold  →  BUY
RSI > 70  →  Overbought  →  SELL
```

### 8.2 Implementation

```typescript
class RSIStrategy implements Strategy {
  private period = 14;
  private buyThreshold = 30;
  private sellThreshold = 70;

  analyze(context: MarketContext): Signal {
    const rsi = calculateRSI(context.candles, this.period);

    if (rsi < this.buyThreshold) return Signal.BUY;
    if (rsi > this.sellThreshold) return Signal.SELL;
    return Signal.HOLD;
  }
}
```

### 8.3 Có thể thử nhiều parameter

| Cấu hình | period | buy | sell |
|----------|--------|-----|------|
| RSI(14, 30, 70) | 14 | 30 | 70 |
| RSI(14, 25, 75) | 14 | 25 | 75 |
| RSI(21, 30, 70) | 21 | 30 | 70 |

---

## 9. Strategy ví dụ 3 – Bollinger Bands

**Bollinger Bands** tạo ba đường:

| Đường | Ý nghĩa |
|-------|---------|
| **Upper Band** | Dải trên |
| **Middle Band** | Dải giữa (SMA) |
| **Lower Band** | Dải dưới |

### 9.1 Strategy ví dụ 1

```
Price < Lower Band  →  BUY
Price > Upper Band  →  SELL
```

### 9.2 Strategy ví dụ 2 (breakout)

```
Price breakout Upper Band  →  BUY
```

> Như vậy, **cùng một indicator có thể sinh ra nhiều strategy khác nhau**.

---

## 10. Strategy ví dụ 4 – Support/Resistance

| Khái niệm | Định nghĩa |
|-----------|------------|
| **Support** | Vùng giá mà giá trước đây thường ngừng giảm |
| **Resistance** | Vùng mà giá trước đây thường gặp khó khăn khi tăng tiếp |

### 10.1 Ví dụ

```
           Resistance 120K
─────────────────────────────────────────
         /\       /
        /  \     /
       /    \   /
      /      \ /
─────────────────────────────────────────
           Support 110K
```

### 10.2 Strategy ví dụ

```
Price gần Support     →  BUY
Price gần Resistance  →  SELL
Price breakout Resistance  →  BUY
```

---

## 11. Strategy nâng cao – SMC, Wyckoff

> Sinh viên **không bắt buộc** phải xây dựng đầy đủ các phương pháp phức tạp này.
> Mục tiêu là chứng minh kiến trúc có khả năng hỗ trợ chúng.

```
                    Strategy
                        │
        ┌─────────┬──────┴───────┬──────────────┐
        │         │              │              │
        ▼         ▼              ▼              ▼
    MA Strategy  RSI Strategy  BB Strategy  SMC Strategy
                                             │
                                             ▼
                                       Wyckoff Strategy
                                             │
                                             ▼
                                      Sentiment Strategy
```

> **Thêm một strategy mới không được yêu cầu sửa toàn bộ Strategy Engine.**
>
> Đây chính là yêu cầu về **Extensibility – khả năng mở rộng hệ thống**.

---

## 12. Module 4 – Strategy Plugin

> **Yêu cầu quan trọng:** Hệ thống phải cho phép bổ sung strategy mới dễ dàng.

### 12.1 Cấu trúc thư mục ban đầu

```
strategies/
    MA/
    RSI/
    Bollinger/
```

Nhóm phát triển thêm: `SupportResistance/`

### 12.2 Cách đăng ký lý tưởng

```typescript
StrategyRegistry.register(SupportResistance);
```

### 12.3 Cách KHÔNG NÊN làm

```typescript
// ❌ Hard-coded - vi phạm Open/Closed Principle
if (strategy == 'MA') ...
else if (strategy == 'RSI') ...
else if (strategy == 'Bollinger') ...
else if (strategy == 'SR') ...
```

### 12.4 Các Pattern được khuyến nghị

| Pattern | Mô tả |
|---------|--------|
| **Strategy Pattern** | Định nghĩa một họ algorithm, đóng gói từng cái |
| **Plugin Architecture** | Tải strategy động lúc runtime |
| **Factory** | Tạo instance strategy theo config |
| **Registry** | Đăng ký và tra cứu strategy |
| **Dependency Injection** | Inject strategy vào các service |

> **Không bắt buộc phải sử dụng đúng một pattern cụ thể.**
> Quan trọng là phải **giải thích được**: Vì sao kiến trúc của nhóm có thể thêm strategy mới mà ảnh hưởng tối thiểu đến code hiện tại?

---

## 13. Module 5 – Composite Strategy

> **Đây là phần trung tâm của bài toán.**

### 13.1 Tổ hợp chiến lược

Với 4 strategy: **MA**, **RSI**, **Bollinger**, **SupportResistance**

Có thể tạo:

```
MA + RSI
MA + Bollinger
MA + SR
RSI + Bollinger
RSI + SR
MA + RSI + SR
MA + RSI + BB
MA + BB + SR
RSI + BB + SR
MA + RSI + BB + SR
...
```

### 13.2 Câu hỏi quan trọng

> **Khi các strategy đưa ra tín hiệu khác nhau thì kết hợp thế nào?**

### 13.3 Majority Vote

**Ví dụ 1:**

| Strategy | Tín hiệu |
|----------|-----------|
| MA | BUY |
| RSI | BUY |
| SR | HOLD |

```
BUY = 2, HOLD = 1
→ BUY (đa số)
```

**Ví dụ 2:**

| Strategy | Tín hiệu |
|----------|-----------|
| MA | BUY |
| RSI | SELL |
| SR | BUY |

```
BUY = 2, SELL = 1
→ BUY (đa số)
```

---

## 14. Weighted Combination

> **Không nhất thiết strategy nào cũng có trọng số giống nhau.**

### 14.1 Định nghĩa trọng số

| Strategy | Trọng số |
|----------|----------|
| MA | 0.2 |
| RSI | 0.3 |
| SR | 0.5 |

### 14.2 Mã hóa tín hiệu

| Signal | Giá trị |
|--------|---------|
| BUY | +1 |
| HOLD | 0 |
| SELL | -1 |

### 14.3 Tính Score

```
Tín hiệu:
MA  → BUY  (+1)
RSI → SELL (-1)
SR  → BUY  (+1)

Score = MA × 0.2 + RSI × 0.3 + SR × 0.5
      = (+1) × 0.2 + (-1) × 0.3 + (+1) × 0.5
      = 0.2 - 0.3 + 0.5
      = 0.4
```

### 14.4 Quyết định dựa trên ngưỡng

```
score >  0.3  →  BUY
score < -0.3  →  SELL
còn lại        →  HOLD
```

> **Đây chỉ là một ví dụ.** Nhóm được quyền thiết kế phương pháp combination riêng.

---

## 15. Module 6 – Strategy Search Engine

> Nếu có nhiều strategy, số tổ hợp có thể tăng **rất nhanh**.

### 15.1 Số lượng tổ hợp tăng nhanh

Chỉ với 4 strategy: MA, RSI, BB, SR

```
MA + RSI
MA + BB
MA + SR
RSI + BB
RSI + SR
BB + SR
MA + RSI + BB
MA + RSI + SR
MA + BB + SR
RSI + BB + SR
MA + RSI + BB + SR
...
```

### 15.2 Vấn đề thực sự

Nếu mỗi strategy có nhiều parameter:

| Strategy | Các tham số |
|----------|-------------|
| MA | 10/20, 20/50, 50/200 |
| RSI | 14/30/70, 14/20/80, 21/30/70 |

Không gian tìm kiếm sẽ **lớn hơn rất nhiều**.

Hệ thống cần cung cấp một **Strategy Search Engine**.

---

## 16. Cách tìm kiếm 1 – Random Search

**Cách đơn giản nhất:** Random một tổ hợp.

```
Loop 1:  MA + RSI
Loop 2:  BB + SR
Loop 3:  MA + RSI + SR
Loop 4:  MA + BB + SR
...
```

Mỗi combination được pipeline:

```
Generate
    ↓
Backtest
    ↓
Evaluate
    ↓
Rank
```

---

## 17. Cách tìm kiếm 2 – Domain-guided Search

> Thay vì random hoàn toàn, có thể dựa trên đặc điểm domain.

### 17.1 Phân nhóm theo loại indicator

| Nhóm | Strategy |
|------|----------|
| **Trend** | MA, MACD |
| **Momentum** | RSI, Stochastic |
| **Volatility** | Bollinger, ATR |
| **Structure** | Support/Resistance, SMC |
| **Information** | News Sentiment |

### 17.2 Quy tắc combination

> Một composite strategy phải lấy **ít nhất**:
>
> - 1 **Trend** Strategy
> - 1 **Momentum** Strategy
> - 1 **Structure** Strategy

**Ví dụ hợp lệ:**

```
MA (Trend) + RSI (Momentum) + Support Resistance (Structure)
```

**Ví dụ KHÔNG khuyến khích:**

```
MA10 (Trend) + MA20 (Trend) + MA50 (Trend)
```

> Nhóm cần giải thích: **Domain knowledge đã được đưa vào quá trình search như thế nào?**

---

## 18. Cách tìm kiếm nâng cao

Nhóm có thể nghiên cứu thêm:

| Phương pháp | Mô tả |
|-------------|--------|
| **Genetic Algorithm** | Thuật toán di truyền |
| **Bayesian Optimization** | Tối ưu hóa Bayes |
| **Evolutionary Search** | Tìm kiếm tiến hóa |
| **Reinforcement Learning** | Học tăng cường |
| **LLM-generated Strategy** | Sinh strategy bằng LLM |
| **Agent-based Search** | Tìm kiếm dựa trên agent |
| **AlphaEvolve-style optimization** | Tối ưu hóa kiểu AlphaEvolve |
| **Loop Engineering** | Kỹ thuật vòng lặp |

> **Đây là phần mở rộng, không bắt buộc.**

---

## 19. Module 7 – Backtesting Engine

> **Backtesting** nghĩa là giả lập: *"Nếu sử dụng strategy này trong quá khứ thì kết quả sẽ như thế nào?"*

### 19.1 Ví dụ dữ liệu

```
01/01  BTC = $80,000
...
01/03  BTC = $95,000
```

### 19.2 Strategy tạo tín hiệu

```
05/01  BUY  @82,000
12/01  SELL @86,000
22/01  BUY  @88,000
31/01  SELL @87,000
```

### 19.3 Backtesting Engine giả lập

| Trade | Entry | Exit | Kết quả |
|-------|-------|------|---------|
| Trade 1 | Buy 82K | Sell 86K | ✅ Profit |
| Trade 2 | Buy 88K | Sell 87K | ❌ Loss |

---

## 20. Không chỉ đánh giá Profit

> **Strategy không được đánh giá chỉ bằng Total Profit.**

### 20.1 Ví dụ minh họa

| Strategy | Total Profit | Max Drawdown |
|----------|-------------|--------------|
| Strategy A | +30% | -45% |
| Strategy B | +25% | -8% |

→ **Strategy B có thể ổn định hơn Strategy A** dù profit thấp hơn.

### 20.2 Các metrics cần cung cấp

| Metric | Ý nghĩa |
|--------|---------|
| **Total Return** | Tổng lợi nhuận |
| **Profit/Loss (P/L)** | Lãi/Lỗ |
| **Win Rate** | Tỷ lệ thắng |
| **Number of Trades** | Số lượng giao dịch |
| **Maximum Drawdown** | Mức sụt giảm tối đa |
| **Profit Factor** | Hệ số lợi nhuận |
| **Sharpe Ratio** | Tỷ số Sharpe |

> **Không yêu cầu sinh viên phải hiểu sâu tài chính định lượng.**
> Nhưng cần hiểu: **Strategy Evaluation phải tách biệt khỏi Strategy Implementation.**

---

## 21. Module 8 – Leaderboard

Sau mỗi lần backtest, kết quả được đưa vào **Leaderboard**.

### 21.1 Ví dụ Leaderboard

| Rank | Strategy | Return | Win Rate | MDD | Trades |
|------|----------|--------|----------|-----|--------|
| 1 | MA+RSI+SR | 24.2% | 62% | -7.1% | 81 |
| 2 | MA+BB | 21.7% | 55% | -8.4% | 105 |
| 3 | RSI+SR | 18.4% | 64% | -6.7% | 52 |
| 4 | MA | 9.1% | 48% | -14.2% | 140 |

### 21.2 Cách sắp xếp

Có thể cho phép sort theo:

- Return
- Win Rate
- Max Drawdown
- Sharpe

### 21.3 Overall Score

Có thể định nghĩa công thức tính điểm tổng hợp:

```
Score = 0.5 × Return + 0.2 × WinRate + 0.3 × RiskScore
```

> **Nhóm phải trình bày rõ cách tính.**

---

## 22. Top-K Strategies

> **Hệ thống không nhất thiết giữ tất cả strategy tốt nhất lên màn hình.**

### 22.1 Cơ chế Top-K

Ví dụ `Top K = 10`:

```
Leaderboard luôn hiển thị: Top 10 strategies hiện tại
```

### 22.2 Quy trình cập nhật

```
Candidate mới: MA20 + RSI14 + SR
    ↓
Backtest → Score = 82.1
    ↓
So sánh với strategy thứ 10 (Score = 78.4)
    ↓
82.1 > 78.4 → Strategy mới được đưa vào Leaderboard
```

---

## 23. Module 9 – Continuous Strategy Loop

> Hệ thống có thể chạy một **vòng loop ngầm** tự động.

### 23.1 Sơ đồ vòng lặp

```
        ┌──────────────┐
        │   Generate   │
        │   Strategy   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Backtest   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │   Evaluate   │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │     Rank     │
        └──────┬───────┘
               ↓
        ┌──────────────┐
        │ Leaderboard  │
        └──────┬───────┘
               │
               └────────→ Generate tiếp (lặp lại)
```

### 23.2 Ví dụ tiến trình

| # | Candidate | Score | Ghi chú |
|---|-----------|-------|---------|
| 182 | MA20 + RSI14 | 71 | |
| 183 | MA20 + Bollinger | 68 | |
| 184 | MA50 + RSI21 + SR | **84** | → New Top Strategy |
| 185 | ... | | |

### 23.3 Stop Condition

Loop có thể chạy đến khi:

- Đã test **100 candidate**
- Đã chạy **1 giờ**
- Không cải thiện sau **50 iterations**

> **Nhóm phải thiết kế Stop Condition. Không được để `while(true)` chạy vô hạn.**

---

## 24. Vì sao phần Loop quan trọng đối với Kiến trúc phần mềm?

### 24.1 Implementation KÉM

```python
# ❌ Tất cả trong một function
for 100000 strategies:
    calculate indicator
    backtest
    save DB
    update UI
```

### 24.2 Implementation TỐT – Phân tách rõ ràng

```
Strategy Generator
        ↓
Strategy Queue (Job Queue)
        ↓
Backtest Worker
        ↓
Evaluator
        ↓
Ranking Service
        ↓
Leaderboard
```

### 24.3 Lợi ích của kiến trúc phân tách

| Khả năng | Lợi ích |
|----------|---------|
| **Chạy nhiều worker** | Xử lý song song |
| **Retry khi worker lỗi** | Độ tin cậy cao |
| **Pause/Resume loop** | Kiểm soát tiến trình |
| **Theo dõi tiến trình** | Quan sát được |
| **Thay search algorithm** | Dễ mở rộng |
| **Scale trong tương lai** | Tăng số lượng worker |

---

## 25. Visualization Strategy

> **Không chỉ hiển thị `Profit = +20%` mà phải cho phép người dùng hiểu strategy đã làm gì.**

### 25.1 Ví dụ chart với signals

```
BTCUSDT 15m
           SELL
             ↓
       █ █
    █  █ █
 █  █
 █
↑
BUY
MA ─────────────────────────────────────────
Support ===================================
```

### 25.2 Khi click vào Strategy

```
Strategy: MA20 + RSI14 + SupportResistance
→ Chart hiển thị:
   - MA20
   - RSI signals
   - Support zones
   - Buy points
   - Sell points
```

---

## 26. Trade Detail

Người dùng có thể xem bảng chi tiết giao dịch:

| # | Entry Time | Entry Price | Exit Time | Exit Price | Result |
|---|-----------|-------------|-----------|------------|--------|
| 1 | 01/07 08:00 | 108K | 01/07 15:00 | 110K | +1.85% |
| 2 | 02/07 10:00 | 111K | 02/07 18:00 | 110K | -0.90% |
| 3 | 04/07 07:00 | 109K | 05/07 12:00 | 114K | +4.58% |

Khi click vào Trade #3, chart highlight:

```
ENTRY ↑
...
EXIT ↓
```

---

## 27. Module 10 – News Crawler

> **Giá cryptocurrency không chỉ phụ thuộc vào biểu đồ. Tin tức cũng có thể tác động đến thị trường.**

### 27.1 Ví dụ tin tức ảnh hưởng

- Bitcoin ETF news
- Federal Reserve interest rates
- Crypto regulation
- Exchange hacked
- New blockchain upgrade
- Institutional adoption

### 27.2 Module News Collector

Có nhiệm vụ thu thập dữ liệu từ các nguồn phù hợp, sau đó chuẩn hóa thành:

```typescript
interface News {
  id: string;
  title: string;
  content: string;
  source: string;
  publishedAt: Date;
  crawledAt: Date;
  relatedCoins: string[];
  url: string;
}
```

**Ví dụ:**

```json
{
  "title": "Bitcoin rises after ...",
  "publishedAt": "2026-07-28 08:15",
  "relatedCoins": ["BTC"],
  "source": "XXX"
}
```

---

## 28. News không được gắn cứng với một crawler

### 28.1 Cách KHÔNG NÊN thiết kế

```
┌─────────────────┐
│Trading System   │
└────────┬────────┘
         ↓
    Website A Crawler
    (gắn cứng - không linh hoạt)
```

### 28.2 Cách NÊN thiết kế

```
           ┌───────────────┐
           │ News Provider │  (interface chuẩn hóa)
           └───────┬───────┘
       ┌───────────┼───────────┐
       ↑           ↑           ↑
  ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
  │  RSS    │ │News API │ │ Crawler │
  └─────────┘ └─────────┘ └─────────┘

Các provider trả về cùng một format chuẩn: NewsItem
Nhờ đó việc thay nguồn dữ liệu không ảnh hưởng đến các module phía sau.
```

---

## 29. Module 11 – Sentiment Analysis

> Sau khi có news, **Machine Learning Service** có thể phân loại sentiment.

### 29.1 Các loại Sentiment

| Tin tức | Ví dụ | Sentiment |
|---------|-------|-----------|
| Tích cực | "Bitcoin surges after institutional adoption..." | **POSITIVE** |
| Tiêu cực | "Major exchange suffers security breach..." | **NEGATIVE** |
| Trung lập | "Bitcoin network upgrade scheduled..." | **NEUTRAL** |

### 29.2 Kết quả lưu trữ

```typescript
interface News {
  // ... các trường khác
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  score: number; // ví dụ: 0.82
}
```

---

## 30. Sentiment có thể trở thành một Strategy

> **Đây là một điểm kiến trúc thú vị.**

### 30.1 Biến đổi theo thời gian

**Ban đầu:**

```
Strategy đơn thuần:
- MA
- RSI
- BB
- SR
```

**Sau này có thể có:**

```
- NewsSentimentStrategy (strategy từ tin tức)
```

### 30.2 Sentiment Strategy

```typescript
class SentimentStrategy implements Strategy {
  analyze(context: MarketContext): Signal {
    const avgSentiment = context.sentiment; // trung bình sentiment 1 giờ

    if (avgSentiment > 0.7) return Signal.BUY;
    if (avgSentiment < -0.7) return Signal.SELL;
    return Signal.HOLD;
  }
}
```

### 30.3 Kết hợp với các strategy khác

```
MA + RSI + News Sentiment
Support Resistance + News Sentiment
```

### 30.4 Ý nghĩa kiến trúc

> **Kiến trúc không còn giới hạn ở Technical Analysis.**
> Có thể mở rộng sang **Information Analysis**.

---

## 31. Kiến trúc tổng thể gợi ý

```
                       ┌───────────────┐
                       │   Frontend    │
                       │   Dashboard   │
                       └───────┬───────┘
                               │
                          API / WebSocket
                               │
                      ┌────────▼─────────┐
                      │     Backend      │
                      └────────┬─────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  Market Data  │     │   Strategy    │     │     News      │
│   Service     │     │   Service     │     │   Service     │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│    Binance     │     │   Strategy    │     │     News      │
│    Adapter     │     │   Registry    │     │   Providers   │
└───────────────┘     └───────┬───────┘     └───────────────┘
                              │
                              ▼
                     ┌───────────────┐
                     │ Combination   │
                     │    Engine     │
                     └───────┬───────┘
                             │
                             ▼
                     ┌───────────────┐
                     │  Backtester   │
                     └───────┬───────┘
                             │
                             ▼
                     ┌───────────────┐
                     │  Evaluator    │
                     └───────┬───────┘
                             │
                             ▼
                     ┌───────────────┐
                     │ Leaderboard   │
                     └───────────────┘

   ┌─────────────┐
   │ News Service │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ Sentiment   │
   │  Service    │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐     ┌─────────────┐
   │ Sentiment   │────▶│  Strategy   │
   │  Database   │     │   Engine    │
   └─────────────┘     └─────────────┘
```

> **Đây chỉ là kiến trúc tham khảo.** Nhóm được phép đề xuất kiến trúc khác nếu giải thích được lựa chọn của mình.

---

## 32. Những vấn đề Kiến trúc phần mềm mà đồ án phải giải quyết

> Sinh viên cần xem đây là các **architectural drivers**.

### 32.1 Modifiability – Khả năng thay đổi

> Có thể thêm **MACD Strategy** mà không phải sửa 20 module?

### 32.2 Scalability – Khả năng mở rộng

| Giai đoạn | Số lượng strategies |
|-----------|---------------------|
| Ban đầu | 10 |
| Sau này | 100,000 |

→ Hệ thống có thể thay đổi kiến trúc như thế nào?

### 32.3 Realtime – Thời gian thực

Khi Binance có dữ liệu mới:

```
Market Data → Indicator → Strategy → UI
```

→ Làm sao cập nhật với **độ trễ thấp**?

### 32.4 Reliability – Độ tin cậy

Nếu Binance mất kết nối:

```
Connection lost
```

Hệ thống xử lý ra sao?

- Reconnect?
- Retry?
- Có mất candles không?

### 32.5 Performance – Hiệu năng

Có **1,000 strategies** cần backtest.

```
Cần chạy tuần tự?
 1
 2
 3
 ...
 1000

Hay sử dụng?
  Job Queue + Workers (song song)
```

### 32.6 Maintainability – Khả năng bảo trì

> Strategy Search không được phụ thuộc chặt vào Backtesting implementation.

Ví dụ có thể thay:

```
Random Search  →  Genetic Search
```

Mà **Backtester vẫn giữ nguyên**.

### 32.7 Observability – Khả năng quan sát

Hệ thống nên biết:

- Loop đang chạy hay dừng?
- Đã thử bao nhiêu strategy?
- Backtest mất bao lâu?
- Có bao nhiêu job lỗi?
- Strategy nào đang đứng Top 1?

---

## 33. Một luồng hoàn chỉnh của hệ thống

Giả sử người dùng chọn: **BTCUSDT, 5m**

### Bước 1 – Market Data

```
Binance → BTC candles
```

### Bước 2 – Strategy Generator

```
Sinh candidate: MA20 + RSI14 + SupportResistance
```

### Bước 3 – Backtester

```
Chạy trên: BTCUSDT, 01/01 → 01/07, 5m
```

### Bước 4 – Trade Simulation

```
Sinh: 82 trades
```

### Bước 5 – Evaluator

```
Return = 18.2%
Win Rate = 61%
MDD = -6.1%
```

### Bước 6 – Ranking

```
Score = 81.4
```

### Bước 7

```
Candidate hiện tại đứng: Rank #2
```

### Bước 8

```
Frontend nhận event: LEADERBOARD_UPDATED
```

### Bước 9

```
Leaderboard tự cập nhật.
Không cần refresh trang.
```

---

## 34. Các Event có thể xuất hiện

> Nhóm sử dụng **event-driven architecture** có thể định nghĩa các event sau:

| Event | Mô tả |
|-------|-------|
| `MarketPriceUpdated` | Giá thị trường cập nhật |
| `CandleClosed` | Cây nến đóng |
| `StrategyGenerated` | Strategy mới được sinh |
| `BacktestStarted` | Backtest bắt đầu |
| `BacktestCompleted` | Backtest hoàn thành |
| `StrategyEvaluated` | Strategy được đánh giá |
| `LeaderboardUpdated` | Leaderboard thay đổi |
| `NewsCollected` | Tin tức được thu thập |
| `SentimentAnalyzed` | Sentiment được phân tích |

### Ví dụ event flow

```
Backtest Worker
       │
       │ Publish: StrategyEvaluatedEvent
       │
       ▼
Ranking Service nhận event
       │
       ▼
Không cần gọi trực tiếp LeaderboardService.update()
```

> **Điều này giúp giảm coupling giữa các module.**

---

## 35. Database

Có thể có các nhóm dữ liệu:

### 35.1 Market Data

```
Candles
  - Pair
  - Timeframe
  - Timestamp
  - Open, High, Low, Close
  - Volume
```

### 35.2 Strategy

```
StrategyDefinition
  - Parameters
  - Version
  - CreatedAt
```

### 35.3 Experiment

```
Experiment
  - Combination
  - Dataset
  - Timeframe
  - Parameters
  - Result
```

### 35.4 Trades

```
Trades
  - Entry
  - Exit
  - Profit
  - Strategy
```

### 35.5 News

```
News
  - Title
  - Content
  - Source
  - PublishedAt
  - RelatedCoin
  - Sentiment
```

### 35.6 Leaderboard

```
Có thể:
- Lưu trực tiếp
- Tính từ Experiment Results

Nhóm cần giải thích lựa chọn.
```

---

## 36. Strategy phải có Version

> **Đây là vấn đề Reproducibility.**

### Ví dụ

```
MA-RSI Strategy v1
  - MA20
  - MA50
  - RSI14

MA-RSI Strategy v2
  - MA10
  - MA30
  - RSI21
```

### Yêu cầu

- **Không nên overwrite** kết quả cũ
- Cần đảm bảo: **Experiment #122** luôn biết chính xác nó đã sử dụng strategy nào

---

## 37. Mức tối thiểu – MVP

> **Để tránh đồ án quá lớn, nhóm bắt buộc hoàn thành tối thiểu:**

### 37.1 Market

- ✅ Binance data
- ✅ Candlestick chart
- ✅ Realtime update
- ✅ Tối đa 4 timeframe

### 37.2 Strategy

- ✅ Ít nhất **4 strategy đơn lẻ**:
  - MA
  - RSI
  - Bollinger
  - Support/Resistance

### 37.3 Combination

- ✅ Có khả năng tạo **composite strategy**

### 37.4 Backtest

- ✅ Có khả năng giả lập giao dịch trên **historical data**

### 37.5 Evaluation

- ✅ Tối thiểu các metrics:
  - Return
  - Win Rate
  - Max Drawdown
  - Number of Trades

### 37.6 Search

- ✅ Ít nhất một phương pháp: **Random Search**

### 37.7 Leaderboard

- ✅ **Top-K strategies**

### 37.8 Visualization

- ✅ Chart có:
  - Buy/Sell
  - Entry/Exit

### 37.9 News

- ✅ Có pipeline:
  ```
  Collect → Store → Analyze sentiment
  ```

---

## 38. Phần mở rộng

> **Các nhóm có thể mở rộng bằng:**

### 38.1 Search

| Phương pháp |
|-------------|
| Genetic Algorithm |
| Evolutionary Search |
| Bayesian Optimization |
| LLM Strategy Generator |

### 38.2 Trading

| Tính năng |
|-----------|
| Long/Short |
| Stop Loss |
| Take Profit |
| Trailing Stop |
| Position Sizing |

### 38.3 Market

| Tính năng |
|-----------|
| Multiple Coins |
| Multiple Exchanges |

### 38.4 ML

| Tính năng |
|-----------|
| Sentiment |
| Price Prediction |
| Market Regime Detection |

### 38.5 Architecture

| Công nghệ |
|-----------|
| Redis |
| Kafka/RabbitMQ |
| Worker Pool |
| Microservices |
| CQRS |
| Event Sourcing |
| Plugin Architecture |

### ⚠️ Lưu ý quan trọng

> **Không được cộng điểm chỉ vì sử dụng công nghệ phức tạp.**
> Nhóm phải **chứng minh**: Công nghệ đó giải quyết vấn đề kiến trúc nào?

---

## 39. Một ví dụ để hiểu đúng mục tiêu đồ án

### ❌ Không nên hiểu đồ án là:

```
Viết MA + RSI để kiếm tiền.
```

### ✅ Mà phải hiểu là:

> Thiết kế một hệ thống mà:
>
> - Hôm nay có **MA + RSI**
> - Ngày mai có thể thêm **SMC, Wyckoff, Sentiment** hoặc một strategy hoàn toàn mới
> - Mà kiến trúc cũ vẫn hoạt động

> Tương tự:
>
> - Hôm nay dùng **Random Search**
> - Ngày mai thay bằng **Genetic Algorithm**
> - Mà **Backtester, Evaluator, Leaderboard, Visualization** không cần viết lại

> **Đây mới là vấn đề của Software Architecture.**

---

## 40. Câu hỏi kiến trúc trung tâm

> **Trong báo cáo, nhóm phải trả lời được các câu hỏi:**

| # | Câu hỏi |
|---|---------|
| 1 | Strategy mới được thêm vào hệ thống như thế nào? Ví dụ: `MACDStrategy` được thêm mà sửa những component nào? |
| 2 | Search algorithm mới được thêm như thế nào? Từ `Random Search` sang `Genetic Search` có ảnh hưởng Backtesting Engine không? |
| 3 | Market Data Provider mới được thêm như thế nào? Từ `Binance` sang `Binance + OKX` có phải sửa frontend không? |
| 4 | Nếu số backtest tăng từ 100 lên 100.000 thì kiến trúc thay đổi thế nào? |
| 5 | Nếu News Service bị lỗi thì Chart có còn chạy không? |
| 6 | Nếu Sentiment Model thay đổi thì Strategy Engine có bị ảnh hưởng không? |
| 7 | Nếu Binance WebSocket disconnect thì hệ thống phục hồi như thế nào? |
| 8 | Làm sao kiểm tra một kết quả trên Leaderboard được tạo ra bởi version strategy nào? |

---

## 41. Scenario đánh giá khả năng mở rộng

> Giảng viên có thể đặt yêu cầu:
> *"Hệ thống hiện có MA, RSI, Bollinger và Support/Resistance. Hãy bổ sung MACD."*

### Nhóm thiết kế TỐT chỉ cần:

```typescript
class MACDStrategy implements Strategy {
  // ...
}

// và
StrategyRegistry.register(MACDStrategy);
```

### Nhóm thiết kế COUPLING CAO có thể phải sửa:

- ❌ Controller
- ❌ Backtester
- ❌ UI
- ❌ Database
- ❌ Combination Engine
- ❌ Evaluator

> **Đây là một minh chứng trực quan cho chất lượng kiến trúc.**

---

## 42. Scenario đánh giá khả năng thay đổi

> Một scenario khác:
> *"Hiện tại: RandomStrategyGenerator. Giảng viên yêu cầu thêm: DomainGuidedStrategyGenerator"*

### 42.1 Thiết kế đúng

```typescript
interface StrategyGenerator {
  generate(): CandidateStrategy;
}

// Có thể có nhiều implementation:
class RandomGenerator implements StrategyGenerator { }
class DomainGuidedGenerator implements StrategyGenerator { }
class GeneticGenerator implements StrategyGenerator { }
```

### 42.2 Nguyên tắc

> Các component phía sau chỉ nhận:
> `CandidateStrategy`
>
> và **không cần biết** candidate được sinh ra bằng cách nào.

---

## 43. Scenario đánh giá scalability

> **Giả sử:**
> 1 Backtest Worker mất: **2 giây / candidate**
>
> 10.000 candidate cần: **20.000 giây (~5.5 giờ)**

### Hệ thống nên cho phép mở rộng:

```
              Job Queue
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
 Worker 1   Worker 2   Worker 3
    │            │            │
    ▼            ▼            ▼
   (đang      (đang      (đang
    chạy)      chạy)      chạy)
```

> Đây là ví dụ để sinh viên hiểu tại sao:
> **Queue + Worker + Event** có thể quan trọng trong kiến trúc này.

---

## 44. Các Anti-pattern nên tránh

### 44.1 ❌ God Service

> **Không nên có một `TradingService` vừa:**
>
> - get Binance data
> - calculate RSI
> - crawl news
> - run ML
> - backtest
> - rank
> - save database
> - send WebSocket

### 44.2 ❌ Hard-coded Strategy

> **Không nên:**

```typescript
if (MA && RSI) ...
else if (MA && Bollinger) ...
else if (RSI && Bollinger) ...
```

### 44.3 ❌ Frontend chứa business logic

> **Không nên để React/Vue tính:**
>
> - trading strategy
> - backtest
> - profit
> - ranking

### 44.4 ❌ Strategy truy cập trực tiếp Database

> **Không nên:**

```
RSIStrategy → MySQL
```

> Strategy nên nhận data cần thiết thông qua **abstraction** thích hợp.

### 44.5 ❌ Crawler phụ thuộc chặt vào ML

> **Không nên:**

```
Crawler → BERT model
```

> **Nên:**

```
Crawler:  chỉ collect news
Sentiment Service: analyze news
```

---

## 45. Deliverables

> **Nhóm cần nộp:**

### 45.1 1. Source Code

- Repository hoàn chỉnh

### 45.2 2. README

- Install
- Run
- Architecture
- Demo

### 45.3 3. Architecture Document

Tối thiểu mô tả:

- System Context
- Container/Module decomposition
- Component responsibilities
- Data Flow
- Realtime Flow
- Strategy Flow
- Search/Backtest Flow

### 45.4 4. Architectural Decisions (ADR)

| ADR | Nội dung |
|-----|---------|
| ADR-001 | Tại sao dùng WebSocket? |
| ADR-002 | Tại sao dùng Plugin Architecture cho Strategy? |
| ADR-003 | Tại sao dùng Queue cho Backtesting? |
| ADR-004 | Tại sao tách Sentiment Service? |

### 45.5 5. Demo

Demo tối thiểu bao gồm:

- ✅ Realtime chart
- ✅ Multi timeframe
- ✅ Thêm/chọn strategy
- ✅ Generate combination
- ✅ Backtest
- ✅ Leaderboard
- ✅ Trade visualization
- ✅ News
- ✅ Sentiment

---

## 46. Demo scenario đề xuất

> **Một demo tốt có thể diễn ra như sau:**

### Bước 1

Mở **BTCUSDT**, khung thời gian: `5m | 15m | 1h | 4h`

→ **4 chart realtime**

### Bước 2

Chọn các chỉ báo:

```
☑ MA
☑ RSI
☑ Bollinger
☑ Support Resistance
```

### Bước 3

Bấm: **`START SEARCH`**

### Bước 4

Màn hình hiển thị:

```
Candidates tested: 125
Current: MA20 + RSI14 + SR
Backtesting...
```

### Bước 5

Leaderboard thay đổi:

```
#1  MA20 + RSI14 + SR
#2  MA50 + BB
#3  RSI + SR
```

### Bước 6

Click **Top #1**.

Chart hiển thị:

```
☑ Buy signals
☑ Sell signals
☑ MA
☑ Support
☑ Resistance
```

### Bước 7

Hiển thị metrics:

```
Trades     = 81
Win Rate   = 61%
Return     = 18.2%
MDD        = -6.1%
```

### Bước 8

Chuyển sang **News**:

```
BTC News
  Positive:  42%
  Neutral:    38%
  Negative:  20%
```

### Bước 9

Thêm **`SentimentStrategy`** vào search space.

### Bước 10

Chạy lại loop:

```
MA + RSI + Sentiment
MA + SR + Sentiment
...
```

### Kết luận demo

> **Qua demo này có thể thấy hầu hết các component kiến trúc hoạt động cùng nhau.**

---

## 47. Ý nghĩa cuối cùng của đồ án

### 47.1 Mục tiêu thực sự

> **Đồ án không nhằm chứng minh rằng:**
> `MA + RSI + SMC` có thể kiếm tiền thật.

> **Mục tiêu là:**
> Xây dựng một **software architecture** có khả năng thử nghiệm các ý tưởng như vậy một cách **có hệ thống**.

### 47.2 Hệ thống phải chuyển bài toán

```
"Tôi có một strategy mới."
         │
         ▼
┌─────────────────┐
│ Plugin Strategy │
└────────┬────────┘
         ↓
┌─────────────────┐
│    Combine       │
└────────┬────────┘
         ↓
┌─────────────────┐
│   Backtest      │
└────────┬────────┘
         ↓
┌─────────────────┐
│   Evaluate      │
└────────┬────────┘
         ↓
┌─────────────────┐
│   Compare       │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Leaderboard    │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Visualize      │
└────────┬────────┘
         │
         └────────→ Lặp lại:
                   Generate → Execute → Measure → Rank → Improve → Generate...
```

### 47.3 Bản chất đồ án

> **Sự kết hợp của:**

```
Realtime System
      +
Plugin Architecture
      +
Data Pipeline
      +
Event-driven Architecture
      +
Experiment Platform
      +
Verification Loop
```

### 47.4 Điều quan trọng nhất

> Sinh viên được tự do lựa chọn **framework, database, message queue, mô hình ML và thuật toán tìm kiếm**.
>
> **Điều quan trọng nhất cần chứng minh là:**
>
> Kiến trúc được thiết kế như thế nào để các thành phần có thể **thay đổi, mở rộng** và hoạt động **độc lập** trong khi toàn bộ hệ thống vẫn duy trì được:
>
> - ✅ **Tính đúng đắn** (Correctness)
> - ✅ **Khả năng quan sát** (Observability)
> - ✅ **Khả năng phát triển lâu dài** (Long-term evolvability)

---

*Crypto Strategy Lab – Đồ án cuối kỳ*
