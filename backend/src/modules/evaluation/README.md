# evaluation

**Owner:** Nhân
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the Strategy Evaluation Engine.

## Responsibilities (to be implemented later)

- `Evaluator` port (FR-043, AC-027).
- Metric calculators: TotalReturn, WinRate, MaxDrawdown,
  OverallScore, Sharpe/Sortino ratios (FR-038..FR-042).
- Persist `BacktestResult` + `EvaluationMetric` rows.
- Publish `StrategyEvaluated` events to feed the Leaderboard.

## Dependency rules

- `Evaluator` depends only on `Trade[]` and the four required inputs.
  It MUST NOT call Express, Socket.IO, BullMQ, or Binance.
- Domain layer MUST NOT import Prisma.

## TODO (added by skeleton setup)

- `Evaluator`, metric classes, the application service, repositories
  and routes will be added by the evaluation owner in later tasks.
