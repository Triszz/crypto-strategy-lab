import { useState } from 'react';
import { Plus, Search, Filter, MoreVertical, Trash2, Play, FlaskConical, Sparkles } from 'lucide-react';

interface Strategy {
  id: string;
  name: string;
  description: string;
  type: 'single' | 'composite';
  family: string;
  params: Record<string, number>;
  isActive: boolean;
  createdAt: string;
  backtests: number;
  performance: number;
}

const mockStrategies: Strategy[] = [
  {
    id: '1',
    name: 'MA20 + RSI14',
    description: 'Moving average crossover with RSI confirmation',
    type: 'composite',
    family: 'MA, RSI',
    params: { fastPeriod: 20, slowPeriod: 50, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70 },
    isActive: true,
    createdAt: '2024-01-15',
    backtests: 12,
    performance: 18.2,
  },
  {
    id: '2',
    name: 'Bollinger Bands',
    description: 'Mean reversion using volatility bands',
    type: 'single',
    family: 'BB',
    params: { bbPeriod: 20, bbStdDev: 2 },
    isActive: true,
    createdAt: '2024-01-10',
    backtests: 8,
    performance: 12.4,
  },
  {
    id: '3',
    name: 'RSI Strategy',
    description: 'Oversold/overbought reversal strategy',
    type: 'single',
    family: 'RSI',
    params: { rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70 },
    isActive: false,
    createdAt: '2024-01-08',
    backtests: 5,
    performance: -3.2,
  },
  {
    id: '4',
    name: 'MA Crossover',
    description: 'Classic dual moving average system',
    type: 'single',
    family: 'MA',
    params: { fastPeriod: 20, slowPeriod: 50 },
    isActive: true,
    createdAt: '2024-01-05',
    backtests: 15,
    performance: 24.6,
  },
  {
    id: '5',
    name: 'Support & Resistance',
    description: 'Breakout strategy at key levels',
    type: 'single',
    family: 'SR',
    params: { lookbackPeriod: 50, tolerance: 0.02 },
    isActive: false,
    createdAt: '2024-01-03',
    backtests: 3,
    performance: 7.8,
  },
];

const indicatorTypes = [
  { code: 'MA', name: 'Moving Average', category: 'Trend' },
  { code: 'RSI', name: 'RSI', category: 'Momentum' },
  { code: 'BB', name: 'Bollinger Bands', category: 'Volatility' },
  { code: 'SR', name: 'Support & Resistance', category: 'Structure' },
];

export default function StrategyPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const strategies = mockStrategies;

  const filteredStrategies = strategies.filter(s =>
    (s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
     s.family.toLowerCase().includes(searchQuery.toLowerCase())) &&
    (activeCategory === 'all' || s.family.includes(activeCategory))
  );

  const handleDelete = (id: string) => console.log('Delete strategy:', id);
  const handleToggleActive = (id: string) => console.log('Toggle active:', id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Strategy Management</h2>
          <p className="text-sm text-text-muted mt-1">Create and manage trading strategies</p>
        </div>
        <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all shadow-sm shadow-accent/20">
          <Plus className="w-4 h-4" />
          Create Strategy
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Total Strategies</p>
          <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{strategies.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Active</p>
          <p className="text-2xl font-bold text-success mt-1 tabular-nums">{strategies.filter(s => s.isActive).length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Total Backtests</p>
          <p className="text-2xl font-bold text-text-primary mt-1 tabular-nums">{strategies.reduce((sum, s) => sum + s.backtests, 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted font-medium">Best Score</p>
          <p className="text-2xl font-bold text-accent mt-1 tabular-nums">94</p>
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
            placeholder="Search strategies..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-bg-card border border-border rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
            activeCategory === 'all'
              ? 'bg-accent text-white border-accent shadow-sm shadow-accent/20'
              : 'bg-bg-card text-text-secondary border-border hover:border-accent/40 hover:text-accent'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          All
        </button>
        {indicatorTypes.map((indicator) => (
          <button
            key={indicator.code}
            onClick={() => setActiveCategory(indicator.code)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
              activeCategory === indicator.code
                ? 'bg-accent text-white border-accent shadow-sm shadow-accent/20'
                : 'bg-bg-card text-text-secondary border-border hover:border-accent/40 hover:text-accent'
            }`}
          >
            {indicator.name}
          </button>
        ))}
      </div>

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStrategies.map((strategy) => (
          <div
            key={strategy.id}
            className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card p-5 hover:border-accent/40 hover:shadow-xl hover:shadow-accent/5 transition-all"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

            <div className="relative">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${
                    strategy.isActive
                      ? 'bg-accent-muted border-accent/30'
                      : 'bg-bg-secondary border-border'
                  }`}>
                    <FlaskConical className={`w-5 h-5 ${strategy.isActive ? 'text-accent' : 'text-text-muted'}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text-primary text-sm">{strategy.name}</h3>
                    <p className="text-xs text-text-muted capitalize mt-0.5">{strategy.type} Strategy</p>
                  </div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-text-secondary mb-4 line-clamp-2">{strategy.description}</p>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {strategy.family.split(', ').map((f) => (
                  <span
                    key={f}
                    className="px-2 py-0.5 rounded-md bg-accent-muted text-accent text-xs font-semibold"
                  >
                    {f}
                  </span>
                ))}
              </div>

              <div className="mb-4 p-3 rounded-xl bg-bg-secondary/50 border border-border/40">
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Parameters</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {Object.entries(strategy.params).slice(0, 4).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-xs">
                      <span className="text-text-muted">{key}</span>
                      <span className="text-text-primary font-semibold tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{strategy.backtests} tests</span>
                  <span className="w-1 h-1 rounded-full bg-text-muted" />
                  <span>{strategy.createdAt}</span>
                </div>
                <span className={`text-xs font-semibold tabular-nums ${
                  strategy.performance >= 0 ? 'text-success' : 'text-danger'
                }`}>
                  {strategy.performance >= 0 ? '+' : ''}{strategy.performance}%
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <button
                  onClick={() => handleToggleActive(strategy.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    strategy.isActive
                      ? 'bg-success-muted text-success'
                      : 'bg-bg-secondary text-text-muted'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${strategy.isActive ? 'bg-success' : 'bg-text-muted'}`} />
                  {strategy.isActive ? 'Active' : 'Inactive'}
                </button>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 rounded-lg bg-bg-secondary text-text-muted hover:text-accent hover:bg-accent-muted transition-colors">
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(strategy.id)}
                    className="p-1.5 rounded-lg bg-bg-secondary text-text-muted hover:text-danger hover:bg-danger-muted transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredStrategies.length === 0 && (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-border flex items-center justify-center mx-auto mb-4">
            <Search className="w-7 h-7 text-text-muted" />
          </div>
          <h3 className="text-base font-semibold text-text-primary mb-1">No strategies found</h3>
          <p className="text-sm text-text-muted mb-4">Create your first strategy to get started</p>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" />
            Create Strategy
          </button>
        </div>
      )}
    </div>
  );
}
