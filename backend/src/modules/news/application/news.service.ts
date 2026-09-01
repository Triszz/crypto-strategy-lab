import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { NewsFilterOptions, NewsItem, NewsProviderAdapter, NewsRepository } from "../domain/news.entity";

export class NewsService {
  constructor(
    private readonly repository: NewsRepository,
    private readonly adapter: NewsProviderAdapter,
    private readonly eventBus: EventBus = getEventBus()
  ) {}

  public async fetchAndStoreLatestNews(symbol?: string): Promise<NewsItem[]> {
    const provider = await this.repository.findOrCreateProvider(
      this.adapter.providerCode,
      "Crypto News RSS Provider",
      "https://cryptonews.example.com"
    );

    const fetchedItems = await this.adapter.fetchLatestNews(symbol);
    const savedItems = await this.repository.saveNewsBatch(provider.id, fetchedItems);

    for (const item of savedItems) {
      this.eventBus.publish("NewsCollected", {
        newsId: item.id,
        title: item.title,
        summary: item.summary,
        content: item.content,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        coinSymbols: item.coinSymbols || [],
      });
    }

    return savedItems;
  }

  public async getNewsList(options: NewsFilterOptions): Promise<{ items: NewsItem[]; total: number }> {
    return this.repository.getNews(options);
  }

  public async getNewsDetail(id: string): Promise<NewsItem | null> {
    return this.repository.getNewsById(id);
  }
}
