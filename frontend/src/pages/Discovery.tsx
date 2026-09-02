/**
 * Discovery Dashboard — history of SearchRuns + entry points to the
 * existing real Discovery flow (/strategy → /search/:id).
 *
 * IMPORTANT:
 *   - This page is INTENTIONALLY a thin dashboard. It does NOT
 *     reimplement the Search engine.
 *   - Strategy cards load real strategies from GET /api/strategies
 *     and navigate to the existing /strategy/:strategyId flow.
 *   - SearchRun history is loaded from GET /api/search.
 *   - The old fake progress simulation has been removed.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HelpCircle,
  Bell,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  History,
  Award,
  Layers,
  TrendingUp,
  Activity,
  BarChart2,
  Zap,
  Loader2,
} from 'lucide-react';
import {
  fetchSearchRuns,
  type SearchRunListItem,
} from '../services/searchApi';
import {
  fetchStrategies,
  type StrategyListItem,
} from '../services/strategyApi';

export default function Discovery() {
  const navigate = useNavigate();

  // ── SearchRun history state ────────────────────────────────────────
  const [runs, setRuns] = useState<SearchRunListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  // ── Real strategies (replaces hardcoded indicators) ───────────────
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await fetchSearchRuns({ limit: 50 });
      setRuns(data);
    } catch (err) {
      setRunsError((err as Error).message ?? 'Failed to load search runs.');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    setStrategiesError(null);
    try {
      const result = await fetchStrategies();
      setStrategies([...result.strategies]);
    } catch (err) {
      setStrategiesError((err as Error).message ?? 'Failed to load strategies.');
    } finally {
      setStrategiesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    void loadStrategies();
  }, [loadRuns, loadStrategies]);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Discovery Dashboard</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Xem lại các SearchRun trước và bắt đầu một Discovery mới từ Strategy Library.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Nguồn dữ liệu: Binance API + WebSocket</span>
          </div>
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Strategy entry points — load from real GET /api/strategies */}
        <div className="flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>Strategies (System Registry)</span>
                <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
              </h3>
              <button
                onClick={() => void loadStrategies()}
                disabled={strategiesLoading}
                className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${strategiesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {strategiesError && (
              <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{strategiesError}</span>
              </div>
            )}

            {strategiesLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-semibold">Đang tải...</span>
              </div>
            ) : strategies.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-slate-400">
                <Layers className="w-6 h-6 opacity-40" />
                <span className="text-xs font-semibold">Chưa có strategy nào.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {strategies.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/strategy/${encodeURIComponent(s.id)}`)}
                    className="group flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:border-blue-200 bg-slate-50/50 hover:bg-white text-left transition-all hover:shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-9 h-9 rounded-lg font-bold text-xs flex items-center justify-center border ${familyBadge(s.family)}`}>
                        {familyInitials(s.name)}
                      </span>
                      <div className="flex flex-col text-left">
                        <span className="text-xs font-extrabold text-slate-800">{s.name}</span>
                        <span className="text-[10px] text-slate-400 font-semibold mt-0.5 leading-tight">
                          {s.description ?? `Family: ${s.family}`}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono mt-0.5">{s.id}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            <div className="text-[10px] text-slate-400 font-semibold leading-relaxed pt-2 border-t border-slate-100">
              Mỗi card dẫn tới <span className="font-mono">/strategy/:id</span> — nơi bạn cấu hình parameters và Run Discovery.
            </div>
          </article>
        </div>

        {/* Middle: Discovery Run History */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <History className="w-4 h-4 text-blue-500" />
                <span>Discovery Run History</span>
                {!runsLoading && !runsError && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ml-1">
                    {runs.length} run{runs.length !== 1 ? 's' : ''}
                  </span>
                )}
              </h3>
              <button
                onClick={() => void loadRuns()}
                disabled={runsLoading}
                className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runsLoading ? 'animate-spin' : ''}`} />
                <span>Tải lại</span>
              </button>
            </div>

            {runsError ? (
              <div className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{runsError}</span>
              </div>
            ) : runsLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-semibold">Đang tải...</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-slate-400">
                <Award className="w-8 h-8 opacity-40" />
                <span className="text-sm font-bold text-slate-500">Chưa có Discovery nào.</span>
                <span className="text-[11px] text-slate-400 max-w-xs text-center leading-relaxed">
                  Mở một strategy ở cột trái, cấu hình parameters rồi bấm "Run Discovery" để tạo SearchRun đầu tiên.
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-xs font-bold text-slate-600 text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider">
                      <th className="py-3 px-3">Strategy / Status</th>
                      <th className="py-3 px-3">Symbol</th>
                      <th className="py-3 px-3">Timeframe</th>
                      <th className="py-3 px-3 text-right">Candidates</th>
                      <th className="py-3 px-3">Created</th>
                      <th className="py-3 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-slate-800 font-extrabold">{run.algorithm.name}</span>
                            <StatusBadge status={run.status} />
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                          {run.symbol.symbol}
                        </td>
                        <td className="py-3 px-3 text-slate-500 font-semibold">{run.timeframe}</td>
                        <td className="py-3 px-3 text-right text-slate-700 font-extrabold">{run.candidateCount}</td>
                        <td className="py-3 px-3 text-slate-500 font-medium">
                          {new Date(run.createdAt).toLocaleString('vi-VN', { hour12: false })}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => navigate(`/search/${encodeURIComponent(run.id)}`)}
                            disabled={run.candidateCount === 0}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            View Results
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          {/* Quick info box about how Discovery works */}
          <article className="bg-blue-50/40 border border-blue-100/60 p-4 rounded-2xl text-[11px] text-slate-600 leading-relaxed flex gap-3">
            <HelpCircle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-extrabold text-slate-800 mb-1">Cách tạo một Discovery mới</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Mở một strategy ở cột trái.</li>
                <li>Cấu hình parameters và validate.</li>
                <li>Chọn symbol, algorithm, maxCandidates ở panel "Run Discovery".</li>
                <li>Bấm <span className="font-bold text-blue-700">Run Discovery</span> — SearchRun sẽ xuất hiện trong bảng trên.</li>
                <li>Bấm <span className="font-bold text-blue-700">View Results</span> để xem candidates và chạy Backtest.</li>
              </ol>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    DONE: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: 'DONE' },
    STOPPED: { cls: 'bg-amber-50 text-amber-700 border-amber-100', label: 'STOPPED' },
    FAILED: { cls: 'bg-red-50 text-red-700 border-red-100', label: 'FAILED' },
    RUNNING: { cls: 'bg-blue-50 text-blue-700 border-blue-100', label: 'RUNNING' },
    PENDING: { cls: 'bg-slate-50 text-slate-700 border-slate-100', label: 'PENDING' },
  };
  const v = map[status] ?? { cls: 'bg-slate-50 text-slate-700 border-slate-100', label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border w-fit ${v.cls}`}>
      {v.label}
    </span>
  );
}

function familyBadge(family: string): string {
  const f = family.toUpperCase();
  if (f.includes('TREND')) return 'bg-blue-50 text-blue-600 border-blue-100';
  if (f.includes('MOMENTUM')) return 'bg-purple-50 text-purple-600 border-purple-100';
  if (f.includes('STRUCTURE')) return 'bg-amber-50 text-amber-600 border-amber-100';
  if (f.includes('VOLATILITY')) return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
}

function familyInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
