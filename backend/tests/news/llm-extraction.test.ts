import { describe, it, expect } from "vitest";
import { SelfHealingOrchestrator } from "../../src/modules/news/infrastructure/self-healing.orchestrator";

describe("LLM-Assisted & Self-Healing Extraction Pipeline", () => {

  it("should validate extraction batch quality and detect missing title error rates", () => {
    const orchestrator = new SelfHealingOrchestrator();

    // 10 items, 2 missing title (20% error rate > 10% threshold)
    const items = [
      { title: "Bitcoin hits $68k", summary: "BTC gains momentum" },
      { title: "Ethereum upgrade scheduled", summary: "ETH gas fees drop" },
      { title: "Solana DeFi grows", summary: "SOL TVL surges" },
      { title: "", summary: "Missing title item 1" },
      { title: null, summary: "Missing title item 2" },
      { title: "Cardano ADA update", summary: "ADA hardfork ready" },
      { title: "Avalanche AVAX news", summary: "AVAX subnet launches" },
      { title: "Polkadot DOT relay", summary: "DOT parachain auction" },
      { title: "Polygon MATIC zkVm", summary: "MATIC rebrand" },
      { title: "Chainlink LINK oracle", summary: "CCIP integration" },
    ];

    const validation = orchestrator.validateBatchQuality(items);

    expect(validation.totalItems).toBe(10);
    expect(validation.failedItems).toBe(2);
    expect(validation.errorRate).toBe(0.2); // 20%
    expect(validation.requiresHealing).toBe(true);
    expect(validation.failedFields).toContain("title");
  });

  it("should NOT trigger self-healing when error rate <= 10%", () => {
    const orchestrator = new SelfHealingOrchestrator();

    // 10 items, all valid (0% error rate)
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Valid Title ${i + 1}`,
      summary: `Valid Summary ${i + 1}`,
    }));

    const validation = orchestrator.validateBatchQuality(items);

    expect(validation.errorRate).toBe(0);
    expect(validation.requiresHealing).toBe(false);
  });
});
