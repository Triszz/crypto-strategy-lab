# market-data

**Owner:** Bảo
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

This folder is the structural skeleton for the Market Data Service.
Business logic is intentionally NOT implemented here — that work belongs
to the market-data sub-team (Bảo) in a later task.

## Responsibilities (to be implemented later)

- Connect to Binance REST (historical) + WebSocket (realtime).
- Normalise external DTOs into the internal `Candle` type.
- Persist candles into PostgreSQL through the `CandleRepository` port.
- Publish `CandleClosed` events on the shared EventBus.
- Broadcast realtime updates to the frontend via Socket.IO.

## Dependency rules

- `domain/` may only depend on other `domain/` types and shared abstractions.
- `application/` may depend on `domain/`.
- `infrastructure/` may depend on `domain/` and external SDKs.
- `presentation/` may depend on `application/` and Express.

## TODO (added by skeleton setup)

- Concrete `Candle`, `Timeframe` and `CandleRepository` port are defined
  inside `docs/Market Data Service.md`. They will be ported into this
  module by the owner.
- `BinanceRestAdapter`, `BinanceWsAdapter`, `CandleNormalizer`,
  `PostgresCandleRepository` will be added by the owner.
- HTTP routes for `/api/candles` will be added by the owner inside
  `presentation/`.
