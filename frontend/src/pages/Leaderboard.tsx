/**
 * Leaderboard Page — Displays Top-K Ranked Trading Strategies.
 *
 * Features:
 * - Real REST API fetching via `fetchTopKLeaderboard({ symbol, timeframe, strategyType, sortBy })`
 * - Realtime updates via WebSocket event `LeaderboardUpdated`
 * - Dynamic Sorting dropdown (Overall Score, Return %, Winrate %, Max Drawdown, Sharpe)
 * - Strategy Type Filter (BASE vs COMPOSITE)
 * - Rank Badges (🥇 Gold, 🥈 Silver, 🥉 Bronze)
 * - Modal to view `RankingHistory` graph/timeline for any strategy
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Trophy,
  ChevronDown,
  RefreshCw,
  HelpCircle,
  Bell,
  History,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import {
  fetchTopKLeaderboard,
  fetchLeaderboardHistory,
  type LeaderboardItemApi,
  type RankingHistoryItemApi,
  type LeaderboardFilterParams,
} from '../lib/leaderboardApi';
import { on, connect } from '../lib/socket';
import { HttpError } from '../lib/http';

export default function Leaderboard() {
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [timeframeFilter, setTimeframeFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [sortByFilter, setSortByFilter] = useState<LeaderboardFilterParams['sortBy']>('overallScore');

  const [leaderboard, setLeaderboard] = useState<LeaderboardItemApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // History modal state
  const [selectedStrategyForHistory, setSelectedStrategyForHistory] = useState<LeaderboardItemApi | null>(null);
  const [historyItems, setHistoryItems] = useState<RankingHistoryItemApi[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTopKLeaderboard({
        symbol: symbolFilter === 'ALL' ? undefined : symbolFilter,
        timeframe: timeframeFilter === 'ALL' ? undefined : timeframeFilter,
        strategyType: typeFilter === 'ALL' ? undefined : typeFilter,
        sortBy: sortByFilter,
        limit: 20,
      });
      setLeaderboard(data);
    } catch (err) {
      const msg = err instanceof HttpError ? `[${err.status}] ${err.message}` : (err as Error).message;
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [symbolFilter, timeframeFilter, typeFilter, sortByFilter]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  // WebSocket realtime update listener
  useEffect(() => {
    connect();
    const off = on('LeaderboardUpdated', () => {
      void loadLeaderboard();
    });
    return () => {
      off();
    };
  }, [loadLeaderboard]);

  const handleOpenHistoryModal = async (item: LeaderboardItemApi) => {
    setSelectedStrategyForHistory(item);
    setHistoryLoading(true);
    try {
      const history = await fetchLeaderboardHistory(item.strategyVersionId);
      setHistoryItems(history);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const top1 = leaderboard[0];
  const top2 = leaderboard[1];
  const top3 = leaderboard[2];

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto text-left font-sans">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            Bảng Xếp Hạng Chiến Lược (Leaderboard)
          </h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Xếp hạng các chiến lược đơn lẻ (Base) & kết hợp (Composite) tốt nhất (Cập nhật realtime qua WebSocket)
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Leaderboard Module v2 · Dynamic Sort Active</span>
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

      {/* Filter Control Bar */}
      <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap gap-5 items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Sort By Dropdown */}
          <div className="flex items-center gap-2 bg-blue-50/70 border border-blue-200/60 px-3 py-1.5 rounded-xl">
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600" />
            <label className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider">Sắp xếp theo:</label>
            <div className="relative">
              <select
                value={sortByFilter}
                onChange={(e) => setSortByFilter(e.target.value as LeaderboardFilterParams['sortBy'])}
                className="appearance-none px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-xs font-black text-blue-900 pr-7 cursor-pointer"
              >
                <option value="overallScore">Overall Score</option>
                <option value="totalReturn">Total Return (%)</option>
                <option value="winRate">Win Rate (%)</option>
                <option value="maxDrawdown">Max Drawdown (Nhỏ nhất)</option>
                <option value="sharpeRatio">Sharpe Ratio</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-blue-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Strategy Type Filter */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loại chiến lược:</label>
            <div className="relative">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="appearance-none px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 pr-8 cursor-pointer"
              >
                <option value="ALL">Tất cả (Base & Composite)</option>
                <option value="BASE">🧩 Chỉ Base Strategy</option>
                <option value="COMPOSITE">🔗 Chỉ Composite Strategy</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Coin Filter */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cặp tiền:</label>
            <div className="relative">
              <select
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="appearance-none px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 pr-8 cursor-pointer"
              >
                <option value="ALL">Tất cả (ALL)</option>
                <option value="BTCUSDT">BTCUSDT</option>
                <option value="ETHUSDT">ETHUSDT</option>
                <option value="SOLUSDT">SOLUSDT</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Timeframe Filter */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Timeframe:</label>
            <div className="relative">
              <select
                value={timeframeFilter}
                onChange={(e) => setTimeframeFilter(e.target.value)}
                className="appearance-none px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 pr-8 cursor-pointer"
              >
                <option value="ALL">Tất cả (ALL)</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="4h">4h</option>
                <option value="1d">1d</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        <button
          onClick={() => void loadLeaderboard()}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-all cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Làm mới Bảng xếp hạng</span>
        </button>
      </section>

      {/* Top 3 Podium Cards */}
      {leaderboard.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Rank 2 - Silver */}
          {top2 ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-slate-200/50 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex justify-between items-start">
                <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 font-black text-sm flex items-center justify-center border border-slate-200 shadow-xs">
                  🥈 #2
                </span>
                <div className="flex items-center gap-1.5">
                  <TypeBadge type={top2.strategyType} />
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    Score: {top2.overallScore}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <h4 className="text-base font-extrabold text-slate-900">{top2.strategyName}</h4>
                <div className="text-[11px] text-slate-400 font-semibold mt-0.5">{top2.symbolCode} · {top2.timeframe}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs font-bold">
                <div>Return: <span className={top2.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}>{top2.totalReturn}%</span></div>
                <div>Winrate: <span className="text-slate-800">{top2.winRate}%</span></div>
              </div>
            </div>
          ) : <div />}

          {/* Rank 1 - Gold Podium */}
          {top1 ? (
            <div className="bg-gradient-to-b from-amber-500/10 via-white to-white p-6 rounded-2xl border-2 border-amber-400 shadow-md flex flex-col justify-between relative overflow-hidden transform md:-translate-y-2">
              <div className="absolute top-0 right-0 w-28 h-28 bg-gradient-to-bl from-amber-400/30 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex justify-between items-start">
                <span className="w-12 h-12 rounded-2xl bg-amber-500 text-white font-black text-lg flex items-center justify-center shadow-md shadow-amber-200">
                  🥇 #1
                </span>
                <div className="flex items-center gap-1.5">
                  <TypeBadge type={top1.strategyType} />
                  <span className="text-xs font-black px-3 py-1 rounded-full bg-amber-500 text-white shadow-xs">
                    Score: {top1.overallScore}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">QUÁN QUÂN HIGHEST SCORE</span>
                <h3 className="text-lg font-black text-slate-900 mt-0.5">{top1.strategyName}</h3>
                <div className="text-xs text-slate-500 font-bold mt-0.5">{top1.symbolCode} · {top1.timeframe}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-amber-100 text-xs font-black text-center">
                <div className="bg-amber-50/60 p-2 rounded-xl border border-amber-100">
                  <span className="text-[9px] text-amber-600 block">TOTAL RETURN</span>
                  <span className={top1.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}>{top1.totalReturn}%</span>
                </div>
                <div className="bg-amber-50/60 p-2 rounded-xl border border-amber-100">
                  <span className="text-[9px] text-amber-600 block">WINRATE</span>
                  <span className="text-slate-800">{top1.winRate}%</span>
                </div>
                <div className="bg-amber-50/60 p-2 rounded-xl border border-amber-100">
                  <span className="text-[9px] text-amber-600 block">DRAWDOWN</span>
                  <span className="text-red-500">-{top1.maxDrawdown}%</span>
                </div>
              </div>
            </div>
          ) : <div />}

          {/* Rank 3 - Bronze */}
          {top3 ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-700/10 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex justify-between items-start">
                <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 font-black text-sm flex items-center justify-center border border-amber-200 shadow-xs">
                  🥉 #3
                </span>
                <div className="flex items-center gap-1.5">
                  <TypeBadge type={top3.strategyType} />
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Score: {top3.overallScore}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <h4 className="text-base font-extrabold text-slate-900">{top3.strategyName}</h4>
                <div className="text-[11px] text-slate-400 font-semibold mt-0.5">{top3.symbolCode} · {top3.timeframe}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs font-bold">
                <div>Return: <span className={top3.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}>{top3.totalReturn}%</span></div>
                <div>Winrate: <span className="text-slate-800">{top3.winRate}%</span></div>
              </div>
            </div>
          ) : <div />}
        </section>
      )}

      {/* Main Leaderboard Table */}
      <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <span>Bảng Xếp Hạng Chi Tiết ({leaderboard.length} chiến lược)</span>
          </h3>
          <span className="text-xs font-bold text-blue-600">
            Sắp xếp theo: {sortByLabel(sortByFilter)}
          </span>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs font-bold rounded-xl">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-xs font-bold text-slate-600 text-left">
            <thead className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider uppercase">
              <tr>
                <th className="py-3 px-4 text-center">Thứ Hạng</th>
                <th className="py-3 px-3 text-center">Loại</th>
                <th className="py-3 px-4">Tên Chiến Lược</th>
                <th className="py-3 px-3">Cặp Coin</th>
                <th className="py-3 px-3">Timeframe</th>
                <th className="py-3 px-3 text-right">Total Return</th>
                <th className="py-3 px-3 text-right">Win Rate</th>
                <th className="py-3 px-3 text-right">Max Drawdown</th>
                <th className="py-3 px-3 text-right">Số Lệnh</th>
                <th className="py-3 px-4 text-right">Overall Score</th>
                <th className="py-3 px-4 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400 font-semibold">
                    Đang tải dữ liệu Bảng xếp hạng...
                  </td>
                </tr>
              ) : leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400 font-semibold">
                    Chưa có chiến lược nào phù hợp với bộ lọc. Hãy chạy Backtest để đẩy dữ liệu lên Leaderboard!
                  </td>
                </tr>
              ) : (
                leaderboard.map((item) => (
                  <tr key={item.id || item.strategyVersionId} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${
                        item.rank === 1 ? 'bg-amber-500 text-white shadow-xs' :
                        item.rank === 2 ? 'bg-slate-300 text-slate-800' :
                        item.rank === 3 ? 'bg-amber-700 text-white' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        #{item.rank}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <TypeBadge type={item.strategyType} />
                    </td>
                    <td className="py-3 px-4 font-black text-slate-900">
                      {item.strategyName}
                      <span className="text-[9px] font-mono text-slate-400 block font-normal">v{item.strategyVersion}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">{item.symbolCode}</td>
                    <td className="py-3 px-3 text-slate-500">{item.timeframe}</td>
                    <td className={`py-3 px-3 text-right font-extrabold ${item.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {item.totalReturn >= 0 ? '+' : ''}{item.totalReturn}%
                    </td>
                    <td className="py-3 px-3 text-right text-slate-800">{item.winRate}%</td>
                    <td className="py-3 px-3 text-right text-red-500">-{item.maxDrawdown}%</td>
                    <td className="py-3 px-3 text-right text-slate-700">{item.numTrades}</td>
                    <td className="py-3 px-4 text-right font-black text-blue-600 text-sm">
                      {item.overallScore}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => void handleOpenHistoryModal(item)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-600 text-[10px] font-extrabold transition-colors cursor-pointer flex items-center justify-center gap-1 mx-auto"
                      >
                        <History className="w-3 h-3" />
                        <span>Xem Lịch Sử</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>

      {/* History Modal */}
      {selectedStrategyForHistory && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-2xl max-w-lg w-full flex flex-col gap-4 text-left">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">Lịch sử Xếp hạng (Ranking History)</h4>
                <p className="text-xs text-slate-400 font-semibold">{selectedStrategyForHistory.strategyName} ({selectedStrategyForHistory.symbolCode})</p>
              </div>
              <button
                onClick={() => setSelectedStrategyForHistory(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {historyLoading ? (
              <div className="py-8 text-center text-slate-400 font-semibold">Đang tải lịch sử...</div>
            ) : historyItems.length === 0 ? (
              <div className="py-8 text-center text-slate-400 font-semibold">Chưa có lịch sử thay đổi thứ hạng.</div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <table className="w-full text-xs font-bold text-slate-600 text-left">
                  <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                    <tr>
                      <th className="py-2 px-3">Thời gian</th>
                      <th className="py-2 px-3 text-center">Rank</th>
                      <th className="py-2 px-3 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyItems.map((h) => (
                      <tr key={h.id} className="border-b border-slate-50">
                        <td className="py-2 px-3 text-slate-500 font-medium">
                          {new Date(h.snapshotAt).toLocaleString('vi-VN')}
                        </td>
                        <td className="py-2 px-3 text-center font-black text-blue-600">#{h.rank}</td>
                        <td className="py-2 px-3 text-right font-extrabold text-slate-800">{h.overallScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type?: string }) {
  const isComposite = type === 'COMPOSITE';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded border ${
        isComposite
          ? 'bg-purple-50 text-purple-700 border-purple-200'
          : 'bg-blue-50 text-blue-700 border-blue-200'
      }`}
    >
      {isComposite ? '🔗 COMPOSITE' : '🧩 BASE'}
    </span>
  );
}

function sortByLabel(sortBy?: string): string {
  switch (sortBy) {
    case 'totalReturn':
      return 'Total Return (%)';
    case 'winRate':
      return 'Win Rate (%)';
    case 'maxDrawdown':
      return 'Max Drawdown (Nhỏ nhất)';
    case 'sharpeRatio':
      return 'Sharpe Ratio';
    default:
      return 'Overall Score DESC';
  }
}
