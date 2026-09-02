import { describe, it, expect, beforeEach } from "vitest";
import { NewsCrawlerQueue } from "../src/modules/news/infrastructure/news-crawler.queue";
import type { NewsItem } from "../src/modules/news/domain/news.entity";

/**
 * Unit tests for the NewsCrawlerQueue. These are pure-logic tests:
 * the queue accepts an injected `crawlFn` so we can drive its behaviour
 * without touching Prisma or any network.
 *
 * The tests intentionally exercise the *public* API only (crawlNow,
 * getJobStatus, getRecentJobs, start/stop with interval=0) — they do
 * not poll the internal Map directly. This protects the tests from
 * incidental refactors.
 */

const makeItem = (symbol: string, idx: number): Omit<NewsItem, "providerId"> => ({
  externalId: `${symbol}-${idx}`,
  title: `${symbol} item ${idx}`,
  summary: null,
  content: null,
  url: `https://example.com/${symbol}/${idx}`,
  source: "Test",
  author: null,
  publishedAt: new Date(),
  coinSymbols: [symbol],
});

describe("NewsCrawlerQueue", () => {
  beforeEach(() => {
    NewsCrawlerQueue.resetInstance();
  });

  it("crawlNow returns a jobId and processes the job to COMPLETED", async () => {
    // Arrange: crawler that returns 2 items per symbol.
    const calls: string[] = [];
    const queue = NewsCrawlerQueue.getInstance(
      async (symbol) => {
        calls.push(symbol ?? "GLOBAL");
        return [makeItem(symbol ?? "GLOBAL", 1), makeItem(symbol ?? "GLOBAL", 2)];
      },
      ["BTC", "ETH"],
    );

    // Act: enqueue a manual crawl.
    const jobId = queue.crawlNow();

    // Initial status should be visible immediately.
    const initial = queue.getJobStatus(jobId);
    expect(initial).not.toBeNull();
    expect(initial!.jobId).toBe(jobId);
    expect(initial!.symbols).toEqual(["BTC", "ETH"]);
    expect(["WAITING", "RUNNING", "COMPLETED"]).toContain(initial!.status);

    // Wait for the async setImmediate-driven processJob to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const final = queue.getJobStatus(jobId);
    expect(final).not.toBeNull();
    expect(final!.status).toBe("COMPLETED");
    expect(final!.totalFetched).toBe(4); // 2 symbols × 2 items
    expect(final!.totalSaved).toBe(4);
    expect(final!.finishedAt).toBeDefined();
    expect(final!.errors).toEqual([]);

    // The crawlFn must have been called once per symbol.
    expect(calls.sort()).toEqual(["BTC", "ETH"]);
  });

  it("marks job as FAILED when every symbol throws", async () => {
    const queue = NewsCrawlerQueue.getInstance(
      async () => {
        throw new Error("upstream down");
      },
      ["BTC"],
    );

    const jobId = queue.crawlNow();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const final = queue.getJobStatus(jobId);
    expect(final!.status).toBe("FAILED");
    expect(final!.errors).toHaveLength(1);
    expect(final!.errors[0]).toEqual({ symbol: "BTC", message: "upstream down" });
  });

  it("marks job as COMPLETED with partial errors when some symbols fail", async () => {
    const queue = NewsCrawlerQueue.getInstance(
      async (symbol) => {
        if (symbol === "ETH") {
          throw new Error("ETH provider 500");
        }
        return [makeItem(symbol ?? "?", 1)];
      },
      ["BTC", "ETH"],
    );

    const jobId = queue.crawlNow();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const final = queue.getJobStatus(jobId);
    expect(final!.status).toBe("COMPLETED");
    expect(final!.totalFetched).toBe(1);
    expect(final!.errors).toHaveLength(1);
    expect(final!.errors[0].symbol).toBe("ETH");
  });

  it("getRecentJobs returns jobs newest first", async () => {
    const queue = NewsCrawlerQueue.getInstance(
      async () => [],
      ["BTC"],
    );

    const id1 = queue.crawlNow();
    // Small delay so the timestamps differ.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id2 = queue.crawlNow();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const recent = queue.getRecentJobs();
    expect(recent.length).toBeGreaterThanOrEqual(2);
    // Newest first: id2 must appear before id1 in the returned array.
    const idx1 = recent.findIndex((j) => j.jobId === id1);
    const idx2 = recent.findIndex((j) => j.jobId === id2);
    expect(idx2).toBeLessThan(idx1);
  });

  it("start(0) fires one initial crawl and does not schedule a periodic timer", async () => {
    const calls: string[] = [];
    const queue = NewsCrawlerQueue.getInstance(
      async (symbol) => {
        calls.push(symbol ?? "GLOBAL");
        return [makeItem(symbol ?? "GLOBAL", 1)];
      },
      ["BTC"],
    );

    queue.start(0);

    // Wait long enough for the setImmediate to run, but not long enough
    // for a periodic timer (there isn't one).
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Exactly one crawl per symbol from the initial run.
    expect(calls).toEqual(["BTC"]);

    queue.stop();
  });

  it("getJobStatus returns null for unknown jobId", () => {
    const queue = NewsCrawlerQueue.getInstance(
      async () => [],
      ["BTC"],
    );
    expect(queue.getJobStatus("does-not-exist")).toBeNull();
  });
});
