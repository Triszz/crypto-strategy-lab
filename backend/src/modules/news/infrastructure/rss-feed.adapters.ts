import { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import { logger } from "../../../shared/logger/logger";
import { loadEnv } from "../../../config/env";

/** Minimal RSS item shape from a parsed XML rss > channel > item[]. */
interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  author?: string;
  "content:encoded"?: string;
}

/**
 * Base class for RSS-backed adapters.
 *
 * Subclass this for each RSS feed. Implement `getRssUrl()` and optionally
 * `getLabel()` — everything else (fetch, parse, filter, map) is shared.
 *
 * Why a class rather than a function?
 *   - Subclasses can override `filterItem()` for feed-specific logic
 *     (e.g. strip sponsor posts).
 *   - Circuit-breaker / retry lives in a decorator on the caller side
 *     (AggregatingNewsAdapter uses Promise.allSettled, so one bad feed
 *     never kills the others).
 */
export abstract class RssNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode: string;

  protected readonly log = logger.child({
    module: "news",
    adapter: this.constructor.name,
  });

  protected readonly env = loadEnv();

  constructor(providerCode: string) {
    this.providerCode = providerCode;
  }

  /** Override to return the RSS feed URL. */
  protected abstract getRssUrl(): string;

  /** Override to return a human-readable name for logs. */
  protected getLabel(): string {
    return this.providerCode;
  }

  /** Override to filter items before mapping. Return false to skip. */
  protected filterItem(_item: RssItem, _symbol?: string): boolean {
    return true;
  }

  /**
   * Optional: map a symbol (e.g. "BTC") to a case-insensitive keyword
   * that should appear in the title or description. Defaults to the
   * symbol itself (e.g. "BTC"). Override to add aliases.
   */
  protected symbolKeywords(symbol: string): string[] {
    const base = symbol.toUpperCase().replace(/USDT?$/, "");
    const aliases: Record<string, string[]> = {
      BTC: ["bitcoin", "btc", "₿"],
      ETH: ["ethereum", "eth", "ether"],
      SOL: ["solana", "sol"],
    };
    return [base, ...(aliases[base] ?? [])];
  }

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const url = this.getRssUrl();
    this.log.debug({ event: "rss.fetch", url }, `Fetching RSS from ${this.getLabel()}`);

    let xml: string;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "crypto-strategy-lab/1.0 (+https://github.com/...)",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      this.log.warn(
        { event: "rss.fetch_failed", url, err: (err as Error).message },
        `Failed to fetch RSS from ${this.getLabel()}`,
      );
      return [];
    }

    let items: RssItem[];
    try {
      items = this.parseItems(xml);
    } catch (err) {
      this.log.warn(
        { event: "rss.parse_failed", err: (err as Error).message },
        `Failed to parse RSS XML from ${this.getLabel()}`,
      );
      return [];
    }

    const filtered = items.filter((item) => this.filterItem(item, symbol));
    const mapped = filtered.map((item) => this.mapItem(item, symbol));

    this.log.info(
      { event: "rss.fetched", label: this.getLabel(), total: mapped.length },
      `Fetched ${mapped.length} items from ${this.getLabel()}`,
    );

    return mapped;
  }

  protected parseItems(xml: string): RssItem[] {
    // Lightweight regex-based parser — avoids adding a dependency for MVP.
    // For production consider `fast-xml-parser`.
    const channelMatch = xml.match(/<channel>([\s\S]*?)<\/channel>/i);
    if (!channelMatch || !channelMatch[1]) return [];

    const itemMatches = channelMatch[1].matchAll(/<item>([\s\S]*?)<\/item>/gi);
    const items: RssItem[] = [];

    for (const itemMatch of itemMatches) {
      const inner = itemMatch[1];
      if (inner) items.push(this.parseItem(inner));
    }

    return items;
  }

  protected parseItem(xml: string): RssItem {
    const extract = (tag: string): string | undefined => {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
      const m = re.exec(xml);
      re.lastIndex = 0;
      return m ? (m[1] ?? m[2] ?? "").trim() : undefined;
    };

    return {
      title: extract("title"),
      link: extract("link"),
      description: extract("description"),
      pubDate: extract("pubDate"),
      author: extract("author") ?? extract("dc:creator"),
      "content:encoded": extract("content:encoded"),
    };
  }

  protected mapItem(item: RssItem, symbol?: string): Omit<NewsItem, "providerId"> {
    const coinSymbols: string[] = [];

    if (symbol) {
      const keywords = this.symbolKeywords(symbol);
      const haystack = `${item.title ?? ""} ${item.description ?? ""}`.toLowerCase();
      if (keywords.some((k) => haystack.includes(k.toLowerCase()))) {
        coinSymbols.push(symbol.toUpperCase().replace(/USDT?$/, ""));
      }
    }

    return {
      externalId: `${this.providerCode}-${hashString(item.link ?? item.title ?? String(Date.now()))}`,
      title: item.title ?? "(no title)",
      summary: stripHtml(item.description ?? item["content:encoded"] ?? null),
      content: stripHtml(item["content:encoded"] ?? item.description ?? null),
      url: item.link ?? "",
      source: this.getLabel(),
      author: item.author ?? null,
      publishedAt: parseRssDate(item.pubDate),
      coinSymbols: [...new Set(coinSymbols)],
    };
  }
}

// ─── Concrete implementations ─────────────────────────────────────────────────

export class CoinDeskRssAdapter extends RssNewsAdapter {
  public override readonly providerCode = "COINDESK";

  constructor() {
    super("COINDESK");
  }

  protected override getRssUrl(): string {
    return "https://www.coindesk.com/arc/outboundfeeds/rss/";
  }

  protected override getLabel(): string {
    return "CoinDesk";
  }
}

export class CointelegraphRssAdapter extends RssNewsAdapter {
  public override readonly providerCode = "COINTELEGRAPH";

  constructor() {
    super("COINTELEGRAPH");
  }

  protected override getRssUrl(): string {
    return "https://cointelegraph.com/rss";
  }

  protected override getLabel(): string {
    return "Cointelegraph";
  }
}

export class BitcoinMagazineRssAdapter extends RssNewsAdapter {
  public override readonly providerCode = "BTCMAG";

  constructor() {
    super("BTCMAG");
  }

  protected override getRssUrl(): string {
    return "https://bitcoinmagazine.com/.rss/full/";
  }

  protected override getLabel(): string {
    return "Bitcoin Magazine";
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function parseRssDate(raw?: string): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

function hashString(s: string | undefined): string {
  const fallback = s ?? String(Date.now());
  let h = 0;
  for (let i = 0; i < fallback.length; i++) {
    h = (Math.imul(31, h) + fallback.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
