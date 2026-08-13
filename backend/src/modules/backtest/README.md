# backtest

**Owner:** Huy
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the Backtesting Engine and Search Execution
pipeline.

## Responsibilities (to be implemented later)

- `Backtester` domain service: simulate a `Strategy` on a candle
  window, produce `Trade[]` and a `BacktestResult`.
- `BacktestJob` + `BacktestWorker` that consume from the BullMQ
  `backtest` queue (FR-029..FR-037).
- Persist `Experiment`, `BacktestResult`, `EvaluationMetric`, `Trade`.
- Publish `BacktestCompleted` events for downstream evaluation.

## Dependency rules

- Backtester depends on the `Strategy` interface only. It MUST NOT
  depend on Binance, Express, Socket.IO.
- Worker depends on BullMQ; the worker implementation lives in
  `infrastructure/` so domain/application stay agnostic.
- Domain stays pure (no Prisma, no BullMQ).

## TODO (added by skeleton setup)

- The owner will add `Backtester`, `BacktestQueue`, `BacktestWorker`,
  `Experiment` repository, and `POST /api/backtests` HTTP routes in
  later tasks.
- Only the Redis connection wiring (used by BullMQ) is provided by
  this foundation.
