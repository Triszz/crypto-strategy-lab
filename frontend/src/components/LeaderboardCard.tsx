/**
 * LeaderboardCard — Compact Leaderboard Widget (Top Strategies).
 *
 * Matching the exact mockup:
 * - Columns: Rank, Strategy (Pills MA + RSI + S/R), Profit (USDT), Winrate
 * - Badges: 🥇 (Gold), 🥈 (Silver), 🥉 (Bronze)
 * - Live updates via Socket.IO `LeaderboardUpdated` event
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import {
  fetchTopKLeaderboard,
  type LeaderboardItemApi,
} from '../lib/leaderboardApi';
import { on, connect } from '../lib/socket';

interface LeaderboardCardProps {
  limit?: number;
  title?: string;
  className?: string;
}

interface TagConfig {
  tag: string;
  cls: string;
}

function getBaseTagKey(part: string): string {
  const lower = part.toLowerCase();
  if (lower.includes('ma') || lower.includes('moving')) return 'MA';
  if (lower.includes('rsi')) return 'RSI';
  if (lower.includes('s/r') || lower.includes('support') || lower.includes('resistance')) return 'S/R';
  if (lower.includes('bollinger') || lower.includes('bb')) return 'Bollinger';
  if (lower.includes('sentiment') || lower.includes('news')) return 'Sentiment';
  return part.trim();
}

function getTagStyle(baseKey: string, rawPart: string): TagConfig {
  switch (baseKey) {
    case 'MA':
      return { tag: 'MA', cls: 'bg-blue-50 text-blue-600 border-blue-100' };
    case 'RSI':
      return { tag: 'RSI', cls: 'bg-purple-50 text-purple-600 border-purple-100' };
    case 'S/R':
      return { tag: 'S/R', cls: 'bg-amber-50 text-amber-600 border-amber-100' };
    case 'Bollinger':
      return { tag: 'Bollinger', cls: 'bg-indigo-50 text-indigo-600 border-indigo-100' };
    case 'Sentiment':
      return { tag: 'Sentiment', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
    default:
      return {
        tag: rawPart.length > 14 ? rawPart.slice(0, 12) + '…' : rawPart,
        cls: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

function parseStrategyTags(name: string): TagConfig[] {
  if (!name || name.trim().length === 0) {
    return [{ tag: 'MA', cls: 'bg-blue-50 text-blue-600 border-blue-100' }];
  }

  // Clean generic generator prefixes
  const cleanName = name
    .replace(/^Domain-guided\s+/i, '')
    .replace(/^Composite:\s+/i, '');

  // Split by '+' or ',' or '-'
  const rawParts = cleanName.split(/[\+,\-]/).map((p) => p.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return [{ tag: cleanName, cls: 'bg-blue-50 text-blue-600 border-blue-100' }];
  }

  // Count total occurrences of each indicator family to distinguish duplicates
  const tagCounts: Record<string, number> = {};
  rawParts.forEach((part) => {
    const key = getBaseTagKey(part);
    tagCounts[key] = (tagCounts[key] || 0) + 1;
  });

  const currentCounts: Record<string, number> = {};

  return rawParts.map((part) => {
    const baseKey = getBaseTagKey(part);
    const totalCount = tagCounts[baseKey] || 0;
    currentCounts[baseKey] = (currentCounts[baseKey] || 0) + 1;
    const idx = currentCounts[baseKey];

    const baseConfig = getTagStyle(baseKey, part);

    let displayTag = baseConfig.tag;
    let customCls = baseConfig.cls;

    // Distinguish MA components specifically: Fast MA vs Slow MA
    if (baseKey === 'MA') {
      if (totalCount > 1) {
        if (idx === 1) {
          displayTag = 'MA (Fast)';
          customCls = 'bg-blue-50 text-blue-600 border-blue-100';
        } else if (idx === 2) {
          displayTag = 'MA (Slow)';
          customCls = 'bg-sky-100 text-sky-800 border-sky-300 font-black';
        } else {
          displayTag = `MA (${idx})`;
        }
      } else if (/\bfast\b/i.test(part)) {
        displayTag = 'MA (Fast)';
      } else if (/\bslow\b/i.test(part)) {
        displayTag = 'MA (Slow)';
      }
    } else if (totalCount > 1) {
      if (/\(|\)|w:|weight|fast|slow/i.test(part)) {
        displayTag = `${baseConfig.tag} (${part})`;
      } else {
        displayTag = `${baseConfig.tag} #${idx}`;
      }
    }

    return {
      tag: displayTag,
      cls: customCls,
    };
  });
}

function formatProfitUsdt(totalReturn: number): string {
  // Assume a standard $10,000 portfolio if decimal return
  // e.g. 0.2342 return -> +$2,342.18 USDT profit
  const returnVal = totalReturn > 5 ? totalReturn / 100 : totalReturn;
  const profitUsdt = returnVal * 10000;
  const sign = profitUsdt >= 0 ? '+' : '';
  return `${sign}${profitUsdt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWinrate(winRate: number): string {
  const pct = winRate <= 1 ? winRate * 100 : winRate;
  return `${pct.toFixed(2)}%`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="w-7 h-7 rounded-full bg-amber-100 border border-amber-300 text-amber-700 font-black text-xs flex items-center justify-center shadow-xs">
        🥇
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="w-7 h-7 rounded-full bg-slate-200 border border-slate-300 text-slate-700 font-black text-xs flex items-center justify-center shadow-xs">
        🥈
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="w-7 h-7 rounded-full bg-amber-200/60 border border-amber-400 text-amber-800 font-black text-xs flex items-center justify-center shadow-xs">
        🥉
      </span>
    );
  }
  return <span className="w-7 text-center font-extrabold text-slate-600 text-xs">{rank}</span>;
}

export default function LeaderboardCard({
  limit = 5,
  title = 'Leaderboard (Top strategies)',
  className = '',
}: LeaderboardCardProps) {
  const [items, setItems] = useState<LeaderboardItemApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchTopKLeaderboard({ limit });
      setItems(data);
    } catch {
      // Fallback empty
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    connect();
    const off = on('LeaderboardUpdated', () => {
      void loadData();
    });
    return () => {
      off();
    };
  }, [loadData]);

  return (
    <article className={`bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 ${className}`}>
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span>{title}</span>
        </h3>
        <button
          onClick={() => void loadData()}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-3 w-16 text-center">Rank</th>
              <th className="py-2.5 px-3">Strategy</th>
              <th className="py-2.5 px-3 text-right">Profit (USDT)</th>
              <th className="py-2.5 px-3 text-right">Winrate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 font-semibold text-slate-700">
            {isLoading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-400 animate-pulse">
                  Đang tải bảng xếp hạng...
                </td>
              </tr>
            )}

            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-400">
                  Chưa có dữ liệu bảng xếp hạng.
                </td>
              </tr>
            )}

            {items.slice(0, limit).map((item, idx) => {
              const rank = item.rank ?? idx + 1;
              const tags = parseStrategyTags(item.strategyName ?? item.strategyVersionId);
              const profitText = formatProfitUsdt(item.totalReturn);
              const winrateText = formatWinrate(item.winRate);

              return (
                <tr key={item.id || idx} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-3 flex justify-center items-center">
                    <RankBadge rank={rank} />
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {tags.map((t, i) => (
                        <span key={i} className="contents">
                          <span
                            className={`px-2 py-0.75 rounded-md font-bold text-[10px] border shadow-2xs ${t.cls}`}
                          >
                            {t.tag}
                          </span>
                          {i < tags.length - 1 && (
                            <span className="text-slate-300 font-bold text-[10px]">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-emerald-600">
                    {profitText}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-700">
                    {winrateText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
