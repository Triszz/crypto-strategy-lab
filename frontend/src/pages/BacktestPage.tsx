import { useState } from 'react';
import { Play, Search, Filter, CheckCircle, XCircle, Clock, RefreshCw, ArrowUpDown } from 'lucide-react';

interface ExperimentResult {
  totalReturn: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  numTrades: number;
  overallScore: number;
}

interface Experiment {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number;
  fromTime: string;
  toTime: string;
  result?: ExperimentResult;
  createdAt: string;
}

const mockExperiments: Experiment[] = [
  {
    id: 'exp-1', strategyName: 'MA20 + RSI14', symbol: 'BTCUSDT', timeframe: '1h',
    status: 'completed', fromTime: '2024-01-01', toTime: '2024-03-31',
    result: { totalReturn: 18.2, winRate: 61.4, maxDrawdown: -6.1, sharpeRatio: 2.34, numTrades: 45, overallScore: 82 },
    createdAt: '2024-01-15 10:30',
  },
  {
    id: 'exp-2', strategyName: 'Bollinger Bands', symbol: 'ETHUSDT', timeframe: '4h',
    status: 'completed', fromTime: '2024-01-01', toTime: '2024-03-31',
    result: { totalReturn: 12.4, winRate: 58.2, maxDrawdown: -8.3, sharpeRatio: 1.87, numTrades: 32, overallScore: 71 },
    createdAt: '2024-01-14 14:20',
  },
  {
    id: 'exp-3', strategyName: 'RSI + SR', symbol: 'BTCUSDT', timeframe: '1d',
    status: 'running', progress: 67, fromTime: '2024-01-01', toTime: '2024-06-30',
    createdAt: '2024-01-15 09:00',
  },
  {
    id: 'exp-4', strategyName: 'MA Crossover', symbol: 'SOLUSDT', timeframe: '1h',
    status: 'completed', fromTime: '2024-02-01', toTime: '2024-04-30',
    result: { totalReturn: 24.6, winRate: 63.8, maxDrawdown: -5.2, sharpeRatio: 2.89, numTrades: 28, overallScore: 89 },
    createdAt: '2024-01-13 11:45',
  },
  {
    id: 'exp-5', strategyName: 'Support & Resistance', symbol: 'BNBUSDT', timeframe: '1h',
    status: 'failed', fromTime: '2024-01-01', toTime: '2024-02-28',
    createdAt: '2024-01-12 16:00',
  },
];

const statusConfig = {
  queued: { color: 'bg-text-muted', text: 'Queued', icon: Clock, badge: 'badge bg-bg-secondary text-text-muted' },
  running: { color: 'bg-warning', text: 'Running', icon: RefreshCw, badge: 'badge bg-warning-muted text-warning' },
  completed: { color: 'bg-success', text: 'Completed', icon: CheckCircle, badge: 'badge bg-success-muted text-success' },
  failed: { color: 'bg-danger', text: 'Failed', icon: XCircle, badge: 'badge bg-danger-muted text-danger' },
};

type SortKey = 'strategyName' | 'createdAt' | 'totalReturn' | 'winRate' | 'maxDrawdown' | 'sharpeRatio' | 'numTrades' | 'overallScore';

export default function BacktestPage() {
  const [experiments] = useState<Experiment[]>(mockExperiments);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const filteredExperiments = experiments
    .filter(exp =>
      (exp.strategyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
       exp.symbol.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (statusFilter === 'all' || exp.status === statusFilter)
    )
    .sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      if (sortBy === 'strategyName') { aVal = a.strategyName; bVal = b.strategyName; }
      else if (sortBy === 'createdAt') { aVal = a.createdAt; bVal = b.createdAt; }
      else { aVal = a.result?.[sortBy as keyof ExperimentResult]; bVal = b.result?.[sortBy as keyof ExperimentResult]; }

      if (aVal === undefined || aVal === null) return 1;
      if (bVal === undefined || bVal === null) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

  const handleSort = (column: SortKey) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const bestScore = experiments.filter(e => e.result).length > 0
    ? Math.max(...experiments.filter(e => e.result).map(e => e.result!.overallScore))
    : 0;

  const statusFilters = [
    { key: 'all', label: 'All' },
    { key: 'completed', label: 'Completed' },
    { key: 'running', label: 'Running' },
    { key: 'failed', label: 'Failed' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Backtest Results</h2>
          <p className="text-sm text-text-muted mt-1">Run and analyze strategy backtests</p>
        </div>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all shadow-sm shadow-accent/20">
          <Play className="w-4 h-4" />
          New Backtest
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Total Experiments</p>
          <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{experiments.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Completed</p>
          <p className="text-2xl font-bold text-success mt-1 tabular-nums">{experiments.filter(e => e.status === 'completed').length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Running</p>
          <p className="text-2xl font-bold text-warning mt-1 tabular-nums">{experiments.filter(e => e.status === 'running').length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Best Score</p>
          <p className="text-2xl font-bold text-accent mt-1 tabular-nums">{bestScore}</p>
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
            placeholder="Search by strategy or symbol..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Status Tabs */}
      <div className="inline-flex items-center gap-1 p-1 bg-bg-card border border-border rounded-xl">
        {statusFilters.map(filter => (
          <button
            key={filter.key}
            onClick={() => setStatusFilter(filter.key)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              statusFilter === filter.key
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg-secondary/30">
                <th onClick={() => handleSort('strategyName')} className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors">
                  <div className="flex items-center gap-2">Strategy <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Symbol / TF
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th onClick={() => handleSort('totalReturn')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors">
                  <div className="flex items-center justify-end gap-2">Return <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th onClick={() => handleSort('winRate')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors hidden md:table-cell">
                  <div className="flex items-center justify-end gap-2">Win Rate <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th onClick={() => handleSort('maxDrawdown')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors hidden md:table-cell">
                  <div className="flex items-center justify-end gap-2">Max DD <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th onClick={() => handleSort('sharpeRatio')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors hidden lg:table-cell">
                  <div className="flex items-center justify-end gap-2">Sharpe <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th onClick={() => handleSort('overallScore')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors">
                  <div className="flex items-center justify-end gap-2">Score <ArrowUpDown className="w-3 h-3" /></div>
                </th>
                <th onClick={() => handleSort('createdAt')} className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors hidden md:table-cell">
                  <div className="flex items-center justify-end gap-2">Date <ArrowUpDown className="w-3 h-3" /></div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredExperiments.map((exp) => {
                const status = statusConfig[exp.status];
                const StatusIcon = status.icon;

                return (
                  <tr key={exp.id} className="hover:bg-bg-hover/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-text-primary text-sm">{exp.strategyName}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-text-primary font-medium text-sm">{exp.symbol}</div>
                      <div className="text-xs text-text-muted">{exp.timeframe}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        exp.status === 'completed' ? 'bg-success-muted text-success' :
                        exp.status === 'running' ? 'bg-warning-muted text-warning' :
                        exp.status === 'failed' ? 'bg-danger-muted text-danger' :
                        'bg-bg-secondary text-text-muted'
                      }`}>
                        <StatusIcon className={`w-3 h-3 ${exp.status === 'running' ? 'animate-spin' : ''}`} />
                        {status.text}
                        {exp.status === 'running' && exp.progress && (
                          <span className="ml-0.5 tabular-nums">{exp.progress}%</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {exp.result ? (
                        <span className={`font-semibold text-sm tabular-nums ${exp.result.totalReturn >= 0 ? 'text-success' : 'text-danger'}`}>
                          {exp.result.totalReturn >= 0 ? '+' : ''}{exp.result.totalReturn.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right hidden md:table-cell">
                      {exp.result ? (
                        <span className="text-text-primary font-medium text-sm tabular-nums">{exp.result.winRate.toFixed(1)}%</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right hidden md:table-cell">
                      {exp.result ? (
                        <span className="text-danger font-medium text-sm tabular-nums">{exp.result.maxDrawdown.toFixed(2)}%</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                      {exp.result ? (
                        <span className="text-text-primary font-medium text-sm tabular-nums">{exp.result.sharpeRatio.toFixed(2)}</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {exp.result ? (
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-14 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${exp.result.overallScore >= 80 ? 'bg-success' : exp.result.overallScore >= 60 ? 'bg-accent' : 'bg-warning'}`}
                              style={{ width: `${exp.result.overallScore}%` }}
                            />
                          </div>
                          <span className="text-text-primary font-semibold text-sm tabular-nums w-7">{exp.result.overallScore}</span>
                        </div>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-text-muted text-xs hidden md:table-cell">
                      {exp.createdAt}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
