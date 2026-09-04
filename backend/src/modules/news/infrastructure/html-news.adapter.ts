import type { NewsItem, NewsProviderAdapter } from "../domain/news.entity";
import { ExtractionTemplateManager } from "./llm-extraction.template-manager";
import { SelfHealingOrchestrator } from "./self-healing.orchestrator";

export class HtmlNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "HTML_WEB_SCRAPER";
  private readonly templateManager: ExtractionTemplateManager;
  private readonly selfHealingOrchestrator: SelfHealingOrchestrator;

  constructor(
    templateManager?: ExtractionTemplateManager,
    selfHealingOrchestrator?: SelfHealingOrchestrator
  ) {
    this.templateManager = templateManager ?? new ExtractionTemplateManager();
    this.selfHealingOrchestrator = selfHealingOrchestrator ?? new SelfHealingOrchestrator(this.templateManager);
  }

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const domain = "coindesk.com";
    const template = await this.templateManager.getActiveTemplate(domain);

    // Mock HTML sample fetching (or real HTTP GET)
    const sampleHtml = `
      <div class="article-card">
        <h1 class="article-title">Bitcoin surges above $68,000 as market sentiment improves</h1>
        <p class="summary font-bold">Crypto markets saw widespread gains following major institutional inflows.</p>
        <span class="source">CoinDesk</span>
        <span class="pub-date">2026-09-04T10:00:00Z</span>
      </div>
    `;

    const rawItems = [
      {
        externalId: `html-${Date.now()}-1`,
        title: "Bitcoin surges above $68,000 as market sentiment improves",
        summary: "Crypto markets saw widespread gains following major institutional inflows.",
        content: "Crypto markets saw widespread gains following major institutional inflows into BTC ETFs.",
        url: "https://coindesk.com/markets/bitcoin-surges-68k",
        source: "CoinDesk (HTML Scraper)",
        publishedAt: new Date(),
        coinSymbols: [symbol ? symbol.toUpperCase().replace("USDT", "") : "BTC"],
      },
    ];

    // Quality check
    const validation = this.selfHealingOrchestrator.validateBatchQuality(rawItems);

    if (validation.requiresHealing) {
      await this.selfHealingOrchestrator.handleSelfHealing(domain, sampleHtml, validation.errorRate);
    }

    return rawItems;
  }
}
