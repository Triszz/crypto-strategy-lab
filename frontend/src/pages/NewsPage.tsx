import { useState } from 'react';
import { Newspaper, ExternalLink, ThumbsUp, ThumbsDown, Minus, Search, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  relatedSymbols: string[];
  summary: string;
}

const mockNews: NewsItem[] = [
  { id: '1', title: 'Bitcoin Surges Past $67,000 as Institutional Adoption Accelerates', source: 'CryptoNews', url: '#', publishedAt: '2 hours ago', sentiment: 'positive', sentimentScore: 0.85, relatedSymbols: ['BTCUSDT'], summary: 'Major financial institutions are increasing their Bitcoin allocations, driving prices to new yearly highs.' },
  { id: '2', title: 'Ethereum ETF Sees Record Inflows Following SEC Approval', source: 'CoinDesk', url: '#', publishedAt: '4 hours ago', sentiment: 'positive', sentimentScore: 0.72, relatedSymbols: ['ETHUSDT'], summary: 'The newly approved Ethereum ETFs have attracted over $500 million in inflows in their first week.' },
  { id: '3', title: 'Regulatory Concerns Rise as Multiple Exchanges Face Investigations', source: 'The Block', url: '#', publishedAt: '6 hours ago', sentiment: 'negative', sentimentScore: -0.45, relatedSymbols: ['BTCUSDT', 'ETHUSDT'], summary: 'Multiple cryptocurrency exchanges are under investigation for compliance violations.' },
  { id: '4', title: 'Solana Network Upgrade Improves Transaction Speed by 30%', source: 'CryptoSlate', url: '#', publishedAt: '8 hours ago', sentiment: 'positive', sentimentScore: 0.68, relatedSymbols: ['SOLUSDT'], summary: 'The latest Solana upgrade has significantly improved network performance and reduced fees.' },
  { id: '5', title: 'Market Volatility Expected as Fed Announces Interest Rate Decision', source: 'Bloomberg', url: '#', publishedAt: '10 hours ago', sentiment: 'neutral', sentimentScore: 0.0, relatedSymbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'], summary: 'Federal Reserve meeting scheduled for next week could impact crypto markets.' },
  { id: '6', title: 'DeFi Protocol Reports $100M in Trading Volume Milestone', source: 'DeFi Pulse', url: '#', publishedAt: '12 hours ago', sentiment: 'positive', sentimentScore: 0.78, relatedSymbols: ['ETHUSDT'], summary: 'Leading DeFi protocol celebrates major milestone in decentralized trading volume.' },
  { id: '7', title: 'Altcoin Market Faces Correction as Profit-Taking Intensifies', source: 'CoinMarketCap', url: '#', publishedAt: '14 hours ago', sentiment: 'negative', sentimentScore: -0.52, relatedSymbols: ['ADAUSDT', 'DOTUSDT', 'MATICUSDT'], summary: 'Several altcoins have dropped 10-15% as traders take profits after recent rallies.' },
  { id: '8', title: 'BNB Chain Announces Major Developer Incentive Program', source: 'BNB Chain Blog', url: '#', publishedAt: '16 hours ago', sentiment: 'positive', sentimentScore: 0.65, relatedSymbols: ['BNBUSDT'], summary: 'BNB Chain launches $100M fund to support new dApp development on its ecosystem.' },
];

const sentimentConfig = {
  positive: { icon: ThumbsUp, label: 'Positive', badge: 'bg-success-muted text-success', iconBg: 'bg-success-muted' },
  negative: { icon: ThumbsDown, label: 'Negative', badge: 'bg-danger-muted text-danger', iconBg: 'bg-danger-muted' },
  neutral: { icon: Minus, label: 'Neutral', badge: 'bg-bg-secondary text-text-muted', iconBg: 'bg-bg-secondary' },
};

export default function NewsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSentiment, setFilterSentiment] = useState<'all' | 'positive' | 'negative' | 'neutral'>('all');
  const [filterSymbol, setFilterSymbol] = useState<string>('all');

  const filteredNews = mockNews.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSentiment = filterSentiment === 'all' || item.sentiment === filterSentiment;
    const matchesSymbol = filterSymbol === 'all' || item.relatedSymbols.includes(filterSymbol);
    return matchesSearch && matchesSentiment && matchesSymbol;
  });

  const allSymbols = [...new Set(mockNews.flatMap(n => n.relatedSymbols))];

  const sentimentSummary = {
    positive: mockNews.filter(n => n.sentiment === 'positive').length,
    negative: mockNews.filter(n => n.sentiment === 'negative').length,
    neutral: mockNews.filter(n => n.sentiment === 'neutral').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Crypto News & Sentiment</h2>
          <p className="text-sm text-text-muted mt-1">Latest news with AI-powered sentiment analysis</p>
        </div>
        <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Sentiment Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-bg-card p-4 hover:border-success/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success-muted flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Positive</p>
              <p className="text-xl font-bold text-success tabular-nums">{sentimentSummary.positive}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center">
              <Minus className="w-5 h-5 text-text-muted" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Neutral</p>
              <p className="text-xl font-bold text-text-primary tabular-nums">{sentimentSummary.neutral}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4 hover:border-danger/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger-muted flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Negative</p>
              <p className="text-xl font-bold text-danger tabular-nums">{sentimentSummary.negative}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search news..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <select
          value={filterSentiment}
          onChange={(e) => setFilterSentiment(e.target.value as typeof filterSentiment)}
          className="px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
        >
          <option value="all">All Sentiment</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
        <select
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value)}
          className="px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
        >
          <option value="all">All Symbols</option>
          {allSymbols.map(sym => (
            <option key={sym} value={sym}>{sym}</option>
          ))}
        </select>
      </div>

      {/* News List */}
      <div className="space-y-3">
        {filteredNews.map((item) => {
          const sentiment = sentimentConfig[item.sentiment];
          const SentimentIcon = sentiment.icon;

          return (
            <div
              key={item.id}
              className="group rounded-2xl border border-border bg-bg-card p-5 hover:border-accent/30 hover:bg-bg-hover/30 transition-all"
            >
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl ${sentiment.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <SentimentIcon className={`w-5 h-5 ${
                    item.sentiment === 'positive' ? 'text-success' :
                    item.sentiment === 'negative' ? 'text-danger' : 'text-text-muted'
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h3 className="font-semibold text-text-primary leading-snug text-sm">
                      {item.title}
                    </h3>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-accent transition-colors opacity-60 group-hover:opacity-100"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  <p className="text-sm text-text-secondary mb-3 leading-relaxed">{item.summary}</p>

                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <span className="font-medium text-text-secondary">{item.source}</span>
                    <span className="w-1 h-1 rounded-full bg-text-muted" />
                    <span className="text-text-muted">{item.publishedAt}</span>
                    <span className="w-1 h-1 rounded-full bg-text-muted" />
                    <span className="text-text-muted">Score</span>
                    <span className={`font-semibold tabular-nums ${
                      item.sentimentScore > 0 ? 'text-success' :
                      item.sentimentScore < 0 ? 'text-danger' : 'text-text-primary'
                    }`}>
                      {item.sentimentScore > 0 ? '+' : ''}{item.sentimentScore.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {item.relatedSymbols.map((symbol) => (
                      <span
                        key={symbol}
                        className="px-2 py-0.5 rounded-md bg-bg-secondary text-text-secondary text-xs font-medium border border-border/50"
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredNews.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-border flex items-center justify-center mx-auto mb-4">
            <Newspaper className="w-7 h-7 text-text-muted" />
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-1">No news found</h3>
          <p className="text-sm text-text-muted">Try adjusting your filters</p>
        </div>
      )}
    </div>
  );
}
