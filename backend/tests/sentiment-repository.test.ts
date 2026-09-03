/**
 * sentiment · repository · bug-fix regression test
 *
 * Phase B regression coverage for spec `02-sentiment-module.md` §7.1.
 * The original `getSentimentSummary(symbol)` filtered with free-text
 * ILIKE on `title`/`summary`, which produced false positives (e.g. an
 * ETH article mentioning "BTC" counted as BTC sentiment). The fix
 * switched the filter to `news.coins.some.symbol.baseAsset`, joining
 * through the `NewsCoin` and `Symbol` tables — the same pattern News
 * module adopted in Phase A.3.
 *
 * These tests mock `prisma.sentiment.findMany` so they don't need a
 * live Postgres — they verify the *shape* of the `where` clause the
 * repository hands to Prisma. That's the only surface where this bug
 * can re-appear: if anyone reverts to `title ILIKE`, the assertion
 * below will fail and block the regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/infrastructure/database/prisma", () => ({
  getPrismaClient: () => mockPrisma,
}));

// Hoisted mock Prisma client. Each test reassigns `mockPrisma.sentiment`
// to capture the `where` argument and return a deterministic row set.
const mockPrisma: any = {
  sentiment: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  sentimentProvider: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

// Import AFTER the mock so the module picks it up.
const { PrismaSentimentRepository } = await import(
  "../src/modules/sentiment/infrastructure/prisma-sentiment.repository"
);

function setFindManyReturn(rows: unknown[]): void {
  mockPrisma.sentiment.findMany.mockResolvedValueOnce(rows);
}

function capturedWhere(): unknown {
  const call = mockPrisma.sentiment.findMany.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0]?.where;
}

describe("PrismaSentimentRepository.getSentimentSummary — Phase B bug fix", () => {
  beforeEach(() => {
    mockPrisma.sentiment.findMany.mockReset();
  });

  it("filters by news.coins.some.symbol.baseAsset when a symbol is provided", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary("BTC");

    const where = capturedWhere();
    expect(where).toEqual({
      news: {
        coins: {
          some: {
            symbol: {
              baseAsset: {
                equals: "BTC",
                mode: "insensitive",
              },
            },
          },
        },
      },
    });
  });

  it("strips the USDT quote suffix before comparing against baseAsset", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary("BTCUSDT");

    const where = capturedWhere() as any;
    expect(where.news.coins.some.symbol.baseAsset.equals).toBe("BTC");
  });

  it("strips other stable-quote suffixes (USDC, BUSD, USD) for symmetry with News module", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary("ethusdc");

    const where = capturedWhere() as any;
    expect(where.news.coins.some.symbol.baseAsset.equals).toBe("ETH");
  });

  it("upper-cases the input symbol before the baseAsset comparison", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary("sol");

    const where = capturedWhere() as any;
    expect(where.news.coins.some.symbol.baseAsset.equals).toBe("SOL");
  });

  it("does NOT filter by title ILIKE (regression guard for the original bug)", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary("BTC");

    const where = JSON.stringify(capturedWhere());
    expect(where).not.toContain("title");
    expect(where).not.toContain("summary");
    expect(where).not.toContain("ILIKE");
    expect(where).not.toContain("contains");
  });

  it("omits the news.coins filter when no symbol is provided (returns all sentiments)", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    await repo.getSentimentSummary(undefined);

    expect(capturedWhere()).toBeUndefined();
  });

  it("aggregates counts and average score from the rows the join returned", async () => {
    setFindManyReturn([
      {
        id: "s1",
        newsId: "n1",
        providerId: "p1",
        classification: "POSITIVE",
        score: { toString: () => "0.6" },
        confidence: null,
        analyzedAt: new Date(),
      },
      {
        id: "s2",
        newsId: "n2",
        providerId: "p1",
        classification: "NEGATIVE",
        score: { toString: () => "-0.4" },
        confidence: null,
        analyzedAt: new Date(),
      },
      {
        id: "s3",
        newsId: "n3",
        providerId: "p1",
        classification: "NEUTRAL",
        score: { toString: () => "0" },
        confidence: null,
        analyzedAt: new Date(),
      },
    ]);

    const repo = new PrismaSentimentRepository();
    const summary = await repo.getSentimentSummary("BTC");

    expect(summary.symbol).toBe("BTC");
    expect(summary.totalNews).toBe(3);
    expect(summary.positiveCount).toBe(1);
    expect(summary.negativeCount).toBe(1);
    expect(summary.neutralCount).toBe(1);
    // (0.6 + -0.4 + 0) / 3 = 0.0667 → rounded to 0.067
    expect(summary.averageScore).toBeCloseTo(0.067, 3);
  });

  it("returns zeros (no rows) when nothing matches the symbol filter", async () => {
    setFindManyReturn([]);

    const repo = new PrismaSentimentRepository();
    const summary = await repo.getSentimentSummary("DOGE");

    expect(summary).toEqual({
      symbol: "DOGE",
      averageScore: 0,
      totalNews: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
    });
  });
});
