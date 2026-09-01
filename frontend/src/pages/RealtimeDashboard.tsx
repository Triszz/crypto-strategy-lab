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
import LightweightCandlestickChart from "../components/LightweightCandlestickChart";

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

function computeMA(candles: LocalCandle[], period: number = 20): (number | null)[] {
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
  priceChangePct,
  onTimeframeChange,
  isLoadingTf,
  onLoadOlder,
}: {
  chartIndex: number;
  tf: Timeframe;
  candles: LocalCandle[];
  priceChangePct: number;
  onTimeframeChange: (chartIndex: number, newTf: Timeframe) => void;
  isLoadingTf: boolean;
  onLoadOlder: () => void;
}) {
  const lastCandle = candles[candles.length - 1];
  const isUp = priceChangePct >= 0;

  return (
    <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 relative overflow-hidden group hover:shadow-md hover:border-slate-200/70 transition-all">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm text-slate-800">
              {lastCandle ? "BTCUSDT" : "—"}
            </span>
            <div className="relative">
              <select
                className="appearance-none bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs font-bold px-2.5 py-1 rounded-lg cursor-pointer pr-7 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={tf}
                onChange={(e) => onTimeframeChange(chartIndex, e.target.value as Timeframe)}
              >
                {(["1m", "5m", "15m", "1h", "4h", "1d"] as Timeframe[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-blue-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {isLoadingTf && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-bold text-blue-500 uppercase">MA(15)</span>
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

      <LightweightCandlestickChart
        candles={candles}
        onLoadOlder={onLoadOlder}
      />

      <div className="flex justify-between items-center border-t border-slate-100 pt-3 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-500">Cập nhật realtime</span>
          <span className="w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm bg-emerald-500" />
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
  priceChangePct,
  onTimeframeChange,
  isLoadingTf,
  onLoadOlder,
}: {
  chartIndex: number;
  tf: Timeframe;
  candles: LocalCandle[];
  currentPrice: number;
  priceChangePct: number;
  onTimeframeChange: (chartIndex: number, newTf: Timeframe) => void;
  isLoadingTf: boolean;
  onLoadOlder: () => void;
}) {
  const lastCandle = candles[candles.length - 1];
  const isUp = priceChangePct >= 0;

  // MA(15)
  const maVals = computeMA(candles, 15);

  // SVG dimensions
  const W = 500;
  const priceH = 180;
  const volH = 70;
  const padR = 65, padTop = 20, padBot = 20;
  const volGap = 8;

  const VISIBLE_CANDLES = 60;
  const LOAD_MARGIN = 8; // candles from edge before triggering load

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

      // Near LEFT edge (viewing oldest data) → load older
      const nearLeftEdge = newStartIdx <= LOAD_MARGIN && !viewport.isLoadingOlder;
      if (nearLeftEdge && totalCandles > 0) {
        setViewport((prev) => ({ ...prev, isLoadingOlder: true }));
        onLoadOlder();
        setTimeout(() => {
          setViewport((prev) => ({ ...prev, isLoadingOlder: false }));
        }, 1500);
      }
      // NOTE: load newer is intentionally removed — WebSocket continuously
      // appends/updates the latest candle in real time.
    },
    [isDragging, dragStartX, dragStartStartIdx, candleWidth, maxStartIdx,
     viewport.isLoadingOlder, totalCandles, onLoadOlder],
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
                {(["1m", "5m", "15m", "1h", "4h", "1d"] as Timeframe[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-blue-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {isLoadingTf && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-bold text-blue-500 uppercase">MA(15)</span>
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
  // Chart pane configs loaded from backend (default: BTCUSDT + 4 timeframes)
  const [chartConfigs, setChartConfigs] = useState<ChartConfig[]>([]);

  // Per-chart current timeframe (keyed by chartIndex)
  const [timeframes, setTimeframes] = useState<Record<number, Timeframe>>({});

  // Candle data keyed by timeframe (each chart has unique tf)
  const [candlesData, setCandlesData] = useState<Record<string, LocalCandle[]>>({});
  console.log(candlesData);
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
  const firstCandle = allCandles[0];
  const currentPrice = lastCandle?.close ?? 0;
  const priceChangePct =
    lastCandle && firstCandle && lastCandle.close && firstCandle.close
      ? ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100
      : 0;

  // ── 1. Load chart configs on mount ──────────────────────────────────────
  useEffect(() => {
    fetchChartConfigs()
      .then((configs) => {
        setChartConfigs(configs);
        setLoadingConfigs(false);
      })
      .catch((err) => {
        setError(`Không tải được chart config: ${errorMessage(err)}`);
        setLoadingConfigs(false);
      });
  }, []);

  // ── 2. Init timeframes from chart configs + load initial candles ───────────
  useEffect(() => {
    if (chartConfigs.length === 0) return;
    setError(null);

    // Initialize per-chart timeframes from config
    const initTf: Record<number, Timeframe> = {};
    for (const cfg of chartConfigs) {
      initTf[cfg.chartIndex] = cfg.timeframe;
    }
    setTimeframes(initTf);

    // Fetch candles for each config's timeframe sequentially
    (async () => {
      const next: Record<string, LocalCandle[]> = {};
      try {
        for (const cfg of chartConfigs) {
          const candles = await fetchCandles({
            symbol: cfg.symbol,
            timeframe: cfg.timeframe,
            limit: 100,
          });
          next[cfg.timeframe] = candles.map((c) => rawToLocal(c, cfg.timeframe));
        }
        setCandlesData(next);
      } catch (err) {
        setError(`Không tải được candle: ${errorMessage(err)}`);
      }
    })();
  }, [chartConfigs]);

  // ── 3. Socket connection ─────────────────────────────────────────────────
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
      const tf = event.payload.timeframe as Timeframe;

      setCandlesData((prev) => {
        const list = prev[tf] ?? [];
        return {
          ...prev,
          [tf]: updateCandleList(list, candle as RawCandle, tf),
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
  }, []);

  // ── 4. Subscribe to streams when configs + socket ready ──────────────────
  useEffect(() => {
    if (chartConfigs.length === 0) return;
    if (!isConnected()) return;

    const tfMap = new Map<string, Timeframe[]>();
    for (const cfg of chartConfigs) {
      const existing = tfMap.get(cfg.symbol) ?? [];
      tfMap.set(cfg.symbol, [...existing, cfg.timeframe]);
    }

    for (const [symbol, timeframes] of tfMap) {
      subscribe(symbol, timeframes);
    }
  }, [chartConfigs]);

  // ── 5. Handle per-chart timeframe change ───────────────────────────────────
  const handleTimeframeChange = useCallback(
    async (chartIndex: number, newTf: Timeframe) => {
      const currentTf = timeframes[chartIndex];
      if (currentTf === newTf) return;

      // Check for conflict: another chart already uses this timeframe
      const conflict = chartConfigs.find(
        (c) => c.chartIndex !== chartIndex && c.timeframe === newTf,
      );
      if (conflict) {
        setError(`Timeframe ${newTf} đã được sử dụng ở chart ${conflict.chartIndex + 1}. Không thể chọn trùng.`);
        return;
      }

      // Mark chart as loading
      setLoadingTfCharts((prev) => new Set(prev).add(chartIndex));

      // Update timeframe immediately (optimistic)
      setTimeframes((prev) => ({ ...prev, [chartIndex]: newTf }));

      // Clear old candles for the old timeframe (no longer needed)
      setCandlesData((prev) => {
        const next = { ...prev };
        delete next[currentTf];
        return next;
      });

      try {
        // Update chart config in backend
        await updateChartConfig({
          chartIndex,
          symbol: "BTCUSDT",
          timeframe: newTf,
        });

        // Fetch new candles
        const result = await fetchCandles({
          symbol: "BTCUSDT",
          timeframe: newTf,
          limit: 100,
        });
        setCandlesData((prev) => ({
          ...prev,
          [newTf]: result.map((c) => rawToLocal(c, newTf)),
        }));

        // Update local chartConfigs to reflect the change
        setChartConfigs((prev) =>
          prev.map((c) =>
            c.chartIndex === chartIndex ? { ...c, timeframe: newTf } : c,
          ),
        );
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
    [timeframes, chartConfigs],
  );

  // ── 6. Load older data handler per chart ────────────────────────────────
  const loadOlderHandlers = useMemo(() => {
    const handlers: Record<number, () => void> = {};
    for (const cfg of chartConfigs) {
      const tf = timeframes[cfg.chartIndex] ?? cfg.timeframe;
      handlers[cfg.chartIndex] = () => {
        setCandlesData((currentData) => {
          const currentCandles = currentData[tf] ?? [];
          const oldestCandle = currentCandles[0];
          if (!oldestCandle) return currentData;

          loadMoreCandles({
            symbol: cfg.symbol,
            timeframe: tf,
            beforeMs: oldestCandle.openTime,
            limit: 100,
          }).then(({ candles: older }) => {
            if (older.length === 0) return;
            const olderLocal = older.map((c) => rawToLocal(c, tf));
            setCandlesData((prev) => {
              const existing = prev[tf] ?? [];
              const merged = [...olderLocal, ...existing].sort(
                (a, b) => a.openTime - b.openTime,
              );
              return {
                ...prev,
                [tf]: merged.length > 500 ? merged.slice(-500) : merged,
              };
            });
          }).catch(() => {});

          return currentData;
        });
      };
    }
    return handlers;
  }, [chartConfigs, timeframes]);

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
              BTCUSDT · {currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT
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
          {/* Pair */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Pair / Coin
            </label>
            <div className="relative">
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 font-bold text-sm text-slate-800 hover:border-slate-300 transition-colors min-w-[130px] justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-[10px] shadow-sm">
                    ₿
                  </span>
                  BTCUSDT
                </span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>
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
          ) : chartConfigs.length === 0 ? (
            <div className="col-span-1 flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <AlertCircle className="w-8 h-8" />
              <p className="font-semibold">Không tìm thấy chart config nào.</p>
              <p className="text-sm">Kiểm tra lại backend và database.</p>
                  </div>
          ) : (
            chartConfigs.map((cfg) => {
            const tf = timeframes[cfg.chartIndex] ?? cfg.timeframe;
            const candles = candlesData[tf] ?? [];
            return (
              <LightweightChartPane
                key={cfg.chartIndex}
                chartIndex={cfg.chartIndex}
                tf={tf}
                candles={candles}
                priceChangePct={priceChangePct}
                onTimeframeChange={handleTimeframeChange}
                isLoadingTf={loadingTfCharts.has(cfg.chartIndex)}
                onLoadOlder={loadOlderHandlers[cfg.chartIndex] ?? (() => {})}
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
                {chartConfigs[0] ? (timeframes[chartConfigs[0].chartIndex] ?? chartConfigs[0].timeframe) : "—"}
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
                    const firstTf = chartConfigs[0] ? (timeframes[chartConfigs[0].chartIndex] ?? chartConfigs[0].timeframe) : null;
                    const firstCandles = firstTf ? (candlesData[firstTf] ?? []) : [];
                    return firstCandles
                      .slice(-10)
                      .reverse()
                      .map((c, i) => {
                        const prev = firstCandles[firstCandles.length - 10 + i];
                        const isUp = prev ? c.close >= prev.close : true;
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
                                className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${
                                  isUp
                                    ? "bg-emerald-50 text-emerald-600"
                                    : "bg-red-50 text-red-600"
                                }`}
                              >
                                {isUp ? "BUY" : "SELL"}
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
                <span>MA(15) – Đường trung bình biến động 15</span>
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
