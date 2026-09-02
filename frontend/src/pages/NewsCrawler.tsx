/**
 * News Crawler page — Phase B (wire FE thật).
 *
 * Replaces the Phase 1 mock data with real API + WebSocket calls.
 * - Initial load:  `fetchNews({ symbol })`
 * - Realtime:      `onNewsCollected` appends new items as they arrive.
 * - Manual crawl:  `triggerCrawl(symbol)` triggers a backend crawl.
 *
 * See `Knowledge/specs/01-news-module.md` §7.1 for the contract
 * behind this page, and `Knowledge/specs/05-frontend.md` §7.5 for the
 * refactor checklist.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HelpCircle,
  Bell,
  Play,
  Settings,
  Globe,
  Rss,
  Code,
  Check,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  Inbox,
} from 'lucide-react';

import { fetchNews, triggerCrawl } from '../lib/newsApi';
import { onNewsCollected, connect } from '../lib/socket';
import { newsCollectedToListItem, type NewsItem } from '../types/news';
import { HttpError } from '../lib/http';

/** User-selectable symbol filter. `ALL` disables the filter. */
type SymbolFilter = 'ALL' | 'BTC' | 'ETH' | 'SOL';

const SYMBOL_FILTERS: SymbolFilter[] = ['ALL', 'BTC', 'ETH', 'SOL'];

/** Map base asset → emoji used in the asset pill on each news row. */
function assetIcon(asset: string): string {
  if (asset === 'BTC') return '₿';
  if (asset === 'ETH') return 'Ξ';
  if (asset === 'SOL') return 'S';
  return asset.slice(0, 1).toUpperCase();
}

/** Map base asset → Tailwind color class for the asset pill. */
function assetColor(asset: string): string {
  if (asset === 'BTC') return 'bg-amber-50 text-amber-600 border-amber-100';
  if (asset === 'ETH') return 'bg-blue-50 text-blue-600 border-blue-100';
  if (asset === 'SOL') return 'bg-purple-50 text-purple-600 border-purple-100';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

/** Format an ISO timestamp as `HH:MM` for the news row chip. */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Pull the first available sentiment for a news row (Phase B placeholder). */
function inferSentiment(item: NewsItem): 'positive' | 'neutral' | 'negative' {
  // The real sentiment arrives via the Sentiment module (Phase B Day 2).
  // For now, infer a coarse signal from the title so the chip has a colour.
  const t = item.title.toLowerCase();
  const pos = ['surge', 'rally', 'gain', 'bull', 'ath', 'inflow', 'adoption', 'approval', 'partnership', 'pump', 'high'];
  const neg = ['crash', 'hack', 'drop', 'fall', 'bear', 'dump', 'ban', 'lawsuit', 'liquidation', 'panic', 'collapse'];
  if (pos.some((w) => t.includes(w))) return 'positive';
  if (neg.some((w) => t.includes(w))) return 'negative';
  return 'neutral';
}

export default function NewsCrawler() {
  const navigate = useNavigate();

  // Filter state — drives both REST fetch and WS subscriber callback.
  const [symbolFilter, setSymbolFilter] = useState<SymbolFilter>('ALL');

  // News feed state.
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalNews, setTotalNews] = useState(0);

  // Crawl state.
  const [isCrawling, setIsCrawling] = useState(false);
  const [lastCrawlMessage, setLastCrawlMessage] = useState<string | null>(null);

  // Sentiment gauge — left as Phase B Day 2 (Sentiment module).
  // We animate it when the WS fires so the page "feels live".
  const [posPct, setPosPct] = useState(58);
  const [negPct, setNegPct] = useState(15);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const neuPct = Math.max(0, 100 - posPct - negPct);

  // UI-only state (LLM extraction template — out of scope for News phase).
  const [sources] = useState<string[]>(['Website']);
  const [selfHealingActive, setSelfHealingActive] = useState(true);
  const [refreshInterval] = useState('1m'); // Phase C: env-driven

  // Track the latest in-flight filter so stale responses don't overwrite
  // a newer one. Without this, switching BTC → ETH quickly could leave
  // the screen showing BTC data (the older response arrives last).
  const inflightRef = useRef(0);

  // ── Initial fetch + refetch on filter change ──────────────────────────
  useEffect(() => {
    const requestId = ++inflightRef.current;
    setIsLoading(true);
    setError(null);

    const ac = new AbortController();
    void (async () => {
      try {
        const symbolParam = symbolFilter === 'ALL' ? undefined : symbolFilter;
        const result = await fetchNews({ symbol: symbolParam, pageSize: 20 });
        if (requestId !== inflightRef.current) return; // stale, ignore
        setNews(result.items);
        setTotalNews(result.total);
        setAnalyzedCount((c) => c + result.items.length); // running tally
      } catch (err) {
        if (requestId !== inflightRef.current) return;
        const msg =
          err instanceof HttpError
            ? `[${err.status}] ${err.message}`
            : (err as Error).message;
        setError(msg);
        setNews([]);
        setTotalNews(0);
      } finally {
        if (requestId === inflightRef.current) setIsLoading(false);
      }
    })();

    return () => ac.abort();
  }, [symbolFilter]);

  // ── WebSocket subscription ────────────────────────────────────────────
  // Ensures the socket singleton has been created (idempotent).
  useEffect(() => {
    connect();
  }, []);

  useEffect(() => {
    const off = onNewsCollected((event) => {
      const newItem = newsCollectedToListItem(event);

      // Apply the same client-side filter the REST query used.
      const matchesFilter =
        symbolFilter === 'ALL' ||
        newItem.coinSymbols.includes(symbolFilter);
      if (!matchesFilter) return;

      setNews((prev) => {
        // De-dupe in case the user triggered both a manual crawl and the
        // cron fired within seconds of each other.
        if (prev.some((p) => p.id === newItem.id)) return prev;
        return [newItem, ...prev].slice(0, 20);
      });
      setTotalNews((t) => t + 1);

      // Bump sentiment gauge heuristically so the right column reacts.
      const s = inferSentiment(newItem);
      if (s === 'positive') {
        setPosPct((p) => Math.min(p + 1, 100));
        setNegPct((p) => Math.max(p - 1, 0));
      } else if (s === 'negative') {
        setPosPct((p) => Math.max(p - 1, 0));
        setNegPct((p) => Math.min(p + 1, 100));
      }
      setAnalyzedCount((c) => c + 1);
    });
    return off;
  }, [symbolFilter]);

  // ── Manual crawl handler ─────────────────────────────────────────────
  const handleStartCrawl = async (): Promise<void> => {
    setIsCrawling(true);
    setError(null);
    setLastCrawlMessage(null);
    try {
      const symbolParam = symbolFilter === 'ALL' ? undefined : symbolFilter;
      const res = await triggerCrawl(symbolParam);
      setLastCrawlMessage(
        res.count > 0
          ? `Thu thập được ${res.count} tin mới.`
          : 'Crawl hoàn tất — không có tin mới.',
      );
      // Re-fetch to pick up provider/externalId/etc. fields that aren't
      // present in the WS broadcast payload.
      const list = await fetchNews({
        symbol: symbolParam,
        pageSize: 20,
      });
      setNews(list.items);
      setTotalNews(list.total);
    } catch (err) {
      const msg =
        err instanceof HttpError
          ? `Crawl thất bại [${err.status}]: ${err.message}`
          : `Crawl thất bại: ${(err as Error).message}`;
      setError(msg);
    } finally {
      setIsCrawling(false);
    }
  };

  const toggleSource = (_src: string): void => {
    // Phase C will replace this with a real source switcher (RSS/HTML
    // adapter selection via /api/admin/sources). Left as no-op for now
    // so the UI doesn't bitrot.
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            News Crawler & Phân tích thị trường
          </h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Thu nhập tin tức, hiểu HTML bằng LLM, lưu template và phân tích sentiment
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>BE + WebSocket · Phase B (live)</span>
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

      {/* Crawl Control Panel */}
      <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap gap-6 items-end justify-between">
        <div className="flex flex-wrap gap-6">
          {/* Sources Selector — Phase C wire-up */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Nguồn
            </label>
            <div className="flex gap-2">
              {(['Website', 'RSS', 'HTML'] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => toggleSource(src)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                    sources.includes(src)
                      ? 'border-blue-600 bg-blue-50 text-blue-600'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {src === 'Website' && <Globe className="w-3.5 h-3.5" />}
                  {src === 'RSS' && <Rss className="w-3.5 h-3.5" />}
                  {src === 'HTML' && <Code className="w-3.5 h-3.5" />}
                  <span>{src === 'HTML' ? '</> HTML' : src}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Asset filter (now wired to REST + WS) */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Asset
            </label>
            <div className="relative">
              <select
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value as SymbolFilter)}
                className="appearance-none flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 min-w-[140px] pr-8 cursor-pointer"
              >
                {SYMBOL_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'ALL' ? 'Tất cả' : s}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Auto Refresh (display-only for now) */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Auto refresh (cron)
            </label>
            <div className="flex p-0.75 bg-slate-50 rounded-xl border border-slate-200/80">
              {['1 phút', '2 phút', '3 phút', '4 phút', '5 phút'].map((int) => (
                <button
                  key={int}
                  disabled
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    refreshInterval === int
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 disabled:opacity-60 disabled:cursor-not-allowed'
                  }`}
                >
                  {int}
                </button>
              ))}
            </div>
            <span className="text-[9px] text-slate-400 italic">
              Cron chạy theo biến môi trường NEWS_CRAWL_INTERVAL_MS (mặc định 5 phút).
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => void handleStartCrawl()}
            disabled={isCrawling}
            className="flex items-center gap-2 py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
          >
            <Play className={`w-4 h-4 fill-white ${isCrawling ? 'animate-spin' : ''}`} />
            <span>{isCrawling ? 'Đang crawl...' : 'Bắt đầu crawl'}</span>
          </button>
        </div>
      </section>

      {/* Last-crawl feedback (success / error toast row) */}
      {(lastCrawlMessage || error) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border ${
            error
              ? 'bg-red-50 text-red-700 border-red-100'
              : 'bg-emerald-50 text-emerald-700 border-emerald-100'
          }`}
        >
          {error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{error ?? lastCrawlMessage}</span>
          <button
            onClick={() => {
              setError(null);
              setLastCrawlMessage(null);
            }}
            className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            đóng
          </button>
        </div>
      )}

      {/* Main Grid Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Left column — News feed */}
        <div className="xl:col-span-1.5">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">
                Tin tức {symbolFilter !== 'ALL' && (
                  <span className="text-blue-600 ml-1">({symbolFilter})</span>
                )}
              </h3>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading
                  ? 'Đang tải...'
                  : `${totalNews.toLocaleString('en-US')} tin · ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
              </span>
            </div>

            <div className="flex flex-col gap-3 max-h-[750px] overflow-y-auto pr-1">
              {/* Empty state — no news at all */}
              {!isLoading && news.length === 0 && !error && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
                  <Inbox className="w-10 h-10" />
                  <span className="text-xs font-semibold">
                    {symbolFilter === 'ALL'
                      ? 'Chưa có tin tức nào. Hãy bấm "Bắt đầu crawl".'
                      : `Chưa có tin nào cho ${symbolFilter}. Thử chọn "Tất cả" hoặc crawl.`}
                  </span>
                </div>
              )}

              {/* Loading skeleton */}
              {isLoading && news.length === 0 && (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl border border-slate-100 bg-slate-50/40 flex gap-3.5 animate-pulse"
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-200" />
                      <div className="flex-1 flex flex-col gap-2">
                        <div className="h-3 w-3/4 bg-slate-200 rounded" />
                        <div className="h-2 w-1/2 bg-slate-100 rounded" />
                        <div className="h-2 w-full bg-slate-100 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* News list */}
              {news.map((item) => {
                // Choose a representative asset pill. Use the first
                // coinSymbol; fall back to a generic label if none.
                const headAsset = item.coinSymbols[0] ?? '?';
                const sentiment = inferSentiment(item);
                return (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-xs bg-slate-50/40 hover:bg-white transition-all flex gap-3.5 items-start text-left group"
                  >
                    <span
                      className={`w-9 h-9 rounded-lg font-black text-xs flex items-center justify-center border shrink-0 ${assetColor(headAsset)}`}
                    >
                      {assetIcon(headAsset)}
                    </span>

                    <div className="flex flex-col gap-1.5 flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <h4 className="text-xs font-black text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                          {item.title}
                        </h4>
                      </div>

                      <div className="flex items-center gap-2.5 text-[9.5px] font-bold text-slate-400">
                        <span>{item.source}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-200" />
                        <span>{formatTime(item.publishedAt)}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-200" />
                        <span
                          className={`px-1.5 py-0.25 rounded text-[8px] font-black ${
                            sentiment === 'positive'
                              ? 'bg-emerald-50 text-emerald-600'
                              : sentiment === 'negative'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {sentiment.toUpperCase()}
                        </span>
                        {item.coinSymbols.length > 1 && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-slate-200" />
                            <span className="text-blue-500">
                              +{item.coinSymbols.length - 1}
                            </span>
                          </>
                        )}
                      </div>

                      {item.summary && (
                        <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5 line-clamp-2">
                          {item.summary}
                        </p>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>

            <button
              onClick={() => navigate('/realtime')}
              className="w-full py-2.5 border-t border-slate-100 text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center justify-center gap-1 mt-1"
            >
              <span>Xem tất cả tin tức</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </article>
        </div>

        {/* Middle column — LLM-assisted Extraction + Self-healing */}
        <div className="xl:col-span-1.5 flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">LLM-assisted Extraction</h3>
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-600 font-bold text-[10px]">
                Template: v1.4.2
              </span>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-4">
              <div className="flex justify-between items-start text-center">
                {[
                  { n: 1, t: 'HTML thô', d: 'Thu thập nội dung HTML từ nguồn', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
                  { n: 2, t: 'LLM hiểu tag HTML', d: 'Đọc & hiểu, nhận diện vùng', cls: 'bg-purple-50 text-purple-600 border-purple-100' },
                  { n: 3, t: 'Sinh template', d: 'Tạo template trích xuất đề xuất', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
                  { n: 4, t: 'Lưu template', d: 'Quản lý phiên bản lưu trữ', cls: 'bg-amber-50 text-amber-600 border-amber-100' },
                ].map((step, idx, arr) => (
                  <div key={step.n} className="contents">
                    <div className="flex flex-col items-center flex-1">
                      <span className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center border shadow-sm ${step.cls}`}>
                        {step.n}
                      </span>
                      <span className="text-[9px] font-bold text-slate-700 mt-2">{step.t}</span>
                      <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">{step.d}</span>
                    </div>
                    {idx < arr.length - 1 && <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/50 text-xs font-bold text-slate-700">
                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left">
                  <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Nhận diện vùng:</span>
                  <div className="flex flex-col gap-0.5 font-mono text-[9px] text-slate-600">
                    <div>title &rarr; <span className="text-blue-600">h1.article-title</span></div>
                    <div>summary &rarr; <span className="text-blue-600">p.summary</span></div>
                    <div>source &rarr; <span className="text-blue-600">span.source</span></div>
                  </div>
                  <div className="text-[9px] text-emerald-600 mt-2.5 font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Độ tin cậy: 0.92
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Các phiên bản:</span>
                    <div className="flex flex-col gap-1.5 mt-1.5 text-[9.5px]">
                      <div className="flex justify-between items-center font-semibold text-slate-700">
                        <span className="text-blue-600">v1.4.2 (Hiện tại)</span>
                        <span className="text-slate-400 font-medium">10:32 • 18/05/2025</span>
                      </div>
                      <div className="flex justify-between items-center font-semibold text-slate-400">
                        <span>v1.4.1</span>
                        <span>09:10 • 17/05/2025</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold mt-2 pt-1 border-t border-slate-100">
                    <span>Fields: 5 | Score: 0.92</span>
                    <button className="text-blue-600">Xem tất cả</button>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Self-healing extraction</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400">Tự động bật</span>
                <button
                  onClick={() => setSelfHealingActive((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${
                    selfHealingActive ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                      selfHealingActive ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-4">
              <div className="flex justify-between items-start text-center">
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 font-bold text-xs flex items-center justify-center border border-blue-100 shadow-sm">1</span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Validate kết quả</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Kiểm tra chất lượng kết quả trích xuất</span>
                </div>
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 font-bold text-xs flex items-center justify-center border border-rose-100 shadow-sm border-dashed">?</span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Lỗi cao? (vd &gt; 10%)</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Nếu Yes &rarr; Kích hoạt LLM sửa</span>
                </div>
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 font-bold text-xs flex items-center justify-center border border-purple-100 shadow-sm">3</span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">LLM sửa template</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">LLM phân tích lỗi & đề xuất sửa đổi</span>
                </div>
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-xs flex items-center justify-center border border-emerald-100 shadow-sm">4</span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Lưu version mới</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Tự động cập nhật bản chạy mới</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/50 text-xs font-bold text-slate-700">
                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Chỉ số hiện tại:</span>
                    <div className="flex flex-col gap-1.5 mt-1.5 font-semibold text-[10px] text-slate-600">
                      <div className="flex justify-between"><span>Fields rỗng:</span><span className="text-slate-800 font-bold">8.7%</span></div>
                      <div className="flex justify-between"><span>Sai định dạng:</span><span className="text-slate-800 font-bold">3.2%</span></div>
                      <div className="flex justify-between"><span>Độ tin cậy TB:</span><span className="text-emerald-600 font-bold">0.76</span></div>
                    </div>
                  </div>
                  <div className="text-[10px] text-red-500 font-black mt-3 pt-1 border-t border-slate-100 flex justify-between">
                    <span>Tổng lỗi:</span>
                    <span>11.9%</span>
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Đề xuất template mới:</span>
                    <div className="flex flex-col gap-1 mt-1 font-semibold text-[10px]">
                      <div className="text-slate-700 font-bold">v1.4.3 (draft)</div>
                      <div className="text-emerald-600 mt-1 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" /> Giảm lỗi dự kiến: 11.9% &rarr; 4.1%
                      </div>
                      <div className="text-slate-500 text-[9px] mt-0.5">Độ tin cậy dự kiến: 0.93</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-3 pt-1 border-t border-slate-100">
                    <button className="text-[9px] text-blue-600">Xem diff</button>
                    <button className="px-2 py-0.75 bg-blue-600 text-white rounded text-[8px] font-black">Áp dụng ngay</button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        {/* Right column — Analysis output + Strategy integration */}
        <div className="flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Đầu ra phân tích</h3>
              <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Đang tải...' : 'Cập nhật: ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Sentiment tổng hợp (24h)</span>

              <div className="w-full h-3 rounded-full overflow-hidden flex mt-1">
                <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${posPct}%` }} title={`Positive: ${posPct}%`} />
                <div className="bg-slate-300 h-full transition-all duration-300" style={{ width: `${neuPct}%` }} title={`Neutral: ${neuPct}%`} />
                <div className="bg-red-500 h-full transition-all duration-300" style={{ width: `${negPct}%` }} title={`Negative: ${negPct}%`} />
              </div>

              <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-500 mt-1">
                <span className="text-emerald-600">■ Positive ({posPct}%)</span>
                <span className="text-slate-400">■ Neutral ({neuPct}%)</span>
                <span className="text-red-500">■ Negative ({negPct}%)</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-3 border-t border-slate-50">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Event Type (Top)</span>
              <div className="flex flex-wrap gap-1.5 mt-0.5 text-[9px] font-bold">
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">ETF / Fund Flow <span className="text-slate-400 ml-0.5">28%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Protocol Upgrade <span className="text-slate-400 ml-0.5">22%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Regulation <span className="text-slate-400 ml-0.5">15%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Partnership <span className="text-slate-400 ml-0.5">12%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Market Trend <span className="text-slate-400 ml-0.5">23%</span></span>
              </div>
            </div>

            <table className="w-full text-xs font-bold text-slate-600 pt-2 border-t border-slate-50">
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Confidence Score (TB)</td>
                  <td className="py-2.5 text-right text-slate-800">0.78</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Số tin đã phân tích (24h)</td>
                  <td className="py-2.5 text-right text-slate-800">{analyzedCount.toLocaleString('en-US')}</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Độ bao phủ nguồn</td>
                  <td className="py-2.5 text-right text-emerald-600">92%</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-slate-400">Nguồn hoạt động</td>
                  <td className="py-2.5 text-right text-slate-800 flex items-center justify-end gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>23 / 25</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </article>

          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
            <h3 className="text-sm font-extrabold text-slate-800">Tích hợp với Strategy</h3>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
              News Sentiment được sử dụng trực tiếp trong Strategy Engine làm bộ lọc tin tức.
            </p>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
              <div className="flex flex-col gap-2 items-center text-center">
                <div className="bg-white border border-slate-200/80 p-2 rounded-lg text-[9.5px] font-bold text-slate-700 w-full flex justify-between items-center shadow-xs">
                  <span>News Sentiment (Realtime)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                </div>

                <div className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1">
                  <span>&darr;</span> <span className="text-[8px] font-semibold">API / Stream</span>
                </div>

                <div className="bg-white border border-slate-200/80 p-2.5 rounded-lg text-[9.5px] font-bold text-slate-700 w-full flex flex-col gap-1 items-center shadow-xs">
                  <span className="text-slate-400 font-semibold text-[8px] uppercase">Điều kiện vào lệnh</span>
                  <span>Sentiment &gt; 0.65</span>
                </div>

                <div className="text-[10px] text-slate-400 font-bold">
                  <span>&darr;</span> <span className="text-[8px] font-medium">Hoặc sử dụng trực tiếp</span>
                </div>

                <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-xl text-[10px] font-extrabold text-blue-700 w-full flex flex-col items-center gap-1 shadow-sm">
                  <span>NewsSentimentStrategy</span>
                  <span className="text-[8px] text-blue-500 font-semibold">Chiến lược mẫu</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
