import type { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import type { Logger } from "../../../shared/logger/logger";
import { logger as defaultLogger } from "../../../shared/logger/logger";
import { AdapterRegistry } from "./adapter-registry";

/**
 * Composite adapter that fans out `fetchLatestNews()` to every enabled
 * adapter known to the registry, then merges and deduplicates the results.
 *
 * Properties:
 *   - Fails-soft: a single broken adapter does not break the others
 *     (uses `Promise.allSettled`).
 *   - Per-source tagging: each item is annotated with the originating
 *     `providerCode` so the DB can attribute rows to the right source.
 *   - Dedup by URL first, then by normalised title hash, so the same
 *     story from two aggregators only lands once.
 *   - Sorted by `publishedAt` descending (newest first).
 *
 * NOTE: this adapter is *constructed at startup* with a snapshot of enabled
 * adapters. To pick up registry changes at runtime, call
 * `setEnabled()` followed by `aggregator.refresh()` (or rebuild the container).
 */
export class AggregatingNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "AGGREGATOR";

  private adapters: NewsProviderAdapter[];
  private readonly log: Logger;

  constructor(adapters: NewsProviderAdapter[], log: Logger = defaultLogger) {
    this.adapters = adapters;
    this.log = log.child({ module: "news", adapter: "AggregatingNewsAdapter" });
  }

  /**
   * Replaces the list of inner adapters. Use after toggling
   * `AdapterRegistry.setEnabled(...)`.
   */
  public refresh(adapters: NewsProviderAdapter[]): void {
    this.adapters = adapters;
    this.log.info(
      { event: "news.aggregator.refresh", count: adapters.length },
      `Aggregator refreshed with ${adapters.length} adapters`,
    );
  }

  /**
   * Builds the aggregator from whatever is currently enabled in the registry.
   * Convenience for container startup.
   */
  public static fromRegistry(
    registry: AdapterRegistry = AdapterRegistry.getInstance(),
    log: Logger = defaultLogger,
  ): AggregatingNewsAdapter {
    const adapters = registry.instantiateAll((msg) => log.warn(msg));
    log.info(
      {
        event: "news.aggregator.bootstrap",
        codes: adapters.map((a) => a.providerCode),
      },
      `Aggregator bootstrapped with adapters: ${adapters.map((a) => a.providerCode).join(", ") || "(none)"}`,
    );
    return new AggregatingNewsAdapter(adapters, log);
  }

  /**
   * Fetches from every enabled adapter in parallel, merges, dedupes,
   * and returns a single flat list sorted by recency.
   */
  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    if (this.adapters.length === 0) {
      this.log.warn(
        { event: "news.aggregator.empty" },
        "Aggregator has no adapters; returning empty list",
      );
      return [];
    }

    const settled = await Promise.allSettled(
      this.adapters.map((a) => a.fetchLatestNews(symbol)),
    );

    const collected: { item: Omit<NewsItem, "providerId">; source: string }[] = [];
    settled.forEach((res, idx) => {
      const adapter = this.adapters[idx];
      if (!adapter) return; // Defensive: skip if index is out of bounds
      if (res.status === "fulfilled") {
        for (const item of res.value) {
          collected.push({ item, source: adapter.providerCode });
        }
      } else {
        this.log.warn(
          {
            event: "news.aggregator.source_failed",
            code: adapter.providerCode,
            err: (res.reason as Error)?.message ?? String(res.reason),
          },
          `Source ${adapter.providerCode} failed; continuing with others`,
        );
      }
    });

    if (collected.length === 0) return [];

    const deduped = dedupeNews(collected);
    this.log.info(
      {
        event: "news.aggregator.merged",
        raw: collected.length,
        deduped: deduped.length,
        sources: Array.from(new Set(collected.map((c) => c.source))),
      },
      `Merged ${collected.length} → ${deduped.length} unique items`,
    );

    // Newest first.
    deduped.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    return deduped;
  }
}

/**
 * Deduplication strategy:
 *   1. Primary key: `url` (exact match, case-insensitive host).
 *   2. Fallback: normalised title hash (lowercase, strip punctuation, drop
 *      common stop-words and trailing source suffixes like "- coindesk.com").
 *
 * The deduped items preserve the first-seen source (priority order).
 */
export function dedupeNews(
  items: { item: Omit<NewsItem, "providerId">; source: string }[],
): Omit<NewsItem, "providerId">[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const result: Omit<NewsItem, "providerId">[] = [];

  for (const { item } of items) {
    const urlKey = normaliseUrl(item.url);
    if (urlKey && seenUrl.has(urlKey)) continue;

    const titleKey = normaliseTitle(item.title);
    if (seenTitle.has(titleKey)) continue;

    if (urlKey) seenUrl.add(urlKey);
    seenTitle.add(titleKey);
    result.push(item);
  }

  return result;
}

function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "for", "to",
  "with", "is", "are", "was", "were", "be", "by",
]);

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\p{P}$+<=>`~]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .slice(0, 200); // cap for hash stability
}
