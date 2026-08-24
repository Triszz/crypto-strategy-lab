import type { Timeframe } from "./Timeframe";
import { getStreamKey } from "./Timeframe";

/**
 * Lightweight projection of the `ChartConfig` table — the four slot
 * panes in the multi-chart UI (chartIndex 0..3).
 */
export interface ChartConfig {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  updatedAt: Date;
}

export interface ActiveChartConfig {
  chartIndex: number;
  symbol: string;
  timeframe: Timeframe;
  /** Cached namespaced stream key, e.g. `btcusdt@kline_1h`. */
  streamKey: ReturnType<typeof getStreamKey>;
}
