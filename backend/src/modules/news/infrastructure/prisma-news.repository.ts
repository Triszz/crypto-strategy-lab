import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { NewsFilterOptions, NewsItem, NewsProviderEntity, NewsRepository } from "../domain/news.entity";

export class PrismaNewsRepository implements NewsRepository {
  private prisma = getPrismaClient();

  public async findOrCreateProvider(code: string, name: string, baseUrl: string): Promise<NewsProviderEntity> {
    const existing = await this.prisma.newsProvider.findUnique({
      where: { code },
    });

    if (existing) {
      return {
        id: existing.id,
        code: existing.code,
        name: existing.name,
        baseUrl: existing.baseUrl,
        requiresApiKey: existing.requiresApiKey,
        isActive: existing.isActive,
        createdAt: existing.createdAt,
      };
    }

    const created = await this.prisma.newsProvider.create({
      data: {
        code,
        name,
        baseUrl,
        requiresApiKey: false,
        isActive: true,
      },
    });

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      baseUrl: created.baseUrl,
      requiresApiKey: created.requiresApiKey,
      isActive: created.isActive,
      createdAt: created.createdAt,
    };
  }

  public async saveNewsBatch(providerId: string, newsItems: Omit<NewsItem, "providerId">[]): Promise<NewsItem[]> {
    const savedItems: NewsItem[] = [];

    for (const item of newsItems) {
      const existing = await this.prisma.news.findUnique({
        where: {
          providerId_externalId: {
            providerId,
            externalId: item.externalId,
          },
        },
      });

      if (existing) {
        savedItems.push({
          id: existing.id,
          providerId: existing.providerId,
          externalId: existing.externalId,
          title: existing.title,
          summary: existing.summary,
          content: existing.content,
          url: existing.url,
          source: existing.source,
          author: existing.author,
          publishedAt: existing.publishedAt,
          crawledAt: existing.crawledAt,
        });
        continue;
      }

      const newsRecord = await this.prisma.news.create({
        data: {
          providerId,
          externalId: item.externalId,
          title: item.title,
          summary: item.summary,
          content: item.content,
          url: item.url,
          source: item.source,
          author: item.author,
          publishedAt: item.publishedAt,
        },
      });

      savedItems.push({
        id: newsRecord.id,
        providerId: newsRecord.providerId,
        externalId: newsRecord.externalId,
        title: newsRecord.title,
        summary: newsRecord.summary,
        content: newsRecord.content,
        url: newsRecord.url,
        source: newsRecord.source,
        author: newsRecord.author,
        publishedAt: newsRecord.publishedAt,
        crawledAt: newsRecord.crawledAt,
        coinSymbols: item.coinSymbols,
      });
    }

    return savedItems;
  }

  public async getNews(options: NewsFilterOptions): Promise<{ items: NewsItem[]; total: number }> {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 10));
    const skip = (page - 1) * pageSize;

    const whereClause: Record<string, unknown> = {};
    if (options.symbol) {
      const cleanSymbol = options.symbol.toUpperCase().replace("USDT", "");
      whereClause.OR = [
        { title: { contains: cleanSymbol, mode: "insensitive" } },
        { summary: { contains: cleanSymbol, mode: "insensitive" } },
      ];
    }

    const [total, records] = await Promise.all([
      this.prisma.news.count({ where: whereClause }),
      this.prisma.news.findMany({
        where: whereClause,
        orderBy: { publishedAt: "desc" },
        skip,
        take: pageSize,
      }),
    ]);

    const items: NewsItem[] = records.map((r) => ({
      id: r.id,
      providerId: r.providerId,
      externalId: r.externalId,
      title: r.title,
      summary: r.summary,
      content: r.content,
      url: r.url,
      source: r.source,
      author: r.author,
      publishedAt: r.publishedAt,
      crawledAt: r.crawledAt,
    }));

    return { items, total };
  }

  public async getNewsById(id: string): Promise<NewsItem | null> {
    const record = await this.prisma.news.findUnique({
      where: { id },
    });

    if (!record) return null;

    return {
      id: record.id,
      providerId: record.providerId,
      externalId: record.externalId,
      title: record.title,
      summary: record.summary,
      content: record.content,
      url: record.url,
      source: record.source,
      author: record.author,
      publishedAt: record.publishedAt,
      crawledAt: record.crawledAt,
    };
  }
}
