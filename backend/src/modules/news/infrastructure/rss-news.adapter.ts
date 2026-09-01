import { NewsItem, NewsProviderAdapter } from "../domain/news.entity";

export class RSSNewsAdapter implements NewsProviderAdapter {
  public readonly providerCode = "CRYPTO_NEWS_RSS";

  public async fetchLatestNews(symbol?: string): Promise<Omit<NewsItem, "providerId">[]> {
    const targetSymbol = symbol ? symbol.toUpperCase().replace("USDT", "") : "BTC";
    const now = new Date();

    const mockNews: Omit<NewsItem, "providerId">[] = [
      {
        externalId: `rss-${targetSymbol.toLowerCase()}-${now.getTime()}-1`,
        title: `${targetSymbol} surges following institutional ETF inflow data`,
        summary: `Analysts report strong momentum for ${targetSymbol} as market indicators signal continuous buying pressure.`,
        content: `Market dynamics for ${targetSymbol} have shown significant strength over the last 24 hours driven by institutional interest and high trading volumes across major exchanges.`,
        url: `https://cryptonews.example.com/${targetSymbol.toLowerCase()}-surge-${now.getTime()}`,
        source: "CryptoNews Daily",
        author: "Satoshi Reporter",
        publishedAt: new Date(now.getTime() - 1000 * 60 * 15), // 15 mins ago
        coinSymbols: [targetSymbol, "USDT"],
      },
      {
        externalId: `rss-${targetSymbol.toLowerCase()}-${now.getTime()}-2`,
        title: `Macroeconomic factors and ${targetSymbol} price key support levels`,
        summary: `Traders watch support levels for ${targetSymbol} closely ahead of upcoming Federal Reserve economic announcements.`,
        content: `Volatility is expected to remain elevated as technical indicators show key resistance levels being tested.`,
        url: `https://blockchaininsight.example.com/${targetSymbol.toLowerCase()}-macro-${now.getTime()}`,
        source: "Blockchain Insights",
        author: "Alice Market",
        publishedAt: new Date(now.getTime() - 1000 * 60 * 45), // 45 mins ago
        coinSymbols: [targetSymbol],
      },
      {
        externalId: `rss-crypto-market-${now.getTime()}-3`,
        title: `Crypto Market Analysis: Altcoin volume rises as Bitcoin stabilizes`,
        summary: `Bitcoin consolidates near local highs while Ethereum and Solana trading activity surges.`,
        content: `Broad market sentiment remains cautiously optimistic as liquidity flows into top layer 1 ecosystems.`,
        url: `https://coinworld.example.com/altcoin-surge-${now.getTime()}`,
        source: "CoinWorld",
        author: "Bob Trader",
        publishedAt: new Date(now.getTime() - 1000 * 60 * 90), // 90 mins ago
        coinSymbols: ["BTC", "ETH", "SOL"],
      },
    ];

    return mockNews;
  }
}
