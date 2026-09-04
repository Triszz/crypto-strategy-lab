import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarkerBar,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export interface LightweightCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  id: string;
  entryTime: number | string;
  exitTime?: number | string;
  entryPrice: number;
  exitPrice?: number;
  direction: 'LONG' | 'SHORT';
  profitLoss?: number;
}

/**
 * BUY / SELL signal markers computed from the MA-crossover strategy.
 * `openTime` is epoch ms (matches `LightweightCandle.openTime`).
 * The chart converts these into a lightweight-charts `SeriesMarkerBar[]`
 * and applies them via `candleSeries.setMarkers(...)` (via plugin API).
 */
export interface ChartSignal {
  openTime: number;
  side: "BUY" | "SELL";
}

interface LightweightChartProps {
  candles: LightweightCandle[];
  onLoadOlder: () => void;
  hasMoreData?: boolean;
  trades?: TradeMarker[];
  highlightedTrade?: TradeMarker | null;
  /**
   * BUY/SELL signal markers for the current candle series. One marker
   * per signal candle. The chart dedupes by `openTime` so repeated
   * realtime updates to the same candle never produce duplicate arrows.
   *
   * Default: `[]` (no markers).
   */
  signals?: ReadonlyArray<ChartSignal>;
}

type CandleSeries = ISeriesApi<"Candlestick">;
type VolumeSeries = ISeriesApi<"Histogram">;
type MaSeries = ISeriesApi<"Line">;
// `createSeriesMarkers` returns an `ISeriesMarkersPluginApi<Time>` whose
// `markers()` getter is generic over the chart's default Time type. We
// pin both the plugin and the marker shape to `Time` to match what
// `createSeriesMarkers` returns, then feed it only UTCTimestamp values
// (which are a subset of `Time`).
type MarkersPlugin = ISeriesMarkersPluginApi<Time>;
type BarMarker = SeriesMarkerBar<Time>;

function toTime(openTime: number): UTCTimestamp {
  return Math.floor(openTime / 1000) as UTCTimestamp;
}

/**
 * Default MA period drawn on the chart. Matches the slow period of the
 * project's `MovingAverageStrategy` (default 21), so the line is
 * visually comparable with the strategy's slow SMA reference.
 *
 * IMPORTANT: keep in sync with
 * `backend/src/.../strategies/MovingAverageStrategy.ts` → PARAM_SPEC.
 */
export const DEFAULT_MA_PERIOD = 21;

function makeMovingAverage(
  candles: LightweightCandle[],
  period: number,
): Array<{ time: UTCTimestamp; value: number }> {
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  if (!Number.isInteger(period) || period <= 0) return result;
  let sum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) {
      sum -= candles[index - period].close;
    }
    if (index >= period - 1) {
      result.push({
        time: toTime(candles[index].openTime),
        value: sum / period,
      });
    }
  }

  return result;
}

/**
 * Convert the public `ChartSignal[]` into lightweight-charts
 * `SeriesMarkerBar[]`.
 *  - One marker per signal candle.
 *  - Deduplicated by `openTime` (realtime updates reuse the same
 *    candle, so the marker set stays stable).
 *  - Markers MUST be sorted ascending by time (lightweight-charts
 *    throws otherwise).
 */
function buildSignalMarkers(
  candles: LightweightCandle[],
  signals: ReadonlyArray<ChartSignal>,
): BarMarker[] {
  if (signals.length === 0 || candles.length === 0) return [];

  // Index candles by openTime for O(1) lookup.
  const candleByTime = new Map<number, LightweightCandle>();
  for (const c of candles) candleByTime.set(c.openTime, c);

  const seen = new Set<number>();
  const out: BarMarker[] = [];
  for (const s of signals) {
    if (seen.has(s.openTime)) continue;
    seen.add(s.openTime);
    const candle = candleByTime.get(s.openTime);
    if (!candle) continue;

    if (s.side === "BUY") {
      out.push({
        time: toTime(s.openTime),
        position: "belowBar",
        color: "#10b981",
        shape: "arrowUp",
        text: "BUY",
      });
    } else {
      out.push({
        time: toTime(s.openTime),
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: "SELL",
      });
    }
  }
  out.sort((a, b) => (a.time as number) - (b.time as number));
  return out;
}

/**
 * Renders the same historical and realtime data with TradingView's
 * Lightweight Charts. The component owns the chart lifecycle so each
 * chart pane can be zoomed and panned independently.
 */
export default function LightweightCandlestickChart({
  candles,
  onLoadOlder,
  hasMoreData = true,
  highlightedTrade,
  signals,
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<CandleSeries | null>(null);
  const volumeSeriesRef = useRef<VolumeSeries | null>(null);
  const maSeriesRef = useRef<MaSeries | null>(null);
  // Plugin instance is created via createSeriesMarkers; held in a ref
  // so subsequent prop updates can call setMarkers without recreating.
  const markersPluginRef = useRef<MarkersPlugin | null>(null);
  const previousLastTimeRef = useRef<number | null>(null);
  const previousFirstTimeRef = useRef<number | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Track loading state when user clicks "Load 100" button
  const handleLoadOlder = () => {
    if (isLoadingOlder) return;
    setIsLoadingOlder(true);
    onLoadOlder();
    window.setTimeout(() => {
      setIsLoadingOlder(false);
    }, 1200);
  };

  const sortedCandles = useMemo(() => {
    // Sort by time first
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);

    // Deduplicate by openTime - keep the LAST occurrence of each timestamp
    const deduplicated: LightweightCandle[] = [];
    const seen = new Map<number, number>(); // openTime -> index in deduplicated array

    for (const candle of sorted) {
      const existingIndex = seen.get(candle.openTime);
      if (existingIndex !== undefined) {
        // Replace existing candle with newer data
        deduplicated[existingIndex] = candle;
      } else {
        // New timestamp
        seen.set(candle.openTime, deduplicated.length);
        deduplicated.push(candle);
      }
    }

    return deduplicated;
  }, [candles]);

  // Pre-compute the signal markers for the current candle set.
  // Depends on sortedCandles + signals so it recomputes on either
  // change. The dedup-by-openTime inside buildSignalMarkers guarantees
  // realtime updates never produce duplicate markers for the same
  // candle.
  const signalMarkers = useMemo(
    () => buildSignalMarkers(sortedCandles, signals ?? []),
    [sortedCandles, signals],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#94a3b8",
        fontSize: 11,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" },
      },
      rightPriceScale: {
        borderColor: "#e2e8f0",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#e2e8f0",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 7,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#94a3b8", labelBackgroundColor: "#2563eb" },
        horzLine: { color: "#94a3b8", labelBackgroundColor: "#2563eb" },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
      wickVisible: true,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#94a3b8",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const maSeries = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 2,
      title: `MA ${DEFAULT_MA_PERIOD}`,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Series-markers plugin (lightweight-charts v5): create once, hold
    // a ref, then call setMarkers whenever the signal set changes.
    const markersPlugin = createSeriesMarkers(candleSeries);
    markersPlugin.setMarkers([]);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    maSeriesRef.current = maSeries;
    markersPluginRef.current = markersPlugin;

    // NOTE: Auto-load when scrolling to edge is intentionally removed.
    // User must click "Load 100" button to manually trigger load-more.

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, []);

  // ── Sync candle / volume / MA series ────────────────────────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const maSeries = maSeriesRef.current;
    if (!candleSeries || !volumeSeries || !maSeries) return;

    if (sortedCandles.length === 0) {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      maSeries.setData([]);
      previousLastTimeRef.current = null;
      previousFirstTimeRef.current = null;
      return;
    }

    const firstTime = sortedCandles[0].openTime;
    const lastTime = sortedCandles[sortedCandles.length - 1].openTime;
    const sameHistory =
      previousFirstTimeRef.current === firstTime &&
      previousLastTimeRef.current === lastTime;
    const lastCandle = sortedCandles[sortedCandles.length - 1];

    if (sameHistory) {
      // This is the normal CandleUpdating path: update only the latest bar.
      candleSeries.update({
        time: toTime(lastCandle.openTime),
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: lastCandle.close,
      });
      volumeSeries.update({
        time: toTime(lastCandle.openTime),
        value: lastCandle.volume,
        color:
          lastCandle.close >= lastCandle.open
            ? "rgba(16, 185, 129, 0.7)"
            : "rgba(239, 68, 68, 0.7)",
      });
      const movingAverage = makeMovingAverage(sortedCandles, DEFAULT_MA_PERIOD);
      const latestAverage = movingAverage[movingAverage.length - 1];
      if (latestAverage) maSeries.update(latestAverage);
    } else {
      // Initial data or a newly loaded older page: replace the complete set.
      candleSeries.setData(
        sortedCandles.map((candle) => ({
          time: toTime(candle.openTime),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
      volumeSeries.setData(
        sortedCandles.map((candle) => ({
          time: toTime(candle.openTime),
          value: candle.volume,
          color:
            candle.close >= candle.open
              ? "rgba(16, 185, 129, 0.7)"
              : "rgba(239, 68, 68, 0.7)",
        })),
      );
      maSeries.setData(makeMovingAverage(sortedCandles, DEFAULT_MA_PERIOD));

      // Always scroll to latest when new data arrives
      chartRef.current?.timeScale().scrollToRealTime();
    }

    previousFirstTimeRef.current = firstTime;
    previousLastTimeRef.current = lastTime;
  }, [sortedCandles]);

  // ── Sync signal markers ────────────────────────────────────────────
  // Separate effect so realtime candle updates and signal prop updates
  // are independent. `signalMarkers` is memoised and dedup-by-openTime,
  // so repeated realtime updates to the same candle just regenerate the
  // same marker set.
  useEffect(() => {
    const plugin = markersPluginRef.current;
    if (!plugin) return;
    plugin.setMarkers(signalMarkers);
  }, [signalMarkers]);

  const activePriceLinesRef = useRef<IPriceLine[]>([]);
  const [eventTrade, setEventTrade] = useState<TradeMarker | null>(null);

  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !detail.tradeId) {
        setEventTrade(null);
      } else {
        setEventTrade({
          id: detail.tradeId,
          entryTime: detail.entryTime,
          exitTime: detail.exitTime,
          entryPrice: detail.entryPrice,
          exitPrice: detail.exitPrice,
          direction: detail.direction,
        });
      }
    };
    window.addEventListener("HIGHLIGHT_TRADE_ON_CHART", handleCustomEvent);
    return () => window.removeEventListener("HIGHLIGHT_TRADE_ON_CHART", handleCustomEvent);
  }, []);

  const activeHighlight = highlightedTrade ?? eventTrade;

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;

    // Clear previous price lines
    if (candleSeries && activePriceLinesRef.current.length > 0) {
      for (const line of activePriceLinesRef.current) {
        try {
          candleSeries.removePriceLine(line);
        } catch (_) {}
      }
      activePriceLinesRef.current = [];
    }

    if (!candleSeries || !chart || !activeHighlight) return;

    try {
      const entryTimeMs =
        typeof activeHighlight.entryTime === "string"
          ? new Date(activeHighlight.entryTime).getTime()
          : activeHighlight.entryTime;
      const exitTimeMs = activeHighlight.exitTime
        ? typeof activeHighlight.exitTime === "string"
          ? new Date(activeHighlight.exitTime).getTime()
          : activeHighlight.exitTime
        : entryTimeMs;

      const entryPriceLine = candleSeries.createPriceLine({
        price: activeHighlight.entryPrice,
        color: activeHighlight.direction === "LONG" ? "#10b981" : "#ef4444",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `[${activeHighlight.direction}] Entry: $${activeHighlight.entryPrice.toLocaleString()}`,
      });
      activePriceLinesRef.current.push(entryPriceLine);

      if (activeHighlight.exitPrice) {
        const exitPriceLine = candleSeries.createPriceLine({
          price: activeHighlight.exitPrice,
          color: "#3b82f6",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Exit: $${activeHighlight.exitPrice.toLocaleString()}`,
        });
        activePriceLinesRef.current.push(exitPriceLine);
      }

      // Zoom/Focus chart to trade timestamp window
      const entrySec = Math.floor(entryTimeMs / 1000) as UTCTimestamp;
      const exitSec = Math.floor(exitTimeMs / 1000) as UTCTimestamp;
      const durationSec = Math.max(3600, exitSec - entrySec);

      const fromSec = Math.max(0, entrySec - durationSec * 2) as UTCTimestamp;
      const toSec = (exitSec + durationSec * 2) as UTCTimestamp;

      try {
        chart.timeScale().setVisibleRange({ from: fromSec, to: toSec });
      } catch (_) {}
    } catch (err) {
      console.warn("Could not set trade highlight on chart:", err);
    }
  }, [activeHighlight]);

  return (
    <div className="relative w-full">
      <div ref={containerRef} className="h-[278px] w-full" />

      {isLoadingOlder && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-lg">
          Đang tải dữ liệu cũ…
        </div>
      )}

      {/* Load 100 historical candles button */}
      <button
        type="button"
        onClick={handleLoadOlder}
        disabled={isLoadingOlder || !hasMoreData}
        className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-slate-900 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
        title="Load thêm 100 nến lịch sử"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
        </svg>
        <span>{isLoadingOlder ? "Đang tải..." : "Load 100"}</span>
      </button>
    </div>
  );
}
