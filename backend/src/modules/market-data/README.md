# market-data

**Owner:** Bảo

Market Data Service là module duy nhất giao tiếp với Binance. Đọc [`docs/Market Data Service.md`](../../../../docs/Market%20Data%20Service.md) để biết chi tiết.

## Layered Structure

```
domain/          → Types, interfaces (Port pattern)
application/     → Services (MarketDataService, BackfillService, ...)
infrastructure/  → External adapters (Binance REST/WS, PostgreSQL)
realtime/       → WebSocket handlers (SocketGateway, HeartbeatMonitor)
presentation/   → Express routes
```

## Core Responsibilities

1. **Kết nối Binance** — REST (`/api/v3/klines`) + WebSocket
2. **Chuẩn hóa** — `CandleNormalizer` (Binance DTO → internal Candle)
3. **Lưu trữ** — PostgreSQL via `CandleRepository` port
4. **Event** — `CandleClosed` trên EventBus + Socket.IO broadcast
5. **Tự phục hồi** — Exponential backoff (1s→30s) + 30s heartbeat

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/candles` | Query candles (symbol, timeframe, range) |
| POST | `/api/candles/load-more` | Fetch older candles từ Binance |
| GET | `/api/candles/chart-configs` | Get 4 active chart panes |
| PUT | `/api/candles/chart-configs` | Update chart config |

## Socket.IO

Client → Server:
```json
{ "type": "subscribe", "symbol": "BTCUSDT", "timeframes": ["1m", "1h"] }
```

Server → Client:
```json
{ "type": "CandleClosed", "version": "1.0", "timestamp": 1700000060000, "payload": {...} }
```

## Dependency Rules

- `domain/` → chỉ domain types
- `application/` → domain
- `infrastructure/` → domain + external SDK
- `presentation/` → application + Express
