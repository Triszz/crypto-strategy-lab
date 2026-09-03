import { NewsProviderAdapter } from "../domain/news.entity";
import { AdapterRegistry } from "./adapter-registry";
import { AggregatingNewsAdapter } from "./aggregating-news.adapter";
import { CryptoCompareNewsAdapter } from "./cryptocompare-news.adapter";
import { CryptopanicNewsAdapter } from "./cryptopanic-news.adapter";
import { NewsDataNewsAdapter } from "./newsdata-news.adapter";
import { CoinDeskRssAdapter } from "./rss-feed.adapters";
import { CointelegraphRssAdapter } from "./rss-feed.adapters";
import { BitcoinMagazineRssAdapter } from "./rss-feed.adapters";
import { RSSNewsAdapter } from "./rss-news.adapter"; // mock fallback
import { logger } from "../../../shared/logger/logger";

// ─── Registry bootstrap ───────────────────────────────────────────────────────
//
// Every concrete adapter self-registers here (priority = order in which they
// are tried; lower = earlier).  The factory reads the comma-separated
// NEWS_PROVIDERS env variable to decide which adapters are enabled.
//
// Adding a new adapter:
//   1. Create the adapter class (implements NewsProviderAdapter).
//   2. Add ONE register() call below with a unique code and priority.
//   3. DONE — the aggregator picks it up automatically.

function bootstrapRegistry(): AdapterRegistry {
  const reg = AdapterRegistry.getInstance();

  // Priority 1 — Paid / structured API sources (run first for best quality)
  reg.register({
    code: "cryptocompare",
    label: "CryptoCompare API",
    priority: 1,
    requiresApiKey: true,
    enabled: false, // enabled only when CRYPTOCOMPARE_API_KEY is set (see below)
    factory: () => {
      const key = process.env.CRYPTOCOMPARE_API_KEY?.trim();
      if (!key) return null;
      try {
        return new CryptoCompareNewsAdapter();
      } catch {
        return null;
      }
    },
  });

  reg.register({
    code: "cryptopanic",
    label: "CryptoPanic API",
    priority: 1,
    requiresApiKey: true,
    enabled: false,
    factory: () => {
      const key = process.env.CRYPTOPANIC_API_KEY?.trim();
      if (!key) return null;
      try {
        return new CryptopanicNewsAdapter({ apiKey: key });
      } catch {
        return null;
      }
    },
  });

  reg.register({
    code: "newsdata",
    label: "NewsData.io",
    priority: 1,
    requiresApiKey: true,
    enabled: false,
    factory: () => {
      const key = process.env.NEWSDATA_API_KEY?.trim();
      if (!key) return null;
      try {
        return new NewsDataNewsAdapter({ apiKey: key });
      } catch {
        return null;
      }
    },
  });

  // Priority 2–4 — RSS feeds (run after API sources)
  reg.register({
    code: "coindesk",
    label: "CoinDesk RSS",
    priority: 2,
    requiresApiKey: false,
    enabled: false, // enabled only when "coindesk" is in NEWS_PROVIDERS env
    factory: () => new CoinDeskRssAdapter(),
  });

  reg.register({
    code: "cointelegraph",
    label: "Cointelegraph RSS",
    priority: 3,
    requiresApiKey: false,
    enabled: false,
    factory: () => new CointelegraphRssAdapter(),
  });

  reg.register({
    code: "btcmagazine",
    label: "Bitcoin Magazine RSS",
    priority: 4,
    requiresApiKey: false,
    enabled: false,
    factory: () => new BitcoinMagazineRssAdapter(),
  });

  // Priority 5 — Legacy / mock (always available as last-resort fallback)
  reg.register({
    code: "rss",
    label: "Mock RSS (dev only)",
    priority: 99,
    requiresApiKey: false,
    enabled: false,
    factory: () => new RSSNewsAdapter(),
  });

  return reg;
}

/**
 * Reads `NEWS_PROVIDERS` env (comma-separated list of adapter codes) and
 * enables those adapters in the registry.
 *
 * Supported values:
 *   "newsdata"                → NewsData.io (https://newsdata.io/) — PRIMARY; free tier: 200 credits/day
 *   "cryptocompare"           → CryptoCompare API (https://min-api.cryptocompare.com/)
 *   "coindesk"                → CoinDesk RSS
 *   "cointelegraph"           → Cointelegraph RSS
 *   "btcmagazine"             → Bitcoin Magazine RSS
 *   "rss"                     → Mock RSS (dev / fallback)
 *
 * If NEWS_PROVIDERS is omitted → ALL adapters that have their API key configured
 * are auto-enabled (newsdata/cryptocompare only when key present; RSS feeds always).
 *
 * @example
 *   NEWS_PROVIDERS=newsdata,coindesk,cointelegraph
 */
function applyEnvOverrides(reg: AdapterRegistry): void {
  const envProviders = (process.env.NEWS_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const knownCodes = new Set(reg.listAll().map((e) => e.code));

  if (envProviders.length === 0) {
    // Auto-enable: all "code ending with nothing" that need a key only when the key is present;
    // RSS feeds have no key → always available.
    for (const entry of reg.listAll()) {
      if (entry.code === "rss") continue; // never auto-enable mock
      if (!entry.requiresApiKey) {
        entry.enabled = true;
        continue;
      }
      // Look up env var: cryptocompare → CRYPTOCOMPARE_API_KEY, newsdata → NEWSDATA_API_KEY, etc.
      const envVar = `${entry.code.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      entry.enabled = !!process.env[envVar]?.trim();
    }
    return;
  }

  // Explicit list: disable everything, then enable the requested ones.
  for (const entry of reg.listAll()) {
    entry.enabled = envProviders.includes(entry.code);
  }

  // Warn about unknown codes in NEWS_PROVIDERS.
  for (const raw of envProviders) {
    if (!knownCodes.has(raw)) {
      logger.warn(
        `[adapter-factory] Unknown NEWS_PROVIDERS code "${raw}". ` +
          `Known: ${knownCodes.size > 0 ? [...knownCodes].join(", ") : "(none)"}.`,
      );
    }
  }
}

/**
 * Builds the `NewsProviderAdapter` used by the News module.
 *
 * Resolution order:
 *  1. Bootstrap the registry with all known adapters.
 *  2. Apply env-based enable/disable overrides (NEWS_PROVIDERS).
 *  3. Return an AggregatingNewsAdapter wrapping all currently-enabled adapters.
 *  4. If no adapters are enabled → fall back to mock RSS so the app still starts.
 *
 * Why AggregatingNewsAdapter as the top-level adapter?
 *   - All downstream code (NewsService, routes, etc.) receives ONE adapter
 *     via dependency injection — they never know how many sources exist.
 *   - New adapters are added by registering them in `bootstrapRegistry()`;
 *     no changes needed outside this file.
 *   - A broken adapter never crashes the aggregator (Promise.allSettled).
 */
export function buildNewsAdapter(): NewsProviderAdapter {
  const reg = bootstrapRegistry();
  applyEnvOverrides(reg);

  const adapters = reg.instantiateAll((msg) => logger.warn(msg));

  if (adapters.length === 0) {
    logger.warn(
      "[adapter-factory] No news adapters are enabled. " +
        "Set NEWS_PROVIDERS=newsdata,coindesk in .env, " +
        "and ensure NEWSDATA_API_KEY is set at https://newsdata.io. Using mock RSS fallback.",
    );
    return new RSSNewsAdapter();
  }

  logger.info(
    {
      event: "news.adapter_factory.ready",
      enabled: reg.listEnabledCodes(),
    },
    `News adapter factory ready. Enabled sources: ${reg.listEnabledCodes().join(", ")}`,
  );

  return AggregatingNewsAdapter.fromRegistry(reg, logger);
}

/**
 * Re-expose the registry for admin / health-check endpoints.
 * E.g. GET /admin/news/providers → registry.listAll()
 */
export { AdapterRegistry };

