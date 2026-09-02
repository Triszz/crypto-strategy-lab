import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  NewsFilterOptions,
  NewsItem,
  NewsProviderEntity,
  NewsRepository,
  OutboxEventPayload,
} from "../domain/news.entity";

/**
 * Shape we expect from Prisma when including the `coins` relation.
 * Used internally so `toDomain()` is type-safe.
 */
type NewsWithCoins = {
  id: string;
  providerId: string;
  externalId: string;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  source: string;
  author: string | null;
  publishedAt: Date;
  crawledAt: Date;
  coins: { symbol: { baseAsset: string } }[];
};

/**
 * Strip the "USDT" / "BUSD" / "USDC" quote suffix and uppercase.
 * Centralised here so both the save path (link coins) and the read
 * path (filter coins) agree on what "BTC" means.
 */
function normalizeBaseAsset(symbol: string): string {
  return symbol.toUpperCase().replace(/(USDT|USDC|BUSD|USD)$/i, "");
}

export class PrismaNewsRepository implements NewsRepository {
  private prisma = getPrismaClient();

  public async findOrCreateProvider(
    code: string,
    name: string,
    baseUrl: string,
  ): Promise<NewsProviderEntity> {
    const existing = await this.prisma.newsProvider.findUnique({ where: { code } });

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
      data: { code, name, baseUrl, requiresApiKey: false, isActive: true },
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

  /**
   * Persist a batch of news items in O(1) DB round-trips (was O(2N)
   * before — one `findUnique` + one `create` per item).
   *
   * Strategy:
   *   1. Bulk-fetch existing rows by `(providerId, externalId IN ...)`.
   *   2. `createMany({ skipDuplicates: true })` for new rows only.
   *   3. Re-fetch new rows to obtain generated UUIDs.
   *   4. Resolve Symbol IDs by `baseAsset IN (...)` (single query).
   *   5. `createMany({ skipDuplicates: true })` for `NewsCoin` links.
   *   6. Return combined list with `coinSymbols` populated from the relation.
   *
   * The relationship is `News 1—* NewsCoin *—1 Symbol`, so a news row
   * resolves to one `baseAsset` per linked symbol. The adapter populates
   * `coinSymbols` with base-asset form (e.g. "BTC" not "BTCUSDT"), so
   * the lookup is direct.
   */
  public async saveNewsBatch(
    providerId: string,
    newsItems: Omit<NewsItem, "providerId">[],
  ): Promise<NewsItem[]> {
    if (newsItems.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const externalIds = newsItems.map((i) => i.externalId);

      // 1. Find existing rows (with coins) in one round-trip.
      const existingRows = await tx.news.findMany({
        where: { providerId, externalId: { in: externalIds } },
        include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
      });
      const existingByExtId = new Map(existingRows.map((r) => [r.externalId, r]));

      // 2. Identify genuinely new items.
      const newItems = newsItems.filter((i) => !existingByExtId.has(i.externalId));

      // 3. Bulk-insert new rows.
      if (newItems.length > 0) {
        await tx.news.createMany({
          data: newItems.map((item) => ({
            providerId,
            externalId: item.externalId,
            title: item.title,
            summary: item.summary,
            content: item.content,
            url: item.url,
            source: item.source,
            author: item.author,
            publishedAt: item.publishedAt,
          })),
          skipDuplicates: true,
        });
      }

      // 4. Re-fetch new rows so we have their generated UUIDs.
      let newRows: NewsWithCoins[] = [];
      if (newItems.length > 0) {
        newRows = await tx.news.findMany({
          where: {
            providerId,
            externalId: { in: newItems.map((i) => i.externalId) },
          },
          include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
        });
      }

      // 5. Link coins. Aggregate every `coinSymbols` value across the new
      //    items, resolve Symbols in one query, then bulk-insert NewsCoin
      //    rows. We dedupe the (newsId, symbolId) pairs so the unique
      //    constraint never fires.
      if (newRows.length > 0) {
        const requestedBaseAssets = Array.from(
          new Set(
            newItems
              .flatMap((i) => i.coinSymbols ?? [])
              .map(normalizeBaseAsset)
              .filter((s) => s.length > 0),
          ),
        );

        if (requestedBaseAssets.length > 0) {
          const symbols = await tx.symbol.findMany({
            where: {
              baseAsset: { in: requestedBaseAssets },
              isActive: true,
            },
            select: { id: true, baseAsset: true },
          });
          const symbolIdByBase = new Map(symbols.map((s) => [s.baseAsset, s.id]));

          const links: { newsId: string; symbolId: string }[] = [];
          for (const row of newRows) {
            const sourceItem = newItems.find((i) => i.externalId === row.externalId);
            if (!sourceItem) continue;
            const seen = new Set<string>();
            for (const raw of sourceItem.coinSymbols ?? []) {
              const baseAsset = normalizeBaseAsset(raw);
              const symbolId = symbolIdByBase.get(baseAsset);
              if (symbolId && !seen.has(symbolId)) {
                links.push({ newsId: row.id, symbolId });
                seen.add(symbolId);
              }
            }
          }

          if (links.length > 0) {
            await tx.newsCoin.createMany({
              data: links,
              skipDuplicates: true,
            });
          }
        }

        // Refresh coin relations on the new rows we return.
        const refreshedNewRows = await tx.news.findMany({
          where: { id: { in: newRows.map((r) => r.id) } },
          include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
        });
        return [...existingRows, ...refreshedNewRows].map((r) => this.toDomain(r));
      }

      return existingRows.map((r) => this.toDomain(r));
    });
  }

  /**
   * Phase C.5: saves news AND enqueues outbox events in a SINGLE atomic
   * DB transaction.
   *
   * Why a single transaction?
   *   If the news inserts succeed but the outbox row insert fails, the
   *   transaction rolls back both — no orphan news without events.
   *   If the news insert fails, neither the news nor the outbox row
   *   is visible to other transactions.
   *
   * `outboxPayloadFn` is called with the saved `NewsItem[]` so the caller
   * can build the correct event payloads (including the generated UUIDs).
   *
   * This method reuses the same batch logic as `saveNewsBatch` but wraps
   * everything inside one transaction that additionally creates QueueJob
   * rows for the outbox.
   */
  public async saveNewsBatchAndEnqueueOutbox(
    providerId: string,
    newsItems: Omit<NewsItem, "providerId">[],
    outboxPayloadFn: (savedNews: NewsItem[]) => OutboxEventPayload[],
  ): Promise<NewsItem[]> {
    if (newsItems.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const externalIds = newsItems.map((i) => i.externalId);

      // 1. Find existing rows.
      const existingRows = await tx.news.findMany({
        where: { providerId, externalId: { in: externalIds } },
        include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
      });
      const existingByExtId = new Map(existingRows.map((r) => [r.externalId, r]));

      // 2. Identify genuinely new items.
      const newItems = newsItems.filter((i) => !existingByExtId.has(i.externalId));

      // 3. Bulk-insert new rows.
      if (newItems.length > 0) {
        await tx.news.createMany({
          data: newItems.map((item) => ({
            providerId,
            externalId: item.externalId,
            title: item.title,
            summary: item.summary,
            content: item.content,
            url: item.url,
            source: item.source,
            author: item.author,
            publishedAt: item.publishedAt,
          })),
          skipDuplicates: true,
        });
      }

      // 4. Re-fetch new rows so we have their generated UUIDs.
      let newRows: NewsWithCoins[] = [];
      if (newItems.length > 0) {
        newRows = await tx.news.findMany({
          where: { providerId, externalId: { in: newItems.map((i) => i.externalId) } },
          include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
        });

        // 5. Link coins.
        const requestedBaseAssets = Array.from(
          new Set(newItems.flatMap((i) => i.coinSymbols ?? []).map(normalizeBaseAsset).filter((s) => s.length > 0)),
        );

        if (requestedBaseAssets.length > 0) {
          const symbols = await tx.symbol.findMany({
            where: { baseAsset: { in: requestedBaseAssets }, isActive: true },
            select: { id: true, baseAsset: true },
          });
          const symbolIdByBase = new Map(symbols.map((s) => [s.baseAsset, s.id]));

          const links: { newsId: string; symbolId: string }[] = [];
          for (const row of newRows) {
            const sourceItem = newItems.find((i) => i.externalId === row.externalId);
            if (!sourceItem) continue;
            const seen = new Set<string>();
            for (const raw of sourceItem.coinSymbols ?? []) {
              const baseAsset = normalizeBaseAsset(raw);
              const symbolId = symbolIdByBase.get(baseAsset);
              if (symbolId && !seen.has(symbolId)) {
                links.push({ newsId: row.id, symbolId });
                seen.add(symbolId);
              }
            }
          }
          if (links.length > 0) {
            await tx.newsCoin.createMany({ data: links, skipDuplicates: true });
          }
        }
      }

      // 6. Refresh coin relations on new rows for the return value.
      let refreshedNewRows: NewsWithCoins[] = [];
      if (newRows.length > 0) {
        refreshedNewRows = await tx.news.findMany({
          where: { id: { in: newRows.map((r) => r.id) } },
          include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
        });
      }

      const allSavedRows = [...existingRows, ...refreshedNewRows].map((r) => this.toDomain(r));

      // 7. Enqueue outbox events (Phase C.5).
      //    `outboxPayloadFn` maps saved news → event payloads.
      //    We write QueueJob rows for each event in the same transaction.
      //
      //    Bug fix: `jobId` MUST be globally unique because of the
      //    `@@unique([jobId])` constraint on QueueJob. The previous
      //    expression `find(...)?.id ?? Date.now()` could collide when
      //    multiple payloads shared the same `Date.now()` (called in
      //    the same ms) OR when no matching row was found. Use the
      //    payload array index + a short random suffix to guarantee
      //    uniqueness within this transaction.
      const outboxPayloads = outboxPayloadFn(allSavedRows);
      if (outboxPayloads.length > 0) {
        const uniqueSuffix = Math.random().toString(36).slice(2, 10);
        await tx.queueJob.createMany({
          data: outboxPayloads.map((ev, idx) => ({
            jobId: `outbox-${ev.eventName}-${idx}-${uniqueSuffix}-${Date.now()}`,
            queueName: "news-outbox",
            jobType: "OUTBOX_EVENT",
            payload: ev.payload as unknown as Prisma.InputJsonValue,
            status: "WAITING",
          })),
        });
      }

      return allSavedRows;
    });
  }

  public async getNews(
    options: NewsFilterOptions,
  ): Promise<{ items: NewsItem[]; total: number }> {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 10));
    const skip = (page - 1) * pageSize;

    // Phase A.3: filter by `NewsCoin` relation rather than free-text ILIKE
    // on title/summary. This solves "BTC appears in the title but the news
    // is about something else" — the only news that match are those whose
    // adapter explicitly tagged the symbol.
    const whereClause: Record<string, unknown> = {};
    if (options.symbol) {
      const cleanBaseAsset = normalizeBaseAsset(options.symbol);
      whereClause.coins = {
        some: { symbol: { baseAsset: { equals: cleanBaseAsset, mode: "insensitive" } } },
      };
    }

    const [total, records] = await Promise.all([
      this.prisma.news.count({ where: whereClause }),
      this.prisma.news.findMany({
        where: whereClause,
        orderBy: { publishedAt: "desc" },
        skip,
        take: pageSize,
        include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
      }),
    ]);

    return {
      items: records.map((r) => this.toDomain(r)),
      total,
    };
  }

  public async getNewsById(id: string): Promise<NewsItem | null> {
    const record = await this.prisma.news.findUnique({
      where: { id },
      include: { coins: { select: { symbol: { select: { baseAsset: true } } } } },
    });
    return record ? this.toDomain(record) : null;
  }

  /**
   * Single mapping from a Prisma row (with optional `coins` relation)
   * to the domain `NewsItem` value object. Removes the field-by-field
   * copy that previously appeared in 4 places — easy to drift when the
   * schema changes.
   */
  private toDomain(record: NewsWithCoins): NewsItem {
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
      coinSymbols: record.coins?.map((c) => c.symbol.baseAsset) ?? [],
    };
  }
}
