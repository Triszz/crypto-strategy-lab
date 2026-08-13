# sentiment

**Owner:** Nhân
**Layered structure:** `domain` → `application` → `infrastructure` → `presentation`

Structural skeleton for the Sentiment Analysis service.

## Responsibilities (to be implemented later)

- `SentimentAnalyzer` port (FR-056, NFR-005, AC-08).
- Adapters, initially `GeminiAnalyzer`, extensible to OpenAI /
  HuggingFace / local models.
- `SentimentResult` value object with the three-class classification
  (Positive/Neutral/Negative) and a score in [-1, 1] (BR-036, BR-037).
- `SentimentService`: subscribes to `NewsCollected` (or scheduled),
  analyses once per `(news_id, provider_id)` (BR-035), persists,
  publishes `SentimentAnalyzed`.

## Dependency rules

- Domain MUST NOT import any AI SDK or Prisma.
- Application depends on domain ports only.
- Infrastructure implements the port against the chosen AI vendor.

## TODO (added by skeleton setup)

- All concrete adapters, the analyser service and routes will be
  added by the sentiment owner in later tasks.
