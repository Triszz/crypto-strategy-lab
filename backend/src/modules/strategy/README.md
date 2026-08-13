# strategy

**Owner:** Trí
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

This folder is the structural skeleton for the Strategy Engine plus
the Combination Engine (both owned by Trí).

## Responsibilities (to be implemented later)

- Define the `Strategy` interface (BR-008, BR-009, BR-010).
- Implement the four MVP strategies (MA, RSI, Bollinger, SR).
- `CombinationEngine` for weighted voting across base strategies.
- Persist strategies + versions through the `StrategyRepository`.
- Publish events on the shared EventBus.

## Dependency rules

- `domain/` may NOT import Prisma, Express, Redis, BullMQ, Binance,
  Socket.IO.
- `application/` depends on `domain/`.
- `infrastructure/` implements domain ports (Prisma repositories,
  Redis cache, etc.).
- `presentation/` exposes Express controllers (e.g. `POST /strategies`).

## TODO (added by skeleton setup)

- All concrete strategies, the registry, the combiner, repositories,
  controllers and DTOs are owned by the strategy sub-team.
