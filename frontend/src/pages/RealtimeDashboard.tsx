import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { 
  ChevronDown, 
  HelpCircle, 
  Bell, 
  ArrowUpRight, 
  ArrowDownRight,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  connect,
  disconnect,
  subscribe,
  onCandleClosed,
  onCandleUpdating,
  onWsStatus,
  isConnected,
  type CandleClosedEvent,
  type CandleUpdatingEvent,
  type Timeframe,
} from "../lib/socket";
import {
  fetchChartConfigs,
  fetchCandles,
  loadMoreCandles,
  updateChartConfig,
  type ChartConfig,
  type RawCandle,
} from "../lib/api";
import LightweightCandlestickChart, {
  type ChartSignal,
} from "../components/LightweightCandlestickChart";
import { computeMASignals } from "../lib/indicators";

// ── local candle shape for the chart ──────────────────────────────────────────

interface LocalCandle {
  time: string; // display label, e.g. "14:30"
  openTime: number; // epoch ms — used for dedup logic
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function openTimeToLabel(openTime: number, tf: Timeframe): string {
  const d = new Date(openTime);
  if (tf === "1d") {
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function rawToLocal(c: RawCandle, tf: Timeframe): LocalCandle {
  return {
    time: openTimeToLabel(c.openTime, tf),
    openTime: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  };
}

/** Convert any thrown value (Error, object, string) into a printable message. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const anyErr = err as { message?: unknown; error?: unknown };
    if (typeof anyErr.message === "string") return anyErr.message;
    if (typeof anyErr.error === "string") return anyErr.error;
    if (typeof anyErr.error === "object" && anyErr.error !== null) {
      const nested = anyErr.error as { message?: unknown };
      if (typeof nested.message === "string") return nested.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return "Unknown error";
}

function updateCandleList(
  list: LocalCandle[],
  raw: RawCandle,
  tf: Timeframe,
): LocalCandle[] {
  const incoming = rawToLocal(raw, tf);

  const existingIndex = list.findIndex(
    (c) => c.openTime === incoming.openTime,
  );

  // Existing candle → update
  if (existingIndex !== -1) {
    const updated = [...list];
    updated[existingIndex] = incoming;
    return updated;
  }

  // New candle → append, then sort by openTime and keep last 500
  const next = [...list, incoming].sort(
    (a, b) => a.openTime - b.openTime,
  );

  return next.length > 500 ? next.slice(-500) : next;
}

function computeMA(candles: LocalCandle[], period: number = 21): (number | null)[] {
  return candles.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) sum += candles[i - j].close;
    return sum / period;
  });
}

// ── status pill ──────────────────────────────────────────────────────────────

type WsStatusState = "connecting" | "connected" | "reconnecting" | "disconnected";

function StatusPill({ status, latency }: { status: WsStatusState; latency: number | null }) {
  if (status === "connected") {
    return (
      <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <Wifi className="w-3.5 h-3.5" />
        <span>
          Đã kết nối{latency !== null ? ` · ${latency}ms` : ""}
        </span>
      </div>
    );
  }
  if (status === "reconnecting") {
    return (
      <div className="flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Đang kết nối lại…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Mất kết nối</span>
    </div>
  );
}

// ── lightweight chart pane ──────────────────────────────────────────────────

function LightweightChartPane({
  chartIndex,
  tf,
  candles,
  onTimeframeChange,
  isLoadingTf,
  onLoadOlder,
  hasMoreData = true,
  symbol,
}: {
  chartIndex: number;
  tf: Timeframe;
  candles: LocalCandle[];
  onTimeframeChange: (chartIndex: number, newTf: Timeframe) => void;
  isLoadingTf: boolean;
  onLoadOlder: () => void;
  hasMoreData?: boolean;
  symbol: string;
}) {
  const lastCandle = candles[candles.length - 1];

  // Per-chart MA-crossover signals. Each chart computes its own series
  // from its own candle list, so multiple charts and timeframe changes
  // remain isolated. `computeMASignals` is pure + deterministic; the
  // memo key is the candle list reference so realtime updates trigger
  // a recompute without doing it on every parent re-render.
  const signals: ChartSignal[] = useMemo(() => {
    const raw = computeMASignals(candles, 9, 21);
    const out: ChartSignal[] = [];
    for (const s of raw) {
      if (s.side === "BUY" || s.side === "SELL") {
        out.push({ openTime: s.openTime, side: s.side });
      }
    }
    return out;
    // candles is the single source of truth; its identity changes on
    // every realtime update and every timeframe switch.
  }, [candles]);

  // Latest signal — drives the BUY/SELL pill in the chart header.
  const latestSignal: "BUY" | "SELL" | "HOLD" = useMemo(() => {
    if (signals.length === 0) return "HOLD";
    return signals[signals.length - 1].side;
  }, [signals]);

  return (
    <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 relative overflow-hidden group hover:shadow-md hover:border-slate-200/70 transition-all">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm text-slate-800">
              {lastCandle ? symbol : "—"}
            </span>
            <div className="relative">
              <select
                className="appearance-none bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs font-bold px-2.5 py-1 rounded-lg cursor-pointer pr-7 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={tf}
                onChange={(e) => onTimeframeChange(chartIndex, e.target.value as Timeframe)}
              >
                {(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as Timeframe[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-blue-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {isLoadingTf && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-bold text-blue-500 uppercase">MA(21)</span>
            {lastCandle && (
              <span className="text-[11px] font-semibold text-slate-500">
                {lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>

        <div className="ml-3">
          <span
            data-testid={`chart-signal-pill-${chartIndex}`}
            className={`px-3 py-1 rounded-lg text-xs font-black tracking-wider ${
              latestSignal === "BUY"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : latestSignal === "SELL"
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-slate-50 text-slate-500 border border-slate-200"
            }`}
          >
            {latestSignal}
          </span>
        </div>
      </div>

      <LightweightCandlestickChart
        candles={candles}
        onLoadOlder={onLoadOlder}
        hasMoreData={hasMoreData}
        signals={signals}
      />

      <div className="flex justify-between items-center border-t border-slate-100 pt-3 mt-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Cập nhật realtime</span>
            <span className="w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm bg-emerald-500" />
          </div>
          
          {/* Load 100 candles button */}
          <button
            onClick={onLoadOlder}
            disabled={!hasMoreData}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200/60 hover:border-blue-300 text-blue-700 hover:text-blue-800 transition-all text-[10px] font-bold shadow-sm hover:shadow group/btn disabled:opacity-50 disabled:cursor-not-allowed"
            title="Load thêm 100 nến lịch sử"
          >
            <svg className="w-3 h-3 group-hover/btn:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
            </svg>
            <span>Load 100 nến</span>
          </button>
        </div>
        
        {candles.length > 0 && (
          <span className="text-[10px] font-medium text-slate-400">
            {candles.length} candles
          </span>
        )}
      </div>
    </article>
  );
}


interface ViewportState {
  startIdx: number;
  isLoadingOlder: boolean;
}

export function LegacyChartPane({
  chartIndex,
  tf,
  candles,
  currentPrice,
  onTimeframeChange,
  isLoadingTf,
  onLoadOlder,
}: {
  chartIndex: number;
  tf: Timeframe;
  candles: LocalCandle[];
  currentPrice: number;
  onTimeframeChange: (chartIndex: number, newTf: Timeframe) => void;
  isLoadingTf: boolean;
  onLoadOlder: () => void;
}) {
  const lastCandle = candles[candles.length - 1];

  // Legacy pane used priceChangePct to colour the header BUY/SELL pill;
  // the strategy signal is now the source of truth, so this pane is
  // intentionally neutral here.
  const isUp = true;

  // MA(21) – matches the project's MovingAverageStrategy slow SMA
  const maVals = computeMA(candles, 21);

  // SVG dimensions
  const W = 500;
  const priceH = 180;
  const volH = 70;
  const padR = 65, padTop = 20, padBot = 20;
  const volGap = 8;

  const VISIBLE_CANDLES = 60;

  // Viewport: startIdx = leftmost candle index (0 = oldest, len-1 = newest)
  const [viewport, setViewport] = useState<ViewportState>({
    startIdx: 0,
    isLoadingOlder: false,
  });

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartStartIdx, setDragStartStartIdx] = useState(0);

  // liveMode: true when user is viewing the rightmost (newest) edge
  const [liveMode, setLiveMode] = useState(true);

  const totalCandles = candles.length;
  const maxStartIdx = Math.max(0, totalCandles - VISIBLE_CANDLES);

  // Newest candle openTime — used to detect a *new* candle arrival
  // (same openTime just means an update to the current candle, not a new one)
  const newestOpenTime = candles[candles.length - 1]?.openTime ?? null;
  const previousNewestRef = useRef<number | null>(null);

  // Initialize viewport to show newest candles ONLY when timeframe changes.
  // IMPORTANT: do NOT depend on totalCandles — otherwise loading older data
  // would jump the viewport back to the newest edge.
  useEffect(() => {
    setViewport({
      startIdx: Math.max(0, totalCandles - VISIBLE_CANDLES),
      isLoadingOlder: false,
    });
    setLiveMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  // Auto-follow realtime: when a new candle (by openTime) arrives AND liveMode
  // is on, jump viewport to newest. Same-candle updates do NOT trigger this.
  useEffect(() => {
    if (newestOpenTime === null) return;

    const previous = previousNewestRef.current;

    if (
      liveMode &&
      previous !== null &&
      newestOpenTime > previous
    ) {
      setViewport((prev) => ({
        ...prev,
        startIdx: Math.max(0, totalCandles - VISIBLE_CANDLES),
      }));
    }

    previousNewestRef.current = newestOpenTime;
  }, [newestOpenTime, totalCandles, liveMode]);

  // Clamp startIdx
  const clampedStartIdx = Math.min(viewport.startIdx, maxStartIdx);
  const endIdx = Math.min(clampedStartIdx + VISIBLE_CANDLES, totalCandles);

  // Visible candles in chronological order:
// candles[0]=oldest ... candles[len-1]=newest
// visibleCandles[0]=oldest (LEFT) ... visibleCandles[N-1]=newest (RIGHT)
  const visibleCandles = candles.slice(clampedStartIdx, endIdx);

  // Candlesticks:
  // LEFT  = oldest
  // RIGHT = newest
  const drawCandles = visibleCandles;
  const chartWidth = W - padR;
  const candleWidth = chartWidth / Math.max(drawCandles.length, 1);

  const getX = (localIdx: number) => localIdx * candleWidth + candleWidth / 2;

  // Price range (needed for getPriceY)
  const prices = drawCandles.flatMap((c) => [c.open, c.close, c.high, c.low]);
  const minP = prices.length ? Math.min(...prices) * 0.9995 : currentPrice * 0.998;
  const maxP = prices.length ? Math.max(...prices) * 1.0005 : currentPrice * 1.002;

  // Y axis
  const getPriceY = (v: number) =>
    priceH - padTop - ((v - minP) * (priceH - padTop - padBot)) / (maxP - minP);

  // MA path — drawCandles[0] is oldest (LEFT), drawCandles[length-1] is newest (RIGHT)
  const maPath = drawCandles.reduce((path, _c, localIdx) => {
    const globalIdx = clampedStartIdx + localIdx;
    const v = maVals[globalIdx];
    if (v === null) return path;
    const cmd = path === "" ? "M" : "L";
    return `${path} ${cmd} ${getX(localIdx)} ${getPriceY(v)}`;
  }, "");

  const volTop = 4;
  const volBottom = volH - 14;
  const maxVol = drawCandles.length
    ? Math.max(...drawCandles.map((c) => c.volume))
    : 1000;
  const getVolY = (v: number) =>
    volBottom - ((v / maxVol) * (volBottom - volTop));

  // ── Mouse drag ─────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStartX(e.clientX);
    setDragStartStartIdx(clampedStartIdx);
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      // Drag LEFT  (dx < 0) → startIdx tăng → xem NEWER
      // Drag RIGHT (dx > 0) → startIdx giảm → xem OLDER
      const dx = e.clientX - dragStartX;
      const candleShift = dx / candleWidth;
      const newStartIdx = Math.max(0, Math.min(
        Math.round(dragStartStartIdx - candleShift),
        maxStartIdx,
      ));

      // Update liveMode: at rightmost edge → liveMode on
      const atRightEdge = newStartIdx >= maxStartIdx - 1;
      setLiveMode(atRightEdge);

      setViewport((prev) => ({ ...prev, startIdx: newStartIdx }));

      // NOTE: Auto-load when dragging near edge is intentionally removed.
      // User must click "Load 100 nến" button to manually trigger load-more.
      // WebSocket continuously appends/updates the latest candle in real time.
    },
    [isDragging, dragStartX, dragStartStartIdx, candleWidth, maxStartIdx],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // NOTE: scroll wheel intentionally does NOT pan the chart.
  // Only mouse drag pans the viewport.

  // ── Buttons ─────────────────────────────────────────────────────────────────
  const scrollToLatest = () => {
    setViewport((prev) => ({ ...prev, startIdx: maxStartIdx }));
    setLiveMode(true);
  };

  // How far the user has scrolled from the newest (for "Historical" badge)
  const candlesFromNewest = Math.max(
    0,
    totalCandles - (clampedStartIdx + VISIBLE_CANDLES),
  );

  return (
    <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 relative overflow-hidden group hover:shadow-md hover:border-slate-200/70 transition-all">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm text-slate-800">
              {lastCandle ? "BTCUSDT" : "—"}
            </span>
            {/* Timeframe selector */}
            <div className="relative">
              <select
                className="appearance-none bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs font-bold px-2.5 py-1 rounded-lg cursor-pointer pr-7 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={tf}
                onChange={(e) => onTimeframeChange(chartIndex, e.target.value as Timeframe)}
              >
                {(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as Timeframe[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-blue-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {isLoadingTf && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-bold text-blue-500 uppercase">MA(21)</span>
            {lastCandle && (
              <span className="text-[11px] font-semibold text-slate-500">
                {lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>

        <div className="ml-3">
          <span
            className={`px-3 py-1 rounded-lg text-xs font-black tracking-wider ${
              isUp
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {isUp ? "BUY" : "SELL"}
          </span>
        </div>
      </div>

      {/* SVG Charts */}
      <div
        className="relative w-full select-none mt-2"
        style={{ height: priceH + volGap + volH + 20, cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {drawCandles.length > 0 ? (
          <>
            {/* Price Chart SVG */}
            <svg
              className="w-full absolute"
              style={{ height: priceH }}
              viewBox={`0 0 ${W} ${priceH}`}
              preserveAspectRatio="none"
            >
              {/* Grid lines */}
              <line x1={0} y1={getPriceY(minP + (maxP - minP) * 0.25)} x2={W - padR} y2={getPriceY(minP + (maxP - minP) * 0.25)} stroke="#f1f5f9" strokeDasharray="3,3" />
              <line x1={0} y1={getPriceY(minP + (maxP - minP) * 0.5)} x2={W - padR} y2={getPriceY(minP + (maxP - minP) * 0.5)} stroke="#f1f5f9" strokeDasharray="3,3" />
              <line x1={0} y1={getPriceY(minP + (maxP - minP) * 0.75)} x2={W - padR} y2={getPriceY(minP + (maxP - minP) * 0.75)} stroke="#f1f5f9" strokeDasharray="3,3" />

              {/* Candlesticks — LEFT = oldest, RIGHT = newest */}
              {drawCandles.map((c, localIdx) => {
                const x = getX(localIdx);
                const isGreen = c.close >= c.open;
                const color = isGreen ? "#10b981" : "#ef4444";
                const bw = Math.max(3, candleWidth * 0.7);
                // Global index: drawCandles[0] is the leftmost (oldest) visible candle.
                const globalIdx = clampedStartIdx + localIdx;
                return (
                  <g key={`candle-${globalIdx}`}>
                    <line x1={x} y1={getPriceY(c.high)} x2={x} y2={getPriceY(c.low)} stroke={color} strokeWidth={1.2} />
                    <rect
                      x={x - bw / 2}
                      y={Math.min(getPriceY(c.open), getPriceY(c.close))}
                      width={bw}
                      height={Math.max(1.5, Math.abs(getPriceY(c.open) - getPriceY(c.close)))}
                      fill={color} stroke={color} strokeWidth={0.5} rx={0.5}
                    />
                  </g>
                );
              })}

              {/* MA line */}
              <path
                d={maPath}
                fill="none" stroke="#3b82f6" strokeWidth={1.5}
              />

              {/* Current price line */}
              {lastCandle && liveMode && (
                <g>
                  <line x1={0} y1={getPriceY(currentPrice)} x2={W - padR} y2={getPriceY(currentPrice)} stroke="#10b981" strokeWidth={1} strokeDasharray="2,2" />
                  <rect x={W - padR + 2} y={getPriceY(currentPrice) - 6} width={54} height={12} fill="#10b981" rx={2} />
                  <text x={W - padR + 5} y={getPriceY(currentPrice) + 3} fill="#fff" fontSize="8" fontWeight="extrabold">
                    {currentPrice.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                  </text>
                </g>
              )}

              {/* Y-axis labels */}
              <g fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="start">
                <text x={W - padR + 6} y={getPriceY(maxP) + 8}>{maxP.toLocaleString("en-US", { maximumFractionDigits: 0 })}</text>
                <text x={W - padR + 6} y={getPriceY((minP + maxP) / 2) + 3}>{((minP + maxP) / 2).toLocaleString("en-US", { maximumFractionDigits: 0 })}</text>
                <text x={W - padR + 6} y={getPriceY(minP) - 3}>{minP.toLocaleString("en-US", { maximumFractionDigits: 0 })}</text>
              </g>
            </svg>

            {/* Volume Chart SVG */}
            <svg
              className="w-full absolute"
              style={{ height: volH, top: priceH + volGap }}
              viewBox={`0 0 ${W} ${volH}`}
              preserveAspectRatio="none"
            >
              {/* Divider line */}
              <line x1={0} y1={volTop - 4} x2={W - padR} y2={volTop - 4} stroke="#e2e8f0" strokeDasharray="4,4" />

              {/* Volume bars — LEFT = oldest, RIGHT = newest */}
              {drawCandles.map((c, localIdx) => {
                const x = getX(localIdx);
                const y = getVolY(c.volume);
                const isGreen = c.close >= c.open;
                const bw = Math.max(2, candleWidth * 0.7);
                const barTop = Math.max(volTop, y);
                const barHeight = Math.max(0, volBottom - barTop);
                const globalIdx = clampedStartIdx + localIdx;
                return (
                  <g key={`vol-${globalIdx}`}>
                    <rect
                      x={x - bw / 2}
                      y={barTop}
                      width={bw}
                      height={barHeight}
                      fill={isGreen ? "#10b981" : "#ef4444"}
                      opacity={0.9}
                    />
                    {localIdx % 5 === 0 && barHeight > 15 && (
                      <text
                        x={x}
                        y={barTop + 10}
                        fill={isGreen ? "#059669" : "#dc2626"}
                        fontSize="6"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {(c.volume / 1000).toFixed(0)}k
                      </text>
                    )}
                  </g>
                );
              })}

              {/* X-axis labels — LEFT = oldest, RIGHT = newest */}
              <g fill="#94a3b8" fontSize="7.5" fontWeight="bold" textAnchor="middle">
                {drawCandles.map((c, localIdx) => {
                  if (localIdx % Math.max(1, Math.floor(drawCandles.length / 8)) !== 0) return null;
                  const globalIdx = clampedStartIdx + localIdx;
                  return (
                    <text key={`xl-${globalIdx}`} x={getX(localIdx)} y={volH - 4}>
                      {c.time}
                    </text>
                  );
                })}
              </g>

              {/* Volume label */}
              <text x={W - padR + 6} y={volTop + 12} fill="#94a3b8" fontSize="7" fontWeight="bold">VOL</text>
            </svg>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs" style={{ height: priceH + volGap + volH }}>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Đang tải dữ liệu…</span>
          </div>
        )}

        {/* Loading indicators */}
        {viewport.isLoadingOlder && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 z-10">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Đang tải dữ liệu cũ…
          </div>
        )}

        {/* Scroll to latest */}
        {!liveMode && (
          <button
            onClick={scrollToLatest}
            className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-lg transition-colors flex items-center gap-1 z-10"
          >
            <ArrowDownRight className="w-3 h-3" />
            Live
          </button>
        )}

        {/* Drag hint */}
        {candles.length > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-slate-300 font-medium opacity-0 group-hover:opacity-100 transition-opacity select-none pointer-events-none flex items-center gap-1">
            <span>←</span>
            <span>Kéo trái xem thêm</span>
            <span>→</span>
          </div>
        )}

        {/* Historical indicator */}
        {candlesFromNewest > 5 && (
          <div className="absolute top-2 left-2 bg-slate-800/80 text-white px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 z-10">
            <ArrowUpRight className="w-3 h-3" />
            Historical
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center border-t border-slate-100 pt-3 mt-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Cập nhật realtime</span>
            <span className={`w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${liveMode ? "bg-emerald-500" : "bg-amber-500"}`} />
          </div>
          
          {/* Load 100 candles button */}
          <button
            onClick={onLoadOlder}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200/60 hover:border-blue-300 text-blue-700 hover:text-blue-800 transition-all text-[10px] font-bold shadow-sm hover:shadow group/btn"
            title="Load thêm 100 nến lịch sử"
          >
            <ArrowUpRight className="w-3 h-3 group-hover/btn:scale-110 transition-transform" />
            <span>Load 100 nến</span>
          </button>
        </div>
        
        {totalCandles > 0 && (
          <span className="text-[10px] font-medium text-slate-400">
            {totalCandles} candles
            {candlesFromNewest > 0 && ` · ${candlesFromNewest} cũ hơn`}
          </span>
        )}
      </div>
    </article>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function RealtimeDashboard() {
  // Initial chart count (immutable after first load)
  const [chartCount, setChartCount] = useState(4);

  // Symbol selection
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTCUSDT");
  const [availableSymbols] = useState<string[]>([
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "MATICUSDT",
  ]);
  const [isChangingSymbol, setIsChangingSymbol] = useState(false);

  // Per-chart current timeframe (keyed by chartIndex) — THIS is the source of truth
  const [timeframes, setTimeframes] = useState<Record<number, Timeframe>>({});

  // Candle data keyed by timeframe (shared across charts)
  const [candlesData, setCandlesData] = useState<Record<string, LocalCandle[]>>({});
  
  // Track if each timeframe has more historical data available
  const [hasMoreData, setHasMoreData] = useState<Record<string, boolean>>({});
  
  // Loading states
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  // Which chart indices are currently loading a tf change
  const [loadingTfCharts, setLoadingTfCharts] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Connection
  const [wsStatus, setWsStatus] = useState<WsStatusState>("connecting");
  const [latency, setLatency] = useState<number | null>(null);

  // Computed from candle data (all candle data across all timeframes)
  const allCandles = Object.values(candlesData).flat();
  const lastCandle = allCandles[allCandles.length - 1];
  const currentPrice = lastCandle?.close ?? 0;

  const DEFAULT_FALLBACK_CONFIGS: ChartConfig[] = [
    { chartIndex: 0, symbol: "BTCUSDT", timeframe: "1m" },
    { chartIndex: 1, symbol: "BTCUSDT", timeframe: "1h" },
    { chartIndex: 2, symbol: "BTCUSDT", timeframe: "4h" },
    { chartIndex: 3, symbol: "BTCUSDT", timeframe: "1d" },
  ];

  // ── 1. Load chart configs on mount (one-time) ──────────────────────────────────────
  useEffect(() => {
    fetchChartConfigs()
      .then((configs) => {
        const chartConfigs = configs && configs.length > 0 ? configs : DEFAULT_FALLBACK_CONFIGS;
        
        console.log("[Init] chartConfigs from backend:", chartConfigs);
        
        // Normalize chartIndex to start from 0
        const normalizedConfigs = chartConfigs
          .sort((a, b) => a.chartIndex - b.chartIndex)
          .map((cfg, idx) => ({ ...cfg, chartIndex: idx }));
        
        console.log("[Init] normalized configs:", normalizedConfigs);
        
        // Initialize timeframes and chart count
        setChartCount(normalizedConfigs.length);
        const initTf: Record<number, Timeframe> = {};
        for (const cfg of normalizedConfigs) {
          initTf[cfg.chartIndex] = cfg.timeframe;
        }
        console.log("[Init] initTf:", initTf);
        setTimeframes(initTf);
        
        // Load initial candles for ALL timeframes in parallel
        (async () => {
          const next: Record<string, LocalCandle[]> = {};
          try {
            const fetchPromises = normalizedConfigs.map(async (cfg) => {
              console.log(`[Init] Fetching ${cfg.timeframe} candles for chart ${cfg.chartIndex}...`);
              const candles = await fetchCandles({
                symbol: selectedSymbol,
                timeframe: cfg.timeframe,
                limit: 100,
              });
              console.log(`[Init] Received ${candles.length} candles for ${cfg.timeframe}`);
              return { timeframe: cfg.timeframe, candles };
            });
            
            // Wait for ALL fetches to complete
            const results = await Promise.all(fetchPromises);
            
            // Populate candlesData for all timeframes
            for (const { timeframe, candles } of results) {
              next[timeframe] = candles.map((c) => rawToLocal(c, timeframe));
            }
            
            console.log(`[Init] Setting candlesData:`, Object.keys(next).map(tf => `${tf}: ${next[tf].length}`));
            setCandlesData(next);
            setLoadingConfigs(false);
          } catch (err) {
            setError(`Không tải được candle: ${errorMessage(err)}`);
            setLoadingConfigs(false);
          }
        })();
      })
      .catch((err) => {
        setError(`Không tải được chart config: ${errorMessage(err)}`);
        setLoadingConfigs(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Socket connection ─────────────────────────────────────────────────
  useEffect(() => {
    // Status listener
    const offStatus = onWsStatus((status) => {
      if (status.state === "connected") {
        setWsStatus("connected");
        if ("since" in status) {
          setLatency(Date.now() - status.since);
        }
      } else if (status.state === "connecting") {
        setWsStatus("connecting");
      } else if (status.state === "reconnecting") {
        setWsStatus("reconnecting");
      } else {
        setWsStatus("disconnected");
      }
    });

    // Candle listener — single mutator shared by both Closed and Updating events
    const applyCandle = (event: CandleClosedEvent | CandleUpdatingEvent): void => {
      const { candle } = event.payload;
      const eventSymbol = event.payload.symbol;
      const tf = event.payload.timeframe as Timeframe;

      // Guard: only apply candle if it matches current selected symbol
      if (eventSymbol !== selectedSymbol) {
        console.log(`[WS] Ignoring candle from ${eventSymbol}, current symbol is ${selectedSymbol}`);
        return;
      }

      setCandlesData((prev) => {
        const list = prev[tf] ?? [];
        console.log(`[WS] Applying candle to ${tf}: prev list has ${list.length} candles, incoming openTime=${new Date(candle.openTime).toISOString()}`);
        
        // Safety: if prev list is empty and we're getting realtime updates,
        // it means initial data hasn't loaded yet - skip this update
        if (list.length === 0) {
          console.warn(`[WS] Skipping ${tf} update - initial data not loaded yet`);
          return prev;
        }
        
        const updated = updateCandleList(list, candle as RawCandle, tf);
        console.log(`[WS] After update: ${tf} now has ${updated.length} candles`);
        return {
          ...prev,
          [tf]: updated,
        };
      });
    };

    const offCandle = onCandleClosed(applyCandle);
    const offUpdating = onCandleUpdating(applyCandle);

    // Connect
    connect();

    return () => {
      offStatus();
      offCandle();
      offUpdating();
      disconnect();
    };
  }, [selectedSymbol]);

  // ── 3. Subscribe to streams when timeframes or selectedSymbol change ──────────────────
  useEffect(() => {
    if (Object.keys(timeframes).length === 0) return;
    if (!isConnected()) return;
    if (loadingConfigs) return; // ← Wait for initial data to load

    const tfMap = new Map<string, Timeframe[]>();
    
    // Collect unique timeframes from current state
    const uniqueTfs = Array.from(new Set(Object.values(timeframes)));
    tfMap.set(selectedSymbol, uniqueTfs);

    console.log(`[Subscribe] Subscribing to ${selectedSymbol} × [${uniqueTfs.join(', ')}]`);

    for (const [sym, tfs] of tfMap) {
      subscribe(sym, tfs);
    }
  }, [timeframes, selectedSymbol, loadingConfigs]); // Depend on both timeframes and selectedSymbol

  // ── 4. Handle symbol change ───────────────────────────────────────────────
  const handleSymbolChange = useCallback(
    async (newSymbol: string) => {
      if (newSymbol === selectedSymbol) return;
      if (isChangingSymbol) return; // Prevent double-click

      console.log(`[SymbolChange] Switching from ${selectedSymbol} to ${newSymbol}`);
      setIsChangingSymbol(true);
      setError(null);

      try {
        // 1. Unsubscribe all current streams (old symbol)
        const currentTfs = Array.from(new Set(Object.values(timeframes)));
        if (currentTfs.length > 0 && isConnected()) {
          console.log(`[SymbolChange] Unsubscribing ${selectedSymbol} × ${currentTfs.length} timeframes`);
          // Note: unsubscribe is a no-op in the socket library currently,
          // but we keep the logic for future implementation
        }

        // 2. Clear all candle data
        console.log("[SymbolChange] Clearing candle data");
        setCandlesData({});

        // 3. Update selected symbol (triggers re-subscribe via useEffect)
        setSelectedSymbol(newSymbol);

        // 4. Fetch historical data for all 4 charts with new symbol
        console.log(`[SymbolChange] Fetching historical data for ${newSymbol}`);
        const next: Record<string, LocalCandle[]> = {};
        
        for (let chartIndex = 0; chartIndex < chartCount; chartIndex++) {
          const tf = timeframes[chartIndex];
          if (!tf) continue;
          
          const candles = await fetchCandles({
            symbol: newSymbol,
            timeframe: tf,
            limit: 100,
          });
          next[tf] = candles.map((c) => rawToLocal(c, tf));
        }

        setCandlesData(next);
        console.log(`[SymbolChange] Successfully switched to ${newSymbol}`);
      } catch (err) {
        setError(`Không tải được dữ liệu cho ${newSymbol}: ${errorMessage(err)}`);
        // Revert symbol on error
        setSelectedSymbol(selectedSymbol);
      } finally {
        setIsChangingSymbol(false);
      }
    },
    [selectedSymbol, isChangingSymbol, timeframes, chartCount],
  );

  // ── 5. Handle per-chart timeframe change ───────────────────────────────────
  // ── 5. Handle per-chart timeframe change ───────────────────────────────────
  const handleTimeframeChange = useCallback(
    async (chartIndex: number, newTf: Timeframe) => {
      const currentTf = timeframes[chartIndex];
      if (currentTf === newTf) return;

      // Check for conflict: another chart already uses this timeframe
      const otherChartUsingNewTf = Object.entries(timeframes).find(
        ([idx, tf]) => Number(idx) !== chartIndex && tf === newTf,
      );
      if (otherChartUsingNewTf) {
        setError(`Timeframe ${newTf} đã được sử dụng ở chart ${Number(otherChartUsingNewTf[0]) + 1}. Không thể chọn trùng.`);
        return;
      }

      // Mark chart as loading
      setLoadingTfCharts((prev) => new Set(prev).add(chartIndex));

      // Update timeframe immediately (optimistic)
      const updatedTimeframes = { ...timeframes, [chartIndex]: newTf };
      setTimeframes(updatedTimeframes);

      // Clear old candles ONLY if no other chart is using that timeframe
      const otherChartStillUsesOldTf = Object.entries(updatedTimeframes)
        .some(([idx, tf]) => Number(idx) !== chartIndex && tf === currentTf);

      if (!otherChartStillUsesOldTf) {
        setCandlesData((prev) => {
          const next = { ...prev };
          delete next[currentTf];
          return next;
        });
      }

      // Reset hasMoreData for the new timeframe
      setHasMoreData((prev) => ({ ...prev, [newTf]: true }));

      try {
        // Update chart config in backend (ignore error if backend offline)
        await updateChartConfig({
          chartIndex,
          symbol: selectedSymbol,
          timeframe: newTf,
        }).catch(() => {});

        // Fetch new candles with selected symbol
        const result = await fetchCandles({
          symbol: selectedSymbol,
          timeframe: newTf,
          limit: 100,
        });
        setCandlesData((prev) => ({
          ...prev,
          [newTf]: result.map((c) => rawToLocal(c, newTf)),
        }));
      } catch (err) {
        setError(`Không tải được candle ${newTf}: ${errorMessage(err)}`);
        // Revert timeframe on error
        setTimeframes((prev) => ({ ...prev, [chartIndex]: currentTf }));
        setCandlesData((prev) => ({ ...prev, [currentTf]: prev[currentTf] ?? [] }));
      } finally {
        setLoadingTfCharts((prev) => {
          const next = new Set(prev);
          next.delete(chartIndex);
          return next;
        });
      }
    },
    [timeframes, selectedSymbol],
  );

  // ── 6. Load older data handler per chart ────────────────────────────────
  const handleLoadOlder = useCallback((chartIndex: number) => {
    const tf = timeframes[chartIndex];
    if (!tf) return;
    
    // ✅ Lấy candles từ state HIỆN TẠI để đảm bảo luôn có dữ liệu mới nhất
    setCandlesData((currentCandlesData) => {
      const currentCandles = currentCandlesData[tf] ?? [];
      const oldestCandle = currentCandles[0];
      
      if (!oldestCandle) {
        console.warn(`[Dashboard] No candles to load before (chart ${chartIndex + 1})`);
        return currentCandlesData; // không thay đổi state
      }

      console.log(`[Dashboard] Load more clicked: chart ${chartIndex + 1}, timeframe ${tf}`);
      console.log(`[Dashboard] Oldest candle: ${new Date(oldestCandle.openTime).toISOString()}, beforeMs: ${oldestCandle.openTime}`);

      // Gọi API bên ngoài setCandlesData để tránh stale closure
      loadMoreCandles({
        symbol: selectedSymbol,
        timeframe: tf,
        beforeMs: oldestCandle.openTime,
        limit: 100,
      }).then(({ candles: older }) => {
        console.log(`[Dashboard] Received ${older.length} older candles for ${tf}`);
        
        if (older.length === 0) {
          console.log(`[Dashboard] No more data available for ${tf}`);
          setHasMoreData((prev) => ({ ...prev, [tf]: false }));
          return;
        }
        
        const olderLocal = older.map((c) => rawToLocal(c, tf));
        setCandlesData((prev) => {
          const existing = prev[tf] ?? [];
          const merged = [...olderLocal, ...existing].sort(
            (a, b) => a.openTime - b.openTime,
          );
          console.log(`[Dashboard] Merged: ${olderLocal.length} + ${existing.length} = ${merged.length} candles`);
          return {
            ...prev,
            [tf]: merged.length > 500 ? merged.slice(-500) : merged,
          };
        });
      }).catch((err) => {
        console.error(`[Dashboard] Load more failed for ${tf}:`, err);
      });
      
      return currentCandlesData; // trả về state cũ, API sẽ update sau
    });
  }, [timeframes, selectedSymbol]);

  // NOTE: load-newer handlers intentionally removed.
  // Realtime WebSocket continuously appends/updates the latest candle,
  // so explicit REST loading of newer data is unnecessary.

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Realtime Chart – Đa khung thời gian
          </h2>
          {currentPrice > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">
              {selectedSymbol} · {currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT
            </p>
          )}
                  </div>
        <div className="flex items-center gap-4">
          <StatusPill status={wsStatus} latency={latency} />
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 rounded-xl hover:bg-slate-50 border border-slate-100 text-slate-500 hover:text-slate-950 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
          </button>
                  </div>
      </header>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
          <button
            className="ml-auto underline text-red-800 font-bold"
            onClick={() => setError(null)}
          >
            Đóng
          </button>
                  </div>
      )}

      {/* ── Control bar ─────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-6">
          {/* Symbol selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Symbol / Coin
            </label>
            <div className="relative">
              <select
                className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200/80 font-bold text-sm text-slate-800 hover:border-slate-300 transition-colors px-3 py-2 rounded-xl cursor-pointer pr-8 disabled:cursor-not-allowed disabled:opacity-50"
                value={selectedSymbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                disabled={isChangingSymbol || loadingConfigs}
              >
                {availableSymbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
              {isChangingSymbol ? (
                <Loader2 className="w-4 h-4 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none animate-spin" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              )}
                  </div>
                  </div>
                  </div>

        {/* Realtime toggle */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-slate-600">Realtime</span>
            <button
              className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${
                wsStatus === "connected"
                  ? "bg-blue-600"
                  : "bg-slate-300 cursor-not-allowed"
              }`}
              onClick={() => {
                if (wsStatus === "connected") disconnect();
                else connect();
              }}
            >
              <span
                className={`w-4.5 h-4.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                  wsStatus === "connected" ? "translate-x-5.5" : "translate-x-1"
                }`}
              />
            </button>
                </div>
              </div>
      </section>

      {/* ── Main grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Chart panes — 4 rows stacked */}
        <div className="xl:col-span-3 grid grid-cols-1 gap-4">
          {loadingConfigs ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-[280px] animate-pulse flex flex-col gap-4"
                >
                  <div className="h-4 bg-slate-100 rounded w-1/2" />
                  <div className="flex-1 bg-slate-50 rounded" />
                  </div>
              ))}
            </>
          ) : chartCount === 0 ? (
            <div className="col-span-1 flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <AlertCircle className="w-8 h-8" />
              <p className="font-semibold">Không tìm thấy chart config nào.</p>
              <p className="text-sm">Kiểm tra lại backend và database.</p>
                  </div>
          ) : (
            Array.from({ length: chartCount }, (_, chartIndex) => {
              const tf = timeframes[chartIndex];
              console.log(`[Render] chartIndex=${chartIndex}, tf=${tf}, chartCount=${chartCount}`);
              if (!tf) return null;
              
              const candles = candlesData[tf] ?? [];
              return (
                <LightweightChartPane
                  key={chartIndex}
                  chartIndex={chartIndex}
                  tf={tf}
                  candles={candles}
                  onTimeframeChange={handleTimeframeChange}
                  isLoadingTf={loadingTfCharts.has(chartIndex)}
                  onLoadOlder={() => handleLoadOlder(chartIndex)}
                  hasMoreData={hasMoreData[tf] ?? true}
                  symbol={selectedSymbol}
                />
              );
            })
          )}
                </div>
                
        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* Logic cập nhật candle */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3.5">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Logic cập nhật candle</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-700">
                Trùng nến cuối → Update candle
              </span>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                openTime giống nến cuối → ghi đè dữ liệu mới nhất.
              </p>
                  </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-700">
                Nến mới hoàn toàn → Append candle
              </span>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                openTime mới → thêm nến vào cuối, xóa nến cũ nhất nếu quá 100.
              </p>
            </div>
          </article>

          {/* Trạng thái kết nối */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Trạng thái kết nối</h3>
              <span
                className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  wsStatus === "connected"
                    ? "text-emerald-600 bg-emerald-50"
                    : "text-slate-400 bg-slate-50"
                }`}
              >
                <span
                  className={`w-1 h-1 rounded-full ${
                    wsStatus === "connected" ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
                {wsStatus === "connected"
                  ? "Đã kết nối"
                  : wsStatus === "reconnecting"
                    ? "Đang kết nối lại"
                    : "Chưa kết nối"}
              </span>
            </div>
            
            <table className="w-full text-xs font-semibold text-slate-600">
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Nguồn dữ liệu</td>
                  <td className="py-2 text-right text-slate-800 font-bold">
                    Binance WebSocket
                  </td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Độ trễ</td>
                  <td className="py-2 text-right text-slate-800 font-bold">
                    {latency !== null ? `${latency} ms` : "—"}
                  </td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Số candle đã tải</td>
                  <td className="py-2 text-right text-slate-800 font-bold">
                    {allCandles.length}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-400">Kết nối</td>
                  <td
                    className={`py-2 text-right font-extrabold ${
                      wsStatus === "connected"
                        ? "text-emerald-600"
                        : "text-slate-400"
                    }`}
                  >
                    {wsStatus === "connected" ? "Ổn định" : "Chưa kết nối"}
                  </td>
                </tr>
              </tbody>
            </table>
          </article>

          {/* Recent ticks — computed from first chart's candle data */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Giá mới nhất</h3>
              <span className="text-[10px] font-bold text-slate-400">
                {timeframes[0] ?? "—"}
              </span>
            </div>
            
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-xs font-bold text-slate-600">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider text-left">
                    <th className="py-2 px-3">Thời gian</th>
                    <th className="py-2 px-2 text-right">Giá</th>
                    <th className="py-2 px-2 text-right">Khối lượng</th>
                    <th className="py-2 px-3 text-right">Loại</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const firstTf = timeframes[0];
                    const firstCandles = firstTf ? (candlesData[firstTf] ?? []) : [];
                    if (firstCandles.length === 0) {
                      return (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-[10px] text-slate-400 font-medium">
                            Đang tải dữ liệu…
                          </td>
                        </tr>
                      );
                    }
                    // Compute the strategy signals for the first chart's
                    // candles so the tick-table reflects the same BUY/SELL
                    // values that the chart markers use.
                    const sigs = computeMASignals(firstCandles, 9, 21);
                    const signalByTime = new Map<number, "BUY" | "SELL">();
                    for (const s of sigs) {
                      if (s.side !== "HOLD") signalByTime.set(s.openTime, s.side);
                    }
                    return firstCandles
                      .slice(-10)
                      .reverse()
                      .map((c, i) => {
                        const sig = signalByTime.get(c.openTime);
                        // Fallback to direction-of-candle only when the
                        // strategy hasn't emitted a signal yet (warm-up).
                        const pill = sig ?? (c.close >= c.open ? "BUY" : "SELL");
                        const pillClass =
                          pill === "BUY"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-red-50 text-red-600";
                        return (
                          <tr
                            key={`${c.openTime}-${i}`}
                            className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors"
                          >
                            <td className="py-2 px-3 text-slate-500 font-medium">{c.time}</td>
                      <td className="py-2 px-2 text-right text-slate-800">
                              {c.close.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                              })}
                      </td>
                            <td className="py-2 px-2 text-right text-slate-500 font-medium">
                              {c.volume.toFixed(0)}
                            </td>
                      <td className="py-2 px-3 text-right">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${pillClass}`}
                              >
                                {pill}
                        </span>
                      </td>
                    </tr>
                        );
                      });
                  })()}
                </tbody>
              </table>
            </div>
          </article>

          {/* Chú thích */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Chú thích</h3>
            
            <div className="flex flex-col gap-3 text-xs font-semibold text-slate-600">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 h-2.5 bg-emerald-500 rounded-xs inline-block" />
                  <span>Nến tăng (Close &gt; Open)</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-black text-[9px]">
                  BUY
                </span>
                <span className="text-[11px] text-slate-400">Tín hiệu Mua</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 h-2.5 bg-red-500 rounded-xs inline-block" />
                  <span>Nến giảm (Close &lt; Open)</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 font-black text-[9px]">
                  SELL
                </span>
                <span className="text-[11px] text-slate-400">Tín hiệu Bán</span>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-50">
                <span className="w-4 h-0.5 bg-blue-500 inline-block" />
                <span>MA(21) – Slow SMA của Moving Average Crossover</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-emerald-500 inline-block" style={{ clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" }} />
                <span>BUY – Golden cross (fast SMA lên trên slow SMA)</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500 inline-block" style={{ clipPath: "polygon(0% 0%, 100% 0%, 50% 100%)" }} />
                <span>SELL – Death cross (fast SMA xuống dưới slow SMA)</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-4 h-2 bg-slate-300 rounded-xs inline-block" />
                <span>Volume – Khối lượng giao dịch</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
