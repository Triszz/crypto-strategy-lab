export interface RunBacktestPayload {
  /** UUID of a persisted CandidateStrategy (Search → Backtest path). */
  candidateId?: string;
  symbol?: string;
  timeframe?: string;
  strategyName?: string;
  initialCapital?: number;
  feePercent?: number;
  slippageBps?: number;
  fromTime?: number;
  toTime?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  sync?: boolean;
}

export interface TradeItemApi {
  id: string;
  entryTime: number | string;
  exitTime: number | string;
  entryPrice: number;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  fee: number;
  slippage: number;
  profitLoss: number;
  profitLossPct: number;
  entryReason: string;
  exitReason: string;
}

export interface BacktestMetricsApi {
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  annualReturn: number | null;
  winRate: number;
  maxDrawdown: number;
  numTrades: number;
  numWinningTrades: number;
  numLosingTrades: number;
  overallScore: number;
}

export interface EquityPointApi {
  timestamp: number;
  capital: number;
  drawdownPct: number;
}

export interface BacktestRunResponseData {
  experimentId: string;
  symbol: string;
  timeframe: string;
  strategyName: string;
  result: {
    metrics: BacktestMetricsApi;
    trades: TradeItemApi[];
    equityCurve: EquityPointApi[];
  };
  candles?: Array<{
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface JobProgressResponseData {
  jobId: string;
  progress: number;
  status: 'WAITING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  result?: BacktestRunResponseData;
  error?: string;
}

const API_BASE_URL = 'http://localhost:3000/api';

export const backtestApi = {
  /**
   * Triggers backtest run via backend REST API.
   */
  async runBacktest(payload: RunBacktestPayload): Promise<{ jobId?: string; result?: BacktestRunResponseData }> {
    try {
      const response = await fetch(`${API_BASE_URL}/backtests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, sync: true }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.success && json.data) {
        if (json.data.result) {
          return { result: json.data };
        }
        return { jobId: json.data.jobId };
      }
      throw new Error(json.error?.message || 'Failed to start backtest');
    } catch (err: any) {
      console.warn('API call failed, fallback simulation used:', err);
      throw err;
    }
  },

  /**
   * Fetches job status & progress.
   */
  async getJobStatus(jobId: string): Promise<JobProgressResponseData> {
    const response = await fetch(`${API_BASE_URL}/backtests/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch job status: HTTP ${response.status}`);
    }
    const json = await response.json();
    return json.data;
  },

  /**
   * Fetches list of executed backtests.
   */
  async listBacktests() {
    const response = await fetch(`${API_BASE_URL}/backtests`);
    if (!response.ok) throw new Error('Failed to list backtests');
    const json = await response.json();
    return json.data;
  },
};
