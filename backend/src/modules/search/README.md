# search

**Owner:** Trí
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the Strategy Search Engine.

## Responsibilities (to be implemented later)

- Define the `StrategyGenerator` interface.
- Implement `RandomGenerator` and `DomainGuidedGenerator` (FR-021,
  FR-022).
- Implement the `SearchController` loop with stop conditions
  (`maxCandidates`, manual stop) (FR-026, BR-018).
- Persist `SearchRun` + `CandidateStrategy` rows.
- Emit `SearchStarted`, `SearchProgress`, `SearchCompleted`,
  `StrategyGenerated`, `BacktestQueued` events on the EventBus.

## Dependency rules

- Search may depend on strategy + backtest abstractions but only
  through the `EventBus` and injected ports — not on their internal
  implementation.
- Domain layer MUST NOT import Prisma, Express, BullMQ, Socket.IO.

## TODO (added by skeleton setup)

- All generators, the controller, the application service, the
  Prisma repository, and HTTP routes will be added by the search
  owner in later tasks.
