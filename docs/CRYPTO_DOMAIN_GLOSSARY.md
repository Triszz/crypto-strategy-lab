# 📚 Từ Điển Thuật Ngữ Crypto & Hệ Thống Chiến Thuật Giao Dịch
## (Crypto Domain Glossary & Technical Reference)

> **Dự án Crypto Strategy Lab – Kiến trúc Phần mềm**  
> Tài liệu này giải thích chi tiết toàn bộ các thuật ngữ chuyên ngành về tiền mã hóa (Crypto), giao dịch tài chính (Trading), phân tích tin tức (Sentiment Analysis), đánh giá định lượng (Evaluation Metrics) và tự động hóa chiến thuật (Continuous Loop) được sử dụng trong hệ thống.

---

## 📋 Mục Lục
1. [Khái niệm về Thị trường & Dữ liệu Giá (Market Data & Assets)](#1-khái-niệm-về-thị-trường--dữ-liệu-giá-market-data--assets)
2. [Khái niệm về Giao dịch & Tín hiệu (Trading & Signals)](#2-khái-niệm-về-giao-dịch--tín-hiệu-trading--signals)
3. [Phân tích Cảm xúc Tin tức (News Sentiment & NLP)](#3-phân-tích-cảm-sức-tin-tức-news-sentiment--nlp)
4. [Các Chỉ số Đánh giá Hiệu năng Chiến thuật (Evaluation Metrics)](#4-các-chỉ-số-đánh-giá-hiệu-năng-chiến-thuật-evaluation-metrics)
5. [Tổ hợp Chiến thuật & Vòng lặp Tự động (Combination & Continuous Loop)](#5-tổ-hợp-chiến-thuật--vòng-lặp-tự-động-combination--continuous-loop)

---

## 1. Khái niệm về Thị trường & Dữ liệu Giá (Market Data & Assets)

### 1.1 Base Asset (Tài sản cơ sở)
- **Giải thích**: Là đồng tiền mã hóa gốc được mua hoặc bán trong một giao dịch.
- **Ví dụ trong hệ thống**: `BTC` (Bitcoin), `ETH` (Ethereum), `SOL` (Solana).
- **Ứng dụng**: Khi cào tin tức hoặc phân tích Sentiment, hệ thống sẽ quy đổi về `Base Asset` (ví dụ bài báo về `BTCUSDT` sẽ được gắn nhãn cho đồng `BTC`).

### 1.2 Quote Asset (Tài sản định giá)
- **Giải thích**: Là đồng tiền định giá (thường là Stablecoin - đồng tiền ổn định) dùng để đo lường giá trị của Base Asset.
- **Ví dụ**: `USDT` (Tether), `USDC` (USD Coin), `USD`.

### 1.3 Symbol / Trading Pair (Cặp giao dịch)
- **Giải thích**: Sự kết hợp giữa Base Asset và Quote Asset để tạo thành 1 cặp giao dịch niêm yết trên sàn.
- **Công thức**: `Symbol = Base Asset + Quote Asset` (Ví dụ: `BTCUSDT`, `ETHUSDT`).

### 1.4 Candle / OHLCV (Nến Nhật & Dữ liệu Giá)
- **Giải thích**: Là mô hình biểu diễn sự biến động giá của tài sản trong một khoảng thời gian cố định. Một cây nến bao gồm 5 thông số (OHLCV):
  - **Open (O)**: Giá mở cửa cây nến.
  - **High (H)**: Giá cao nhất đạt được trong phiên.
  - **Low (L)**: Giá thấp nhất đạt được trong phiên.
  - **Close (C)**: Giá đóng cửa phiên.
  - **Volume (V)**: Tổng khối lượng giao dịch trong phiên.

### 1.5 Timeframe / Interval (Khung thời gian nến)
- **Giải thích**: Đơn vị thời gian đại diện cho 1 cây nến.
- **Các khung hỗ trợ trong hệ thống**:
  - `1m` (1 phút), `5m` (5 phút), `15m` (15 phút).
  - `1h` (1 giờ), `4h` (4 giờ), `1d` (1 ngày).

---

## 2. Khái niệm về Giao dịch & Tín hiệu (Trading & Signals)

### 2.1 Signal (Tín hiệu giao dịch)
- **Giải thích**: Là đầu ra do chiến thuật (Strategy) tính toán ra dựa trên nến và tin tức tại một thời điểm.
- **Các giá trị Signal**:
  - **`BUY`**: Tín hiệu Mua vào (kỳ vọng giá sẽ tăng).
  - **`SELL`**: Tín hiệu Bán ra / Cắt lỗ (kỳ vọng giá giảm hoặc chốt lời).
  - **`HOLD`**: Giữ nguyên vị thế, không thực hiện hành động gì.

### 2.2 Position (Vị thế giao dịch)
- **LONG (Vị thế Mua)**: Mua tài sản ở giá thấp và chờ bán ở giá cao hơn để ăn chênh lệch lời.
- **SHORT (Vị thế Bán khống)**: Mượn tài sản bán ở giá cao và mua trả lại ở giá thấp hơn để kiếm lời khi thị trường giảm điểm.

### 2.3 Trade / Executed Order (Giao dịch thực thi)
- **Giải thích**: Khi một tín hiệu `BUY` được phát ra và sau đó khớp với một tín hiệu `SELL`, một chu kỳ giao dịch (`Trade`) hoàn chỉnh được ghi nhận.
- **Thông số của 1 Trade**: Thời gian vào/ra lệnh, giá vào/ra lệnh, lợi nhuận/lỗ (PnL) tính bằng % và số tiền.

### 2.4 Slippage (Trượt giá) & Trading Fee (Phí giao dịch)
- **Slippage**: Độ chênh lệch giữa giá thực tế khớp lệnh và giá bạn nhìn thấy lúc phát lệnh (do độ trễ mạng hoặc thanh khoản thị trường).
- **Trading Fee**: Phí hoa hồng trả cho sàn giao dịch trên mỗi lệnh (thường mặc định 0.1%). Hệ thống Backtest tự động trừ khoản phí này để đảm bảo kết quả sát thực tế nhất.

---

## 3. Phân tích Cảm xúc Tin tức (News Sentiment & NLP)

### 3.1 Sentiment Classification (Phân loại Cảm xúc)
Mỗi bài báo sau khi cào về sẽ được mô hình AI/NLP gán vào 1 trong 3 nhóm cảm xúc:
- **`POSITIVE` (Tích cực)**: Tin tức tốt (tăng trưởng, được chính phủ duyệt ETF, mở rộng hợp tác, nâng cấp mạng).
- **`NEGATIVE` (Tiêu cực)**: Tin tức xấu (hack sàn, rò rỉ rủi ro, chính phủ cấm đoán, vụ kiện tụng, phá sản).
- **`NEUTRAL` (Trung tính)**: Tin tức sự kiện thông thường, nhận định kỹ thuật không quá nghiêng về bên nào.

### 3.2 Sentiment Score (Điểm số Cảm xúc)
- **Giải thích**: Giá trị số thực nằm trong khoảng **$[-1.0, +1.0]$** phản ánh mức độ gay gắt/lạc quan của tin tức.
  - Điểm $+1.0$: Cực kỳ tích cực (Bullish cực độ).
  - Điểm $0.0$: Hoàn toàn trung tính (Neutral).
  - Điểm $-1.0$: Cực kỳ tiêu cực (Bearish thảm họa).

### 3.3 Lookback Window (Cửa sổ thời gian quá khứ)
- **Giải thích**: Khoảng thời gian (tính theo giờ, ví dụ $1h, 4h, 24h$) mà chiến thuật quét lại tất cả bài báo trong quá khứ để tính toán điểm sentiment trung bình $\bar{S}$.

### 3.4 Lexicon Analyzer (Bộ phân tích theo từ điển)
- **Giải thích**: Thuật toán đếm tần suất các từ khóa tích cực/tiêu cực chuyên ngành Crypto (Tiếng Anh + Tiếng Việt). Chạy hoàn toàn 100% offline, 0ms latency, không tốn tiền API.

### 3.5 Gemini LLM Analyzer (Bộ phân tích AI)
- **Giải thích**: Sử dụng mô hình trí tuệ nhân tạo Gemini 1.5 Flash của Google để đọc hiểu ngữ cảnh bài báo. Nếu API gặp sự cố, hệ thống có cơ chế **Fallback** tự chuyển sang Lexicon Analyzer.

### 3.6 Self-Healing Extraction (Cơ chế Tự phục hồi DOM)
- **Giải thích**: Tính năng tự động phát hiện khi giao diện một trang báo thay đổi CSS Selector. Hệ thống tự gọi Gemini AI sinh ra CSS Selector mới và cập nhật template mà không cần lập trình viên sửa code.

---

## 4. Các Chỉ số Đánh giá Hiệu năng Chiến thuật (Evaluation Metrics)

Khi chạy Backtest, `EvaluatorEngine` tính toán 12 chỉ số tài chính định lượng chuyên nghiệp:

| Chỉ số | Tên tiếng Anh | Ý nghĩa & Cách đọc |
| :--- | :--- | :--- |
| **Total Return (%)** | Lợi nhuận Tổng | Tỷ lệ phần trăm tăng trưởng tổng tài sản so với vốn ban đầu. (Ví dụ: $+45\%$). |
| **Win Rate (%)** | Tỷ lệ Thắng | Tỷ lệ số lệnh có lời trên tổng số lệnh đã thực hiện. $$\text{WinRate} = \frac{\text{WinningTrades}}{\text{TotalTrades}} = \frac{N_{\text{win}}}{N_{\text{total}}}$$ |
| **Max Drawdown - MDD (%)** | Mức Sụt giảm Tối đa | Mức giảm phần trăm lớn nhất của tài sản tính từ đỉnh cao nhất xuống đáy thấp nhất. **MDD càng nhỏ chiến thuật càng an toàn**. |
| **Sharpe Ratio** | Tỷ lệ Sharpe | Đo lường mức lợi nhuận tạo ra trên mỗi đơn vị rủi ro tổng thể. **Sharpe $> 1.0$ là tốt, $> 2.0$ là xuất sắc**. |
| **Sortino Ratio** | Tỷ lệ Sortino | Tương tự Sharpe nhưng chỉ tính rủi ro biến động âm (rủi ro thua lỗ). Thích hợp đánh giá thị trường crypto biến động mạnh. |
| **Profit Factor** | Hệ số Lợi nhuận | Tỷ lệ giữa Tổng số tiền Lời và Tổng số tiền Lỗ. $$\text{ProfitFactor} = \frac{\text{GrossWin}}{\text{GrossLoss}} = \frac{\sum_{\text{win}} \text{PnL}_k}{\sum_{\text{loss}} \left|\text{PnL}_k\right|}$$ |
| **Calmar Ratio** | Tỷ lệ Calmar | Tỷ lệ giữa Lợi nhuận năm và Max Drawdown. Đo lường khả năng hồi phục sau chuỗi thua lỗ. |
| **Trade-Count Penalty** | Hình phạt Số lệnh | Công thức phạt giảm điểm $\text{Score} \times \sqrt{N / 30}$ nếu số giao dịch $N < 30$ lệnh, nhằm tránh hiện tượng quá khớp (Overfitting) do may mắn. |
| **Overall Score** | Điểm số Tổng hợp | Điểm đánh giá tổng thể từ $0 - 100$ kết hợp trọng số của tất cả các chỉ số trên để xếp hạng trên Leaderboard. |

---

## 5. Tổ hợp Chiến thuật & Vòng lặp Tự động (Combination & Continuous Loop)

### 5.1 Base Strategy (Chiến thuật Cơ sở)
- **Giải thích**: Chiến thuật đơn lẻ sử dụng 1 loại chỉ báo duy nhất.
- **Ví dụ**:
  - `SMA Cross Strategy` (Cắt đường trung bình động).
  - `RSI Strategy` (Chỉ số sức mạnh tương đối).
  - `NewsSentimentStrategy` (Chiến thuật theo cảm xúc tin tức).

### 5.2 Composite / Combination Strategy (Chiến thuật Tổ hợp)
- **Giải thích**: Chiến thuật kết hợp nhiều `Base Strategy` lại với nhau để tăng độ chính xác và giảm tín hiệu giả.
- **Ví dụ**: `MA Cross (trọng số 0.4) + RSI (trọng số 0.3) + News Sentiment (trọng số 0.3)`.

### 5.3 Combination Operator (Toán tử Kết hợp)
- **`WEIGHTED` (Tổng trọng số)**: Tính tổng điểm nhân với trọng số của từng chiến thuật thành phần.
- **`AND` (Đồng thuận tuyệt đối)**: Bắt buộc TẤT CẢ các chiến thuật thành phần cùng ra tín hiệu `BUY` thì mới phát lệnh Mua.
- **`OR` (Bất kỳ)**: Chỉ cần 1 trong các chiến thuật ra tín hiệu `BUY` là phát lệnh Mua.

### 5.4 Candidate (Ứng viên Chiến thuật)
- **Giải thích**: Một thể hiện chiến thuật cụ thể mang một bộ tham số định hình (ví dụ: Candidate A = `NewsSentimentStrategy` với `lookback=4h, buyThreshold=0.8`).

### 5.5 Continuous Loop (Vòng lặp Tìm kiếm & Tối ưu Tự động)
- **Giải thích**: Tiến trình chạy ngầm liên tục sinh ra các Candidate mới, tự động chạy Backtest, đánh giá chỉ số, lọc bỏ chiến thuật kém và đẩy chiến thuật xuất sắc lên **Leaderboard**.

### 5.6 Leaderboard (Bảng Vinh Danh Chiến Thuật)
- **Giải thích**: Bảng xếp hạng Realtime vinh danh Top các chiến thuật có `Overall Score`, `Total Return` hoặc `Sharpe Ratio` cao nhất hệ thống.

---

> 💡 **Mẹo**: Bạn có thể tra cứu file này bất cứ lúc nào tại đường dẫn [`docs/CRYPTO_DOMAIN_GLOSSARY.md`](file:///e:/Documents/HCMUS/Semester3_Year3/Kiến%20trúc%20phần%mềm/crypto-strategy-lab/docs/CRYPTO_DOMAIN_GLOSSARY.md).
