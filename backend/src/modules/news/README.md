# news

**Owner:** Nhân
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the News Collector.

## Responsibilities (to be implemented later)

- `NewsProvider` port (interface) — NFR-004.
- Adapters (initially `CryptoPanicAdapter`), extensible to RSS,
  CoinDesk, etc.
- `NewsNormalizer`: provider DTO -> internal `NewsItem`.
- `NewsCollectorService`: scheduled crawl, dedupe by
  `(provider_id, external_id)`, persist, publish `NewsCollected`.
- HTTP routes for news display.

## Dependency rules

- `domain/` MUST NOT import any news provider SDK (NFR-055).
- `infrastructure/` implements the port.
- `application/` depends on the port and on the EventBus.

## TODO (added by skeleton setup)

- All concrete adapters, the collector, repositories and routes will
  be added by the news owner in later tasks. This scaffold only
  declares the directory layout and rule set.
