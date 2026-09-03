import { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import { ExternalServiceError } from "../../../shared/errors";
import { logger } from "../../../shared/logger/logger";
import pRetry from "p-retry";
import type { RetryContext } from "p-retry";
import { CircuitBreaker } from "./circuit-breaker";

/**
 * Shape returned by https://cryptopanic.com/api/v1/posts/
 */
interface CryptoPanicResult {
  count: number;
  next: string | null;
  previous: string | null;
  results: CryptoPanicPost[];
}

interface CryptoPanicPost {
  id: number;
  title: string;
  url: string;
  source: { name: string };
  published_at: string;
  metadata?: {
    title?: string; // brief excerpt / summary
    currencies?: { code: string; title: string; slug: string }[];
  };
}

/**
 * Normalises the raw currency code from CryptoPanic's metadata into
 * a base-asset form (e.g. "BTCUSD" → "BTC").
 *
 * The API returns codes like "BTCUSD", "ETHUSD", etc. We strip the
 * quote suffix so that lookups in our `Symbol.baseAsset` column match.
 */
function toBaseAsset(code: string): string {
  return code.toUpperCase().replace(/(USDT|USDC|USD|BUSD|BTC|ETH)$/i, "").toUpperCase() || code.toUpperCase();
}

/**
 * Normalises a timestamp string that CryptoPanic returns in ISO-8601
 * format with timezone offset. Returns a UTC `Date`.
 */
function parsePublishedAt(raw: string): Date {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

export interface CryptopanicAdapterOptions {
  /** CryptoPanic API key. Required. */
  apiKey: string;
  /** Maximum retry attempts on failure. Default: 3. */
  maxRetries?: number;
  /** Circuit breaker failure threshold. Default: 3. */
  failureThreshold?: number;
  /** Circuit breaker reset timeout in ms. Default: 60 000. */
  circuitResetTimeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;

/**
 * Fetches crypto news from CryptoPanic's public posts API.
 *
 * Why CryptoPanic over direct RSS scraping?
 *   - Structured JSON response (no HTML parsing needed).
 *   - Currency tagging built-in (each post carries `metadata.currencies`).
 *   - Free tier: 200 req/hour — sufficient for MVP demo.
 *   - Structured data enables precise symbol attribution without NLP.
 *
 * Resilience:
 *   - p-retry: 3 attempts with exponential backoff (1 s, 2 s, 4 s).
 *   - Circuit breaker: 3 consecutive failures → open 60 s → half-open probe.
 *
 * Filter: by default fetches news tagged with any of BTC, ETH, SOL.
 * Pass `symbol` to scope further (e.g. "BTC" → `currencies=BTC`).
 *
 * @example
 *   const adapter = new CryptopanicNewsAdapter({ apiKey: "..." });
 *   const items = await adapter.fetchLatestNews("BTC");
 */
export class CryptopanicNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "CRYPTOPANIC";

  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly circuitBreaker: CircuitBreaker;

  private readonly log = logger.child({ module: "news", adapter: "CryptopanicNewsAdapter" });

  constructor(options: CryptopanicAdapterOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("CryptopanicNewsAdapter requires a non-empty apiKey");
    }
    this.apiKey = options.apiKey.trim();
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.circuitBreaker = new CircuitBreaker("cryptopanic", {
      failureThreshold: options.failureThreshold ?? 3,
      resetTimeoutMs: options.circuitResetTimeoutMs ?? 60_000,
      logger: this.log,
    });
  }

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    return this.circuitBreaker.execute(() =>
      pRetry(
        () => this._fetchOnce(symbol),
        {
          retries: this.maxRetries,
          onFailedAttempt: (attempt: RetryContext) => {
            this.log.warn(
              {
                event: "cryptopanic.retry",
                attemptNumber: attempt.attemptNumber,
                maxRetries: this.maxRetries,
                err: attempt.error?.message,
                retriesLeft: attempt.retriesLeft,
              },
              `Cryptopanic fetch attempt ${attempt.attemptNumber} failed; retrying…`,
            );
          },
        },
      ),
    );
  }

  private async _fetchOnce(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const params = new URLSearchParams({
      auth_token: this.apiKey,
      // "true" = public posts only (no OAuth required)
      public: "true",
      filter: "news",
      // Prefer English to avoid mixed-language noise in MVP
      lang: "en",
    });

    // If a symbol is provided, restrict to that currency.
    if (symbol) {
      // CryptoPanic uses base-asset codes without quote (e.g. "BTC", not "BTCUSD")
      params.set("currencies", symbol.toUpperCase());
    }

    const url = `https://cryptopanic.com/api/v1/posts/?${params.toString()}`;

    this.log.debug(
      { event: "cryptopanic.request", url, symbol: symbol ?? "all" },
      "Fetching news from CryptoPanic",
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15 s global timeout

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "crypto-strategy-lab/1.0 (educational project)",
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      // AbortError means the request timed out or was cancelled
      if (err instanceof Error && err.name === "AbortError") {
        throw new ExternalServiceError("Cryptopanic request timed out after 15s", 504, err);
      }
      throw new ExternalServiceError(`Cryptopanic fetch error: ${(err as Error).message}`, 502, err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "(could not read response body)");
      throw new ExternalServiceError(
        `Cryptopanic API error: ${response.status} ${response.statusText} — ${body}`,
        response.status >= 500 ? 502 : response.status >= 400 ? 400 : 502,
      );
    }

    let data: CryptoPanicResult;
    try {
      data = (await response.json()) as CryptoPanicResult;
    } catch (err) {
      throw new ExternalServiceError("Cryptopanic returned non-JSON response", 502, err);
    }

    this.log.info(
      {
        event: "cryptopanic.fetched",
        total: data.count,
        returned: data.results.length,
        symbol: symbol ?? "all",
      },
      `Fetched ${data.results.length} news items from CryptoPanic`,
    );

    return data.results.map((post) => this.mapPost(post, symbol));
  }

  /**
   * Maps a CryptoPanic post to our domain `NewsItem` shape.
   *
   * coinSymbols: we derive base assets from `metadata.currencies`.
   * When no metadata is present we fall back to an empty array and
   * rely on downstream NLP (Sentiment) to link to coins via title
   * keyword matching.
   */
  private mapPost(post: CryptoPanicPost, requestedSymbol?: string): Omit<NewsItem, "providerId"> {
    // Extract currency codes from metadata.
    const currencies = post.metadata?.currencies ?? [];
    const coinSymbols = currencies.map((c) => toBaseAsset(c.code));

    // If a symbol was explicitly requested but not tagged, tag it anyway.
    // This handles cases where CryptoPanic's metadata is stale.
    if (requestedSymbol && !coinSymbols.includes(requestedSymbol.toUpperCase())) {
      coinSymbols.push(requestedSymbol.toUpperCase());
    }

    return {
      externalId: `cryptopanic-${post.id}`,
      title: post.title,
      summary: post.metadata?.title ?? null,
      content: null, // CryptoPanic free tier does not include full body
      url: post.url,
      source: post.source?.name ?? "CryptoPanic",
      author: null,
      publishedAt: parsePublishedAt(post.published_at),
      coinSymbols,
    };
  }

  /**
   * Exposes circuit-breaker state for health-check endpoints.
   */
  public getCircuitState(): string {
    return this.circuitBreaker.getState();
  }
}
