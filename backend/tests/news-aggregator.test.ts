import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildNewsAdapter } from "../src/modules/news/infrastructure/adapter-factory";
import { AdapterRegistry } from "../src/modules/news/infrastructure/adapter-registry";
import { dedupeNews } from "../src/modules/news/infrastructure/aggregating-news.adapter";
import type { NewsItem } from "../src/modules/news/domain/news.entity";

describe("AdapterRegistry", () => {
  beforeEach(() => {
    AdapterRegistry.reset();
  });

  it("registers and lists adapters", () => {
    const reg = AdapterRegistry.getInstance();
    reg.register({
      code: "fake-a",
      priority: 1,
      enabled: true,
      requiresApiKey: false,
      factory: () => ({
        providerCode: "FAKE_A",
        async fetchLatestNews() {
          return [];
        },
      }),
    });
    reg.register({
      code: "fake-b",
      priority: 2,
      enabled: false,
      requiresApiKey: false,
      factory: () => ({
        providerCode: "FAKE_B",
        async fetchLatestNews() {
          return [];
        },
      }),
    });

    expect(reg.listAll()).toHaveLength(2);
    expect(reg.listEnabledCodes()).toEqual(["fake-a"]);
  });

  it("can be enabled/disabled at runtime", () => {
    const reg = AdapterRegistry.getInstance();
    reg.register({
      code: "fake-x",
      priority: 1,
      enabled: false,
      requiresApiKey: false,
      factory: () => ({
        providerCode: "FAKE_X",
        async fetchLatestNews() {
          return [];
        },
      }),
    });

    expect(reg.listEnabledCodes()).toEqual([]);
    reg.setEnabled("fake-x", true);
    expect(reg.listEnabledCodes()).toEqual(["fake-x"]);
  });
});

describe("AggregatingNewsAdapter", () => {
  it("merges and dedupes from multiple sources", async () => {
    const fakeA = {
      providerCode: "FAKE_A",
      async fetchLatestNews() {
        return [
          makeItem("A", "https://example.com/1", "Bitcoin surges to new high"),
          makeItem("A", "https://example.com/2", "Ethereum update released"),
        ];
      },
    };
    const fakeB = {
      providerCode: "FAKE_B",
      async fetchLatestNews() {
        return [
          // Duplicate URL — should be deduped
          makeItem("B", "https://example.com/1", "Bitcoin surges to new high"),
          // Duplicate title (different URL) — should be deduped
          makeItem("B", "https://another.com/x", "Bitcoin surges to new high"),
          // Unique
          makeItem("B", "https://another.com/sol", "Solana breaks resistance"),
        ];
      },
    };

    const { AggregatingNewsAdapter } = await import("../src/modules/news/infrastructure/aggregating-news.adapter");
    const agg = new AggregatingNewsAdapter([fakeA, fakeB]);
    const result = await agg.fetchLatestNews();

    // 2 unique from fakeA + 1 unique from fakeB = 3
    expect(result).toHaveLength(3);
    const urls = result.map((r) => r.url).sort();
    expect(urls).toEqual([
      "https://another.com/sol",
      "https://example.com/1",
      "https://example.com/2",
    ]);
  });

  it("one failing source does not break others", async () => {
    const good = {
      providerCode: "GOOD",
      async fetchLatestNews() {
        return [makeItem("G", "https://good.com/1", "Good news")];
      },
    };
    const bad = {
      providerCode: "BAD",
      async fetchLatestNews() {
        throw new Error("provider down");
      },
    };

    const { AggregatingNewsAdapter } = await import("../src/modules/news/infrastructure/aggregating-news.adapter");
    const agg = new AggregatingNewsAdapter([bad, good]);
    const result = await agg.fetchLatestNews();

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://good.com/1");
  });
});

describe("dedupeNews unit tests", () => {
  it("keeps first-seen items by URL priority", () => {
    const items = [
      { item: makeItem("A", "https://x.com/1", "title"), source: "A" },
      { item: makeItem("B", "https://x.com/1", "title"), source: "B" },
    ];
    const result = dedupeNews(items);
    expect(result).toHaveLength(1);
  });

  it("keeps items with different URLs even if titles are identical-after-normalisation", () => {
    const items = [
      { item: makeItem("A", "https://a.com/x", "the Bitcoin rises"), source: "A" },
      { item: makeItem("B", "https://b.com/y", "Bitcoin rises"), source: "B" },
    ];
    const result = dedupeNews(items);
    expect(result).toHaveLength(1);
  });
});

function makeItem(
  source: string,
  url: string,
  title: string,
): Omit<NewsItem, "providerId"> {
  return {
    externalId: `${source}-${url}`,
    title,
    summary: null,
    content: null,
    url,
    source,
    author: null,
    publishedAt: new Date(),
    coinSymbols: [],
  };
}
