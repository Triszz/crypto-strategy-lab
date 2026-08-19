import { useState } from 'react';
import { Search, Crown, Medal, Award, Eye, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  strategyName: string;
  trader: string;
  symbol: string;
  timeframe: string;
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  numTrades: number;
  overallScore: number;
  trend: 'up' | 'down' | 'same';
}

const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, strategyName: 'MA20 + RSI14 + SR', trader: 'trader_abc', symbol: 'BTCUSDT', timeframe: '1h', totalReturn: 24.2, winRate: 62.1, maxDrawdown: -5.4, sharpeRatio: 3.21, numTrades: 52, overallScore: 94, trend: 'same' },
  { rank: 2, strategyName: 'MA Crossover', trader: 'crypto_king', symbol: 'ETHUSDT', timeframe: '4h', totalReturn: 22.8, winRate: 64.3, maxDrawdown: -6.2, sharpeRatio: 2.98, numTrades: 38, overallScore: 91, trend: 'up' },
  { rank: 3, strategyName: 'RSI + Bollinger', trader: 'quant_trader', symbol: 'SOLUSDT', timeframe: '1h', totalReturn: 21.5, winRate: 59.8, maxDrawdown: -7.1, sharpeRatio: 2.87, numTrades: 45, overallScore: 88, trend: 'down' },
  { rank: 4, strategyName: 'BB Strategy', trader: 'moon_walker', symbol: 'BTCUSDT', timeframe: '1d', totalReturn: 19.3, winRate: 61.2, maxDrawdown: -8.4, sharpeRatio: 2.54, numTrades: 28, overallScore: 85, trend: 'up' },
  { rank: 5, strategyName: 'Support Resistance', trader: 'chart_master', symbol: 'BNBUSDT', timeframe: '1h', totalReturn: 18.7, winRate: 58.9, maxDrawdown: -6.8, sharpeRatio: 2.45, numTrades: 41, overallScore: 82, trend: 'same' },
  { rank: 6, strategyName: 'RSI Scalping', trader: 'scalp_king', symbol: 'XRPUSDT', timeframe: '5m', totalReturn: 16.4, winRate: 56.7, maxDrawdown: -9.2, sharpeRatio: 2.12, numTrades: 128, overallScore: 78, trend: 'down' },
  { rank: 7, strategyName: 'MA + RSI', trader: 'trend_follower', symbol: 'BTCUSDT', timeframe: '4h', totalReturn: 15.8, winRate: 60.1, maxDrawdown: -7.6, sharpeRatio: 2.01, numTrades: 35, overallScore: 76, trend: 'up' },
  { rank: 8, strategyName: 'Bollinger Bands', trader: 'volatility_trader', symbol: 'ETHUSDT', timeframe: '1h', totalReturn: 14.2, winRate: 55.4, maxDrawdown: -8.9, sharpeRatio: 1.89, numTrades: 42, overallScore: 72, trend: 'same' },
  { rank: 9, strategyName: 'MACD Strategy', trader: 'signal_seeker', symbol: 'ADAUSDT', timeframe: '1h', totalReturn: 12.6, winRate: 54.2, maxDrawdown: -10.1, sharpeRatio: 1.67, numTrades: 33, overallScore: 68, trend: 'down' },
  { rank: 10, strategyName: 'Mixed Strategy', trader: 'diversified', symbol: 'DOGEUSDT', timeframe: '1d', totalReturn: 11.3, winRate: 52.8, maxDrawdown: -11.5, sharpeRatio: 1.45, numTrades: 24, overallScore: 64, trend: 'up' },
];

const podiumConfig = [
  { icon: Crown, gradient: 'from-yellow-500/20 to-yellow-500/5', border: 'border-yellow-500/40', iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-500', label: '1st' },
  { icon: Medal, gradient: 'from-slate-400/20 to-slate-400/5', border: 'border-slate-400/40', iconBg: 'bg-slate-400/20', iconColor: 'text-slate-300', label: '2nd' },
  { icon: Award, gradient: 'from-amber-600/20 to-amber-600/5', border: 'border-amber-600/40', iconBg: 'bg-amber-600/20', iconColor: 'text-amber-600', label: '3rd' },
];

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'same' }) {
  if (trend === 'up') return <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-success-muted"><TrendingUp className="w-3 h-3 text-success" /></span>;
  if (trend === 'down') return <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-danger-muted"><TrendingDown className="w-3 h-3 text-danger" /></span>;
  return <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-secondary"><Minus className="w-3 h-3 text-text-muted" /></span>;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-yellow-500/20 text-yellow-500 font-bold text-sm">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-400/20 text-slate-300 font-bold text-sm">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-600/20 text-amber-600 font-bold text-sm">3</span>;
  return <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-bg-secondary text-text-muted font-semibold text-sm">{rank}</span>;
}

export default function LeaderboardPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSymbol, setFilterSymbol] = useState<string>('all');

  const symbols = [...new Set(mockLeaderboard.map(e => e.symbol))];

  const filteredLeaderboard = mockLeaderboard
    .filter(entry =>
      (filterSymbol === 'all' || entry.symbol === filterSymbol) &&
      (entry.strategyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
       entry.trader.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Strategy Leaderboard</h2>
        <p className="text-sm text-text-muted mt-1">Top performing strategies ranked by overall score</p>
      </div>

      {/* Podium */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {mockLeaderboard.slice(0, 3).map((entry, index) => {
          const config = podiumConfig[index];
          const Icon = config.icon;
          return (
            <div
              key={entry.rank}
              className={`relative overflow-hidden rounded-2xl border ${config.border} bg-gradient-to-br ${config.gradient} p-5 lg:p-6`}
            >
              <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-white/5 to-transparent rounded-full blur-2xl pointer-events-none" />
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl ${config.iconBg} flex items-center justify-center`}>
                    <Icon className={`w-6 h-6 ${config.iconColor}`} />
                  </div>
                  <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${config.iconBg} ${config.iconColor}`}>
                    {config.label}
                  </span>
                </div>
                <h3 className="font-semibold text-text-primary text-sm leading-tight mb-0.5">{entry.strategyName}</h3>
                <p className="text-xs text-text-muted mb-4">by {entry.trader}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Return</p>
                    <p className="text-base font-bold text-success tabular-nums">+{entry.totalReturn}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Win Rate</p>
                    <p className="text-base font-bold text-text-primary tabular-nums">{entry.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Sharpe</p>
                    <p className="text-base font-bold text-text-primary tabular-nums">{entry.sharpeRatio}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Score</p>
                    <p className="text-base font-bold text-accent tabular-nums">{entry.overallScore}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search strategies or traders..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <select
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value)}
          className="px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
        >
          <option value="all">All Symbols</option>
          {symbols.map(sym => (
            <option key={sym} value={sym}>{sym}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg-secondary/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Strategy
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider hidden md:table-cell">
                  Symbol / TF
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider hidden sm:table-cell">
                  Trend
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Return
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider hidden lg:table-cell">
                  Sharpe
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Score
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredLeaderboard.map((entry) => (
                <tr key={entry.rank} className="hover:bg-bg-hover/50 transition-colors">
                  <td className="px-4 py-3.5">
                    <RankBadge rank={entry.rank} />
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-text-primary text-sm">{entry.strategyName}</p>
                    <p className="text-xs text-text-muted">by {entry.trader}</p>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <div className="text-text-primary font-medium text-sm">{entry.symbol}</div>
                    <div className="text-xs text-text-muted">{entry.timeframe}</div>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <div className="flex justify-center">
                      <TrendIcon trend={entry.trend} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-success font-semibold text-sm tabular-nums">+{entry.totalReturn.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                    <span className="text-text-primary font-medium text-sm tabular-nums">{entry.sharpeRatio.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-14 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${entry.overallScore >= 80 ? 'bg-success' : entry.overallScore >= 60 ? 'bg-accent' : 'bg-warning'}`}
                          style={{ width: `${entry.overallScore}%` }}
                        />
                      </div>
                      <span className="text-text-primary font-semibold text-sm tabular-nums w-7">{entry.overallScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <button className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-accent transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
