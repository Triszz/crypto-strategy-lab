export interface NewsItem {
  id?: string;
  providerId: string;
  externalId: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  url: string;
  source: string;
  author?: string | null;
  publishedAt: Date;
  crawledAt?: Date;
  coinSymbols?: string[];
}

export interface NewsProviderEntity {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  requiresApiKey: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface NewsProviderAdapter {
  providerCode: string;
  fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]>;
}

export interface NewsFilterOptions {
  symbol?: string;
  page?: number;
  pageSize?: number;
}

export interface NewsRepository {
  saveNewsBatch(providerId: string, newsItems: Omit<NewsItem, "providerId">[]): Promise<NewsItem[]>;
  saveNewsBatchAndEnqueueOutbox(
    providerId: string,
    newsItems: Omit<NewsItem, "providerId">[],
    outboxPayloadFn: (savedNews: NewsItem[]) => OutboxEventPayload[],
  ): Promise<NewsItem[]>;
  getNews(options: NewsFilterOptions): Promise<{ items: NewsItem[]; total: number }>;
  getNewsById(id: string): Promise<NewsItem | null>;
  findOrCreateProvider(code: string, name: string, baseUrl: string): Promise<NewsProviderEntity>;
}

/** Payload written to QueueJob for each outbox event. */
export interface OutboxEventPayload {
  eventName: string;
  payload: Record<string, unknown>;
}
