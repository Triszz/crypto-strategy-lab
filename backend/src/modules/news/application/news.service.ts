import { logger as defaultLogger, Logger } from "../../../shared/logger/logger";
import {
  NewsFilterOptions,
  NewsItem,
  NewsProviderAdapter,
  NewsRepository,
} from "../domain/news.entity";

export class NewsService {
  constructor(
    private readonly repository: NewsRepository,
    private readonly adapter: NewsProviderAdapter,
    private readonly log: Logger = defaultLogger,
  ) {}

  public async fetchAndStoreLatestNews(symbol?: string): Promise<NewsItem[]> {
    const normalizedSymbol = symbol?.toUpperCase();
    const childLog = this.log.child({ module: "news", provider: this.adapter.providerCode, symbol: normalizedSymbol });

    childLog.info({ event: "news.service.crawl.start" }, "Starting news crawl");

    const provider = await this.repository.findOrCreateProvider(
      this.adapter.providerCode,
      "Crypto News RSS Provider",
      "https://cryptonews.example.com",
    );

    childLog.debug({ event: "news.service.crawl.provider", providerId: provider.id }, "Provider resolved");

    const fetchedItems = await this.adapter.fetchLatestNews(normalizedSymbol);
    childLog.info(
      { event: "news.service.crawl.fetched", count: fetchedItems.length },
      `Fetched ${fetchedItems.length} items from adapter`,
    );

    // Phase C.5: save news AND enqueue outbox events in one atomic transaction.
    // The outbox rows are written to QueueJob in the same DB transaction as
    // the news inserts, so a rollback rolls back both — no orphan events.
    const savedItems = await this.repository.saveNewsBatchAndEnqueueOutbox(
      provider.id,
      fetchedItems,
      (savedNews) =>
        savedNews.map((item) => ({
          eventName: "NewsCollected",
          payload: {
            newsId: item.id,
            title: item.title,
            summary: item.summary,
            content: item.content,
            source: item.source,
            url: item.url,
            publishedAt: item.publishedAt,
            coinSymbols: item.coinSymbols ?? [],
          },
        })),
    );
    childLog.info(
      { event: "news.service.crawl.saved", inserted: savedItems.length },
      `Saved ${savedItems.length} items via repository (with outbox rows)`,
    );

    return savedItems;
  }

  public async getNewsList(options: NewsFilterOptions): Promise<{ items: NewsItem[]; total: number }> {
    this.log.debug(
      { event: "news.service.list.request", options },
      "Listing news with filters",
    );
    const result = await this.repository.getNews(options);
    this.log.debug(
      { event: "news.service.list.response", count: result.items.length, total: result.total },
      "Listed news items",
    );
    return result;
  }

  public async getNewsDetail(id: string): Promise<NewsItem | null> {
    this.log.debug({ event: "news.service.detail.request", id }, "Fetching news detail");
    const item = await this.repository.getNewsById(id);
    this.log.debug(
      { event: "news.service.detail.response", id, found: item !== null },
      "News detail fetched",
    );
    return item;
  }
}