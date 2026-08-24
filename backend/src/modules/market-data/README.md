# market-data

**Owner:** Bảo
**Layered structure:** `domain` → `application` → `infrastructure` → `realtime` → `presentation`

The Market Data Service is the single source of Binance integration.
It owns the connection to the exchange, normalises the wire format into
the internal `Candle` schema, persists candles in PostgreSQL, emits
`CandleClosed` events on the in-process EventBus, and pushes realtime
updates to front-end clients through Socket.IO.

## Responsibilities

- **Connect** to Binance REST (`/api/v3/klines`, `/api/v3/exchangeInfo`)
  and WebSocket (`wss://stream.binance.com:9443/stream`).
- **Normalise** every Binance DTO/WS frame through `CandleNormalizer`
  into the internal `Candle` type.
- **Persist** candles via the `CandleRepository` port
  (Prisma-backed implementation in `infrastructure/`).
- **Publish** `CandleClosed` on the EventBus for downstream consumers
  (Strategy, Search, Backtest, Evaluator, …).
- **Broadcast** realtime updates to frontend via Socket.IO with
  ref-counted subscriptions (one SUBSCRIBE to Binance for N clients).
- **Self-heal** on disconnects: exponential backoff 1s→30s cap + jitter,
  30 s heartbeat watchdog.
- **Bootstrap** the system on boot: sync symbols from Binance, seed
  6 supported timeframes, seed 4 default chart panes (BTCUSDT ×
  1m/1h/4h/1d), backfill the latest 1 000 candles per default chart,
  then keep the 4 streams subscribed to Binance WS.

## REST surface

| Method | Path                            | Purpose                                          |
|--------|---------------------------------|--------------------------------------------------|
| GET    | `/api/candles`                  | Query persisted candles by symbol/timeframe/range |
| POST   | `/api/candles/load-more`        | Pull N older candles from Binance and persist    |
| GET    | `/api/candles/chart-configs`    | Return the 4 active chart panes                  |

## Socket.IO protocol

See [`docs/Market Data Service.md`](../../../../docs/Market%20Data%20Service.md)
§9.1 for the wire schema. Clients send:

```json
{ "type": "subscribe", "symbol": "BTCUSDT", "timeframes": ["1m", "1h"] }
```

and receive `CandleClosed` events on the `candles:<symbol>@<tf>` room.

## Dependency rules

- `domain/` may only depend on other `domain/` types and shared abstractions.
- `application/` may depend on `domain/`.
- `infrastructure/` and `realtime/` may depend on `domain/` and external SDKs.
- `presentation/` may depend on `application/` and Express.

## Boot flow

See `MarketDataService.start()` in `application/MarketDataService.ts`
for the canonical boot sequence. The composable factory is
`buildMarketDataContainer()` in [`container.ts`](./container.ts), which
`backend/src/server.ts` calls after the Socket.IO singleton is
initialised.

## Out of scope (for this module)

- Trading logic — handled by the Strategy / Backtest modules.
- Indicator computation — delegate to IndicatorService if added later.
- News / Sentiment — owned by Nhân's News module.
