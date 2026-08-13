# leaderboard

**Owner:** Nhân
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the Leaderboard module.

## Responsibilities (to be implemented later)

- `LeaderboardService` listens to `StrategyEvaluated` and recomputes
  the Top-K table (FR-044..FR-049, BR-029..BR-032).
- Persists `LeaderboardEntry` (unique per
  `(strategy_version_id, symbol_id, timeframe)`) and `RankingHistory`.
- Publishes `LeaderboardUpdated` events.

## Dependency rules

- Leaderboard MUST NOT depend on the Search Engine or Backtester
  internals (AC-09); it ONLY listens to events / ports.
- Domain MUST NOT import Prisma, Express, BullMQ, Socket.IO.

## TODO (added by skeleton setup)

- Real implementations will be added by the leaderboard owner in
  later tasks.
