import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
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

interface LightweightChartProps {
  candles: LightweightCandle[];
  onLoadOlder: () => void;
  hasMoreData?: boolean;
}

type CandleSeries = ISeriesApi<"Candlestick">;
type VolumeSeries = ISeriesApi<"Histogram">;
type MaSeries = ISeriesApi<"Line">;

function toTime(openTime: number): UTCTimestamp {
  return Math.floor(openTime / 1000) as UTCTimestamp;
}

function makeMovingAverage(candles: LightweightCandle[], period: number) {
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) {
      sum -= candles[index - period].close;
    }
    if (index >= period - 1) {
      result.push({ time: toTime(candles[index].openTime), value: sum / period });
    }
  }

  return result;
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
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<CandleSeries | null>(null);
  const volumeSeriesRef = useRef<VolumeSeries | null>(null);
  const maSeriesRef = useRef<MaSeries | null>(null);
  const previousLastTimeRef = useRef<number | null>(null);
  const previousFirstTimeRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const hasMoreDataRef = useRef(true); // Track if backend has more historical data
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Sync external hasMoreData prop to ref
  useEffect(() => {
    hasMoreDataRef.current = hasMoreData;
  }, [hasMoreData]);

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
      title: "MA 15",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    maSeriesRef.current = maSeries;

    const onVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range) return;

      // Auto-load older candles when user scrolls to the left edge
      // Stop if we've hit the end of available historical data
      if (
        range.from <= 2 &&
        sortedCandles.length > 0 &&
        !loadingOlderRef.current &&
        hasMoreDataRef.current
      ) {
        loadingOlderRef.current = true;
        setIsLoadingOlder(true);
        onLoadOlder();
        window.setTimeout(() => {
          loadingOlderRef.current = false;
          setIsLoadingOlder(false);
        }, 1200);
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = null;
    };
  }, [onLoadOlder]);

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
        color: lastCandle.close >= lastCandle.open
          ? "rgba(16, 185, 129, 0.7)"
          : "rgba(239, 68, 68, 0.7)",
      });
      const movingAverage = makeMovingAverage(sortedCandles, 15);
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
          color: candle.close >= candle.open
            ? "rgba(16, 185, 129, 0.7)"
            : "rgba(239, 68, 68, 0.7)",
        })),
      );
      maSeries.setData(makeMovingAverage(sortedCandles, 15));

      // Always scroll to latest when new data arrives
      chartRef.current?.timeScale().scrollToRealTime();
    }

    previousFirstTimeRef.current = firstTime;
    previousLastTimeRef.current = lastTime;
  }, [sortedCandles]);

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
        onClick={onLoadOlder}
        className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-slate-900 hover:shadow-xl"
        title="Load thêm 100 nến lịch sử"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
        </svg>
        <span>Load 100</span>
      </button>
    </div>
  );
}
