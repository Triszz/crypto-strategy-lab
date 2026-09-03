import { describe, it, expect } from "vitest";
import { CrawlNewsBodySchema } from "../src/modules/news/presentation/news.dto";

/**
 * Regression tests for the POST /news/crawl body schema.
 *
 * Background: the FE used to send `{ symbol: null }` when the user
 * selected "ALL" on the filter dropdown, and Zod's `.optional()`
 * modifier (string | undefined) rejected `null` with 400. The schema
 * now uses `.nullish()` so the body can be missing, contain a real
 * symbol, or contain `null` — all three should be accepted.
 *
 * These tests guard against a regression: if someone reverts
 * `.nullish()` back to `.optional()` the null-case test below will
 * fail and block the change.
 */

describe("CrawlNewsBodySchema", () => {
  it("accepts an empty body (no symbol field)", () => {
    const parsed = CrawlNewsBodySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.symbol).toBeUndefined();
    }
  });

  it("accepts `{ symbol: null }` (the historical bug case)", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // `.nullish()` preserves null through the schema; downstream
      // service code already handles `null | undefined` (calls
      // `symbol?.toUpperCase()` which short-circuits on both).
      expect(parsed.data.symbol).toBeUndefined();
    }
  });

  it("accepts a valid base-asset symbol and upper-cases it", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "btc" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.symbol).toBe("BTC");
    }
  });

  it("accepts a full pair symbol like BTCUSDT", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "ethusdt" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.symbol).toBe("ETHUSDT");
    }
  });

  it("trims surrounding whitespace before validating", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "  SOL  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.symbol).toBe("SOL");
    }
  });

  it("rejects a symbol with disallowed characters", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "BTC!" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a number (wrong JSON type)", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: 123 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a symbol longer than the 10-char limit", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "ABCDEFGHIJK" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a too-short symbol", () => {
    const parsed = CrawlNewsBodySchema.safeParse({ symbol: "B" });
    expect(parsed.success).toBe(false);
  });
});
