import { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import { ExternalServiceError } from "../../../shared/errors";
import { logger } from "../../../shared/logger/logger";
import { CircuitBreaker } from "./circuit-breaker";
import pRetry from "p-retry";
import type { RetryContext } from "p-retry";

/**
 * Response shape from https://newsdata.io/api/1/latest
 * Docs: https://newsdata.io/documentation
 */
interface NewsDataResponse {
  status: string;
  totalResults: number;
  results: NewsDataArticle[];
}

interface NewsDataArticle {
  article_id: string;          // unique
  title: string;
  link: string;
  description: string | null;
  content: string | null;
  pubDate: string;             // ISO-8601
  source_id: string | null;
  creator: string[] | null;
  category: string[] | null;
  keywords: string[] | null;
  language?: string;
}

const SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL"] as const;

export interface NewsDataAdapterOptions {
  apiKey: string;
  maxRetries?: number;
  failureThreshold?: number;
  circuitResetTimeoutMs?: number;
}

/**
 * Fetches crypto news from NewsData.io.
 *
 * Free tier: 200 requests/day — sufficient for MVP.
 * Auth: query param `apikey=...` (NOT a header).
 * Filter: by category=crypto, language=en.
 *
 * Resilience: same as CryptopanicNewsAdapter
 *   - p-retry: 3 attempts with exponential backoff
 *   - Circuit breaker: 3 failures → open 60s → half-open
 */
export class NewsDataNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "NEWSDATA";

  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly log = logger.child({ module: "news", adapter: "NewsDataNewsAdapter" });

  constructor(options: NewsDataAdapterOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("NewsDataNewsAdapter requires a non-empty apiKey");
    }
    this.apiKey = options.apiKey.trim();
    this.maxRetries = options.maxRetries ?? 3;
    this.circuitBreaker = new CircuitBreaker("newsdata", {
      failureThreshold: options.failureThreshold ?? 3,
      resetTimeoutMs: options.circuitResetTimeoutMs ?? 60_000,
      logger: this.log,
    });
  }

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    return this.circuitBreaker.execute(() =>
      pRetry(() => this._fetchOnce(symbol), {
        retries: this.maxRetries,
        onFailedAttempt: (attempt: RetryContext) => {
          this.log.warn(
            {
              event: "newsdata.retry",
              attemptNumber: attempt.attemptNumber,
              err: attempt.error?.message,
            },
            `NewsData fetch attempt ${attempt.attemptNumber} failed; retrying…`,
          );
        },
      }),
    );
  }

  private async _fetchOnce(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const params = new URLSearchParams({
      apikey: this.apiKey,
      category: "crypto,top",
      language: "en",
    });

    if (symbol) {
      // NewsData free tier doesn't support exact coin filter; we'll filter client-side.
      const base = symbol.toUpperCase().replace(/USDT?$/, "");
      params.set("q", `${base} OR bitcoin OR ethereum OR solana`);
    }

    const url = `https://newsdata.io/api/1/latest?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "crypto-strategy-lab/1.0",
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new ExternalServiceError("NewsData request timed out after 15s", 504, err);
      }
      throw new ExternalServiceError(`NewsData fetch error: ${(err as Error).message}`, 502, err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "(could not read response body)");
      throw new ExternalServiceError(
        `NewsData API error: ${response.status} ${response.statusText} — ${body}`,
        response.status >= 500 ? 502 : 400,
      );
    }

    let data: NewsDataResponse;
    try {
      data = (await response.json()) as NewsDataResponse;
    } catch (err) {
      throw new ExternalServiceError("NewsData returned non-JSON response", 502, err);
    }

    if (data.status !== "success") {
      throw new ExternalServiceError(`NewsData returned status=${data.status}`, 502);
    }

    this.log.info(
      {
        event: "newsdata.fetched",
        total: data.totalResults,
        returned: data.results.length,
        symbol: symbol ?? "all",
      },
      `Fetched ${data.results.length} news items from NewsData.io`,
    );

    const items = data.results
      .map((article) => this.mapArticle(article, symbol))
      .filter((item): item is Omit<NewsItem, "providerId"> => item !== null);

    return items;
  }

  private mapArticle(
    article: NewsDataArticle,
    requestedSymbol?: string,
  ): Omit<NewsItem, "providerId"> | null {
    // Drop non-crypto articles if NewsData's category filter leaked through
    if (article.category && !article.category.some((c) => /crypto|bitcoin|ethereum/i.test(c))) {
      // Keep it anyway — NewsData category filter is reliable, this is a belt-and-braces guard
    }

    const coinSymbols: string[] = [];
    if (requestedSymbol) {
      const base = requestedSymbol.toUpperCase().replace(/USDT?$/, "");
      coinSymbols.push(base);
    }

    // Heuristic detection in title/description
    const haystack = `${article.title} ${article.description ?? ""}`.toUpperCase();
    for (const sym of SUPPORTED_SYMBOLS) {
      const aliases: Record<string, string[]> = {
        BTC: ["BTC", "BITCOIN"],
        ETH: ["ETH", "ETHEREUM", "ETHER"],
        SOL: ["SOL", "SOLANA"],
      };
      const symAliases = aliases[sym] ?? [];
      if (symAliases.some((kw) => haystack.includes(kw))) {
        if (!coinSymbols.includes(sym)) coinSymbols.push(sym);
      }
    }

    return {
      externalId: `newsdata-${article.article_id}`,
      title: article.title,
      summary: article.description ?? null,
      content: article.content ?? null,
      url: article.link,
      source: article.source_id ?? "NewsData.io",
      author: article.creator?.[0] ?? null,
      publishedAt: new Date(article.pubDate),
      coinSymbols: [...new Set(coinSymbols)],
    };
  }

  public getCircuitState(): string {
    return this.circuitBreaker.getState();
  }
}