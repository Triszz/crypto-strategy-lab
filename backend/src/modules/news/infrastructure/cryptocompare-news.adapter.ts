import { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import { loadEnv } from "../../../config/env";
import { logger } from "../../../shared/logger/logger";

/**
 * Shape returned by https://min-api.cryptocompare.com/data/v2/news/
 */
interface CryptoCompareNewsResponse {
  Type: number;
  Message: string;
  PromotedImage: string;
  FeedQuote: unknown[];
  FeedData: CryptoCompareFeed[];
}

interface CryptoCompareFeed {
  id: string;
  title: string;
  body: string;
  summary?: string;
  url: string;
  source: string;
  imageurl: string;
  published_on: number; // unix timestamp
  categories: string;
  tags: string;
}

const SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL"] as const;
type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

const SYMBOL_CATEGORIES: Record<SupportedSymbol, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
};

export class CryptoCompareNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "CRYPTOCOMPARE";

  private readonly apiKey: string;
  private readonly log = logger.child({ module: "news", adapter: "CryptoCompareNewsAdapter" });

  constructor() {
    const env = loadEnv();
    const raw = env.CRYPTOCOMPARE_API_KEY ?? "";
    if (!raw.trim()) {
      throw new Error(
        "CryptoCompareNewsAdapter: CRYPTOCOMPARE_API_KEY is not set. " +
          "Get a free key at https://min-api.cryptocompare.com/",
      );
    }
    this.apiKey = raw.trim();
  }

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const targets = symbol ? this.resolveTarget(symbol) : [...SUPPORTED_SYMBOLS];

    const settled = await Promise.allSettled(
      targets.map((sym) => this.fetchSymbol(sym)),
    );

    const all: Omit<NewsItem, "providerId">[] = [];
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") all.push(...res.value);
      else {
        this.log.warn(
          { symbol: targets[i], err: (res.reason as Error)?.message },
          `CryptoCompare failed for ${targets[i]}`,
        );
      }
    });

    return all;
  }

  private async fetchSymbol(symbol: SupportedSymbol): Promise<Omit<NewsItem, "providerId">[]> {
    const category = SYMBOL_CATEGORIES[symbol];
    const url = `https://min-api.cryptocompare.com/data/v2/news/?categories=${category}&lang=EN`;

    const res = await fetch(url, {
      headers: {
        authorization: `Apikey ${this.apiKey}`,
        accept: "application/json",
        "user-agent": "crypto-strategy-lab/1.0",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`CryptoCompare API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as CryptoCompareNewsResponse;
    return (json.FeedData ?? []).map((feed) => this.mapFeed(feed, symbol));
  }

  private resolveTarget(raw: string): SupportedSymbol[] {
    const sym = raw.toUpperCase().replace(/USDT?$/, "") as SupportedSymbol;
    return SUPPORTED_SYMBOLS.includes(sym) ? [sym] : [...SUPPORTED_SYMBOLS];
  }

  private mapFeed(
    feed: CryptoCompareFeed,
    requestedSymbol: SupportedSymbol,
  ): Omit<NewsItem, "providerId"> {
    const coinSymbols: string[] = [requestedSymbol];

    // Heuristic: detect coin mentions in title/body
    const text = `${feed.title} ${feed.body}`.toUpperCase();
    for (const sym of SUPPORTED_SYMBOLS) {
      if (sym !== requestedSymbol && text.includes(sym)) {
        coinSymbols.push(sym);
      }
    }

    return {
      externalId: `cryptocompare-${feed.id}`,
      title: feed.title,
      summary: feed.summary ?? feed.body.slice(0, 300),
      content: feed.body,
      url: feed.url,
      source: feed.source,
      author: null,
      publishedAt: new Date(feed.published_on * 1000),
      coinSymbols: [...new Set(coinSymbols)],
    };
  }
}
