import { NewsProviderAdapter } from "../domain/news.entity";
import { AdapterRegistry } from "./adapter-registry";
import { AggregatingNewsAdapter } from "./aggregating-news.adapter";
import { CryptoCompareNewsAdapter } from "./cryptocompare-news.adapter";
import { CryptopanicNewsAdapter } from "./cryptopanic-news.adapter";
import { NewsDataNewsAdapter } from "./newsdata-news.adapter";
import { HtmlNewsAdapter } from "./html-news.adapter";
import { CoinDeskRssAdapter } from "./rss-feed.adapters";
import { CointelegraphRssAdapter } from "./rss-feed.adapters";
import { BitcoinMagazineRssAdapter } from "./rss-feed.adapters";
import { RSSNewsAdapter } from "./rss-news.adapter"; // mock fallback
import { logger } from "../../../shared/logger/logger";
import { loadEnv } from "../../../config/env";

// ─── Registry bootstrap ───────────────────────────────────────────────────────
function bootstrapRegistry(): AdapterRegistry {
  const reg = AdapterRegistry.getInstance();

  // Priority 1 — Paid / structured API sources (run first for best quality)
  reg.register({
    code: "cryptocompare",
    label: "CryptoCompare API",
    priority: 1,
    requiresApiKey: true,
    enabled: false,
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
    enabled: false,
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

  // Priority 5 — HTML Web Scraper (LLM Extraction Template)
  reg.register({
    code: "html",
    label: "HTML Web Scraper (LLM Template)",
    priority: 5,
    requiresApiKey: false,
    enabled: false,
    factory: () => new HtmlNewsAdapter(),
  });

  // Priority 99 — Legacy / mock (fallback)
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

function applyEnvOverrides(reg: AdapterRegistry): void {
  // Ensure dotenv is loaded so process.env contains variables from backend/.env
  try {
    loadEnv();
  } catch {
    // ignore if already loaded or env file missing
  }

  const rawEnv = (process.env.NEWS_PROVIDERS ?? "").trim();
  const envProviders = rawEnv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const knownCodes = new Set(reg.listAll().map((e) => e.code));
  const isAll = envProviders.includes("all") || envProviders.includes("auto") || envProviders.length === 0;

  if (isAll) {
    // Auto-enable logic:
    // - Enable RSS feeds and HTML scraper (no API key needed)
    // - Enable API adapters if their corresponding env API key is set
    for (const entry of reg.listAll()) {
      if (entry.code === "rss") continue; // Never auto-enable mock RSS unless explicitly requested
      if (!entry.requiresApiKey) {
        entry.enabled = true;
        continue;
      }
      const envVar = `${entry.code.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      entry.enabled = !!process.env[envVar]?.trim();
    }
    return;
  }

  // Explicit list provided in NEWS_PROVIDERS (e.g. NEWS_PROVIDERS=newsdata,coindesk,html)
  for (const entry of reg.listAll()) {
    entry.enabled = envProviders.includes(entry.code);
  }

  // Warn if user set an API key in .env but forgot to include the code in NEWS_PROVIDERS
  for (const entry of reg.listAll()) {
    if (entry.requiresApiKey && !entry.enabled) {
      const envVar = `${entry.code.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      if (process.env[envVar]?.trim()) {
        logger.warn(
          `[adapter-factory] Environment variable ${envVar} is set, but "${entry.code}" ` +
            `is not listed in NEWS_PROVIDERS="${rawEnv}". Add "${entry.code}" or "all" to NEWS_PROVIDERS to enable it.`,
        );
      }
    }
  }

  for (const raw of envProviders) {
    if (raw !== "all" && raw !== "auto" && !knownCodes.has(raw)) {
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

