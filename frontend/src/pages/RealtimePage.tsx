import { useState, useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  Search,
  Star,
  Wifi,
  WifiOff,
  Activity,
  Volume2,
  BarChart3,
  Eye,
  EyeOff,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
} from 'lucide-react';

interface MarketPair {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  prevPrice: number;
  change24h: number;
  volume: number;
  high24h: number;
  low24h: number;
  trades: number;
  quoteVolume: number;
  spark: number[];
}

interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

interface RecentTrade {
  id: string;
  price: number;
  amount: number;
  time: number;
  side: 'buy' | 'sell';
}

const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

const pairsTemplate: Omit<MarketPair, 'price' | 'prevPrice' | 'spark'>[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', change24h: 2.34, volume: 1200000000, high24h: 68000, low24h: 65800, trades: 8421, quoteVolume: 1240000000 },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', change24h: -1.23, volume: 890000000, high24h: 3600, low24h: 3450, trades: 6234, quoteVolume: 890000000 },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', change24h: 0.87, volume: 234000000, high24h: 620, low24h: 605, trades: 1820, quoteVolume: 234000000 },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', change24h: 5.67, volume: 567000000, high24h: 185, low24h: 168, trades: 4102, quoteVolume: 567000000 },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', change24h: -0.45, volume: 123000000, high24h: 0.53, low24h: 0.51, trades: 920, quoteVolume: 123000000 },
  { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT', change24h: 1.89, volume: 89000000, high24h: 0.46, low24h: 0.44, trades: 612, quoteVolume: 89000000 },
  { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', change24h: 3.21, volume: 234000000, high24h: 0.13, low24h: 0.12, trades: 3214, quoteVolume: 234000000 },
  { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT', change24h: -2.34, volume: 156000000, high24h: 37, low24h: 35, trades: 1420, quoteVolume: 156000000 },
  { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT', change24h: 0.56, volume: 78000000, high24h: 8, low24h: 7.7, trades: 540, quoteVolume: 78000000 },
  { symbol: 'MATICUSDT', base: 'MATIC', quote: 'USDT', change24h: 1.12, volume: 145000000, high24h: 0.91, low24h: 0.87, trades: 1102, quoteVolume: 145000000 },
  { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT', change24h: 4.21, volume: 198000000, high24h: 18, low24h: 17, trades: 2104, quoteVolume: 198000000 },
  { symbol: 'ATOMUSDT', base: 'ATOM', quote: 'USDT', change24h: -0.78, volume: 64000000, high24h: 9.5, low24h: 9.1, trades: 480, quoteVolume: 64000000 },
];

function generateCandles(count: number, basePrice: number, vol = 0.005): CandlestickData<UTCTimestamp>[] {
  const candles: CandlestickData<UTCTimestamp>[] = [];
  let price = basePrice;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const time = (now - i * 300) as UTCTimestamp;
    const drift = (Math.random() - 0.5) * 2 * vol * price;
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + Math.random() * vol * price * 0.5;
    const low = Math.min(open, close) - Math.random() * vol * price * 0.5;
    candles.push({ time, open, high, low, close });
    price = close;
  }
  return candles;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function formatAmount(a: number): string {
  if (a >= 1000) return (a / 1000).toFixed(2) + 'K';
  if (a >= 1) return a.toFixed(2);
  return a.toFixed(4);
}

function formatVolume(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const w = 60;
  const h = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xs = data.map((_, i) => (i / (data.length - 1)) * w);
  const ys = data.map(v => h - ((v - min) / range) * h);
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const color = positive ? '#10b981' : '#ef4444';
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RealtimePage() {
  const [pairs, setPairs] = useState<MarketPair[]>(() =>
    pairsTemplate.map((p) => {
      const price = p.high24h - Math.random() * (p.high24h - p.low24h);
      const spark = Array.from({ length: 12 }, () => price + (Math.random() - 0.5) * (p.high24h - p.low24h) * 0.1);
      return { ...p, price, prevPrice: price, spark };
    })
  );
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']));
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [wsConnected] = useState(true);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const maSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  const selectedPair = useMemo(
    () => pairs.find(p => p.symbol === selectedSymbol) || pairs[0],
    [pairs, selectedSymbol]
  );

  // Simulate realtime price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setPairs(prev => prev.map(p => {
        const drift = (Math.random() - 0.5) * 0.001 * p.price;
        const newPrice = Math.max(p.low24h, Math.min(p.high24h, p.price + drift));
        const newSpark = [...p.spark.slice(1), newPrice];
        return { ...p, prevPrice: p.price, price: newPrice, spark: newSpark };
      }));
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Init chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#2a2d3a', style: 1 },
        horzLines: { color: '#2a2d3a', style: 1 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#c084fc', width: 1, style: 2, labelBackgroundColor: '#c084fc' },
        horzLine: { color: '#c084fc', width: 1, style: 2, labelBackgroundColor: '#c084fc' },
      },
      rightPriceScale: { borderColor: '#2a2d3a' },
      timeScale: { borderColor: '#2a2d3a', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const maSeries = chart.addSeries(LineSeries, { color: '#c084fc', lineWidth: 2 });
    maSeriesRef.current = maSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update chart data when symbol/timeframe changes
  useEffect(() => {
    if (!candleSeriesRef.current || !maSeriesRef.current || !volumeSeriesRef.current) return;

    const candles = generateCandles(200, selectedPair.price);
    candleSeriesRef.current.setData(candles);

    const maData: LineData<UTCTimestamp>[] = candles.map((candle, index) => {
      if (index < 20) return { time: candle.time, value: candle.close };
      const slice = candles.slice(Math.max(0, index - 19), index + 1);
      const avg = slice.reduce((sum, c) => sum + c.close, 0) / slice.length;
      return { time: candle.time, value: avg };
    });
    maSeriesRef.current.setData(maData);

    const volumeData: HistogramData<UTCTimestamp>[] = candles.map(candle => ({
      time: candle.time,
      value: Math.random() * 1000000,
      color: candle.close >= candle.open ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
    }));
    volumeSeriesRef.current.setData(volumeData);

    chartRef.current?.timeScale().fitContent();
  }, [selectedSymbol, timeframe]);

  // Generate orderbook
  const orderbook = useMemo(() => {
    const mid = selectedPair.price;
    const asks: OrderBookLevel[] = [];
    const bids: OrderBookLevel[] = [];
    let total = 0;
    for (let i = 0; i < 12; i++) {
      const amount = Math.random() * 5 + 0.1;
      total += amount;
      asks.push({ price: mid + (i + 1) * mid * 0.0005, amount, total });
    }
    total = 0;
    for (let i = 0; i < 12; i++) {
      const amount = Math.random() * 5 + 0.1;
      total += amount;
      bids.push({ price: mid - (i + 1) * mid * 0.0005, amount, total });
    }
    return { asks: asks.reverse(), bids, mid };
  }, [selectedPair.price]);

  // Generate recent trades
  const recentTrades = useMemo<RecentTrade[]>(() => {
    return Array.from({ length: 20 }, (_, i) => {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const drift = (Math.random() - 0.5) * selectedPair.price * 0.001;
      return {
        id: `t-${i}`,
        price: selectedPair.price + drift,
        amount: Math.random() * 2 + 0.01,
        time: Date.now() - i * Math.random() * 30000,
        side,
      };
    });
  }, [selectedPair.price]);

  const filteredPairs = pairs.filter(p => {
    const matchesSearch = p.symbol.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFav = !showOnlyFavorites || favorites.has(p.symbol);
    return matchesSearch && matchesFav;
  });

  const toggleFavorite = (symbol: string) => {
    const next = new Set(favorites);
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    setFavorites(next);
  };

  const priceChange = selectedPair.price - selectedPair.prevPrice;
  const priceChangePercent = (priceChange / selectedPair.prevPrice) * 100;

  return (
    <div className="space-y-4">
      {/* Top Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border bg-bg-card p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-3.5 h-3.5 text-text-muted" />
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Market Cap</p>
          </div>
          <p className="text-base font-bold text-text-primary tabular-nums">$2.42T</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Volume2 className="w-3.5 h-3.5 text-text-muted" />
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">24h Volume</p>
          </div>
          <p className="text-base font-bold text-text-primary tabular-nums">$84.2B</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-3.5 h-3.5 text-text-muted" />
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">BTC Dominance</p>
          </div>
          <p className="text-base font-bold text-accent tabular-nums">52.4%</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-text-muted" />
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Active Pairs</p>
          </div>
          <p className="text-base font-bold text-text-primary tabular-nums">{pairs.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-card p-3.5 col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            {wsConnected ? <Wifi className="w-3.5 h-3.5 text-success" /> : <WifiOff className="w-3.5 h-3.5 text-danger" />}
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Stream Status</p>
          </div>
          <p className={`text-base font-bold tabular-nums flex items-center gap-2 ${wsConnected ? 'text-success' : 'text-danger'}`}>
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-success animate-pulse' : 'bg-danger'}`} />
            {wsConnected ? 'Connected' : 'Disconnected'}
          </p>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="grid grid-cols-12 gap-4 min-h-[700px]">
        {/* LEFT: Market list */}
        <div className="col-span-12 lg:col-span-3 rounded-2xl border border-border bg-bg-card overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pair..."
                className="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                {filteredPairs.length} pairs
              </span>
              <button
                onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  showOnlyFavorites ? 'bg-warning-muted text-warning' : 'bg-bg-secondary text-text-muted'
                }`}
              >
                {showOnlyFavorites ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                Favorites
              </button>
            </div>
          </div>

          {/* Pairs list */}
          <div className="flex-1 overflow-y-auto">
            {filteredPairs.map((pair) => (
              <button
                key={pair.symbol}
                onClick={() => setSelectedSymbol(pair.symbol)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors ${
                  selectedSymbol === pair.symbol
                    ? 'bg-accent-muted/50 border-l-2 border-l-accent'
                    : 'hover:bg-bg-hover/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(pair.symbol); }}
                      className="cursor-pointer"
                    >
                      <Star
                        className={`w-3 h-3 ${favorites.has(pair.symbol) ? 'fill-warning text-warning' : 'text-text-muted'}`}
                      />
                    </span>
                    <span className="font-bold text-xs text-text-primary">{pair.base}</span>
                    <span className="text-[10px] text-text-muted">/{pair.quote}</span>
                  </div>
                  <Sparkline data={pair.spark} positive={pair.change24h >= 0} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text-primary tabular-nums">${formatPrice(pair.price)}</p>
                  <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                    pair.change24h >= 0 ? 'bg-success-muted text-success' : 'bg-danger-muted text-danger'
                  }`}>
                    {pair.change24h >= 0 ? '+' : ''}{pair.change24h.toFixed(2)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* CENTER: Chart + info */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
          {/* Symbol info */}
          <div className="rounded-2xl border border-border bg-bg-card p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-text-primary">{selectedPair.base}/USDT</h2>
                  <span className="px-2 py-0.5 rounded-md bg-bg-secondary text-xs text-text-secondary font-semibold">
                    Spot
                  </span>
                </div>
                <p className="text-xs text-text-muted">Bitcoin / TetherUS • Vol ${formatVolume(selectedPair.volume)}</p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-semibold text-success">LIVE</span>
              </div>
            </div>

            <div className="flex items-end gap-3 mb-4">
              <p className="text-3xl font-bold text-text-primary tabular-nums">
                ${formatPrice(selectedPair.price)}
              </p>
              <div className={`flex items-center gap-1 pb-1 ${priceChange >= 0 ? 'text-success' : 'text-danger'}`}>
                {priceChange >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                <span className="text-sm font-semibold tabular-nums">
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(3)}%)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">24h High</p>
                <p className="text-sm font-semibold text-success tabular-nums">${formatPrice(selectedPair.high24h)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">24h Low</p>
                <p className="text-sm font-semibold text-danger tabular-nums">${formatPrice(selectedPair.low24h)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">24h Volume ({selectedPair.base})</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {formatVolume(selectedPair.quoteVolume / selectedPair.price)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Trades</p>
                <p className="text-sm font-semibold text-text-primary tabular-nums">
                  {selectedPair.trades.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-2xl border border-border bg-bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="inline-flex items-center gap-1 p-0.5 bg-bg-secondary rounded-lg">
                {timeframes.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
                      timeframe === tf
                        ? 'bg-accent text-white'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-sm bg-bull" />
                  <span className="text-text-secondary font-medium">Bull</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-sm bg-bear" />
                  <span className="text-text-secondary font-medium">Bear</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-0.5 bg-accent" />
                  <span className="text-text-secondary font-medium">MA20</span>
                </div>
              </div>
            </div>
            <div ref={chartContainerRef} className="h-[420px] w-full" />
          </div>
        </div>

        {/* RIGHT: Orderbook + Trades */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          {/* Orderbook */}
          <div className="rounded-2xl border border-border bg-bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Order Book</h3>
              <span className="text-[10px] text-text-muted font-medium">{selectedPair.symbol}</span>
            </div>
            <div className="px-4 py-2 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-text-muted font-medium border-b border-border/50">
              <span>Price</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Total</span>
            </div>
            {/* Asks (sell) */}
            <div className="px-2 py-1">
              {orderbook.asks.map((level, i) => (
                <div key={`ask-${i}`} className="relative grid grid-cols-3 gap-2 px-2 py-1 text-[11px] hover:bg-bg-hover/30 rounded">
                  <div
                    className="absolute inset-0 bg-danger/[0.08] rounded"
                    style={{ width: `${(level.total / orderbook.asks[orderbook.asks.length - 1].total) * 100}%`, right: 0, left: 'auto' }}
                  />
                  <span className="relative text-danger tabular-nums">{formatPrice(level.price)}</span>
                  <span className="relative text-right text-text-secondary tabular-nums">{formatAmount(level.amount)}</span>
                  <span className="relative text-right text-text-muted tabular-nums">{formatAmount(level.total)}</span>
                </div>
              ))}
            </div>
            {/* Mid price */}
            <div className="px-4 py-2 border-y border-border/50 bg-bg-secondary/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary tabular-nums">${formatPrice(orderbook.mid)}</span>
                <span className="text-[10px] text-text-muted">Last</span>
              </div>
            </div>
            {/* Bids (buy) */}
            <div className="px-2 py-1">
              {orderbook.bids.map((level, i) => (
                <div key={`bid-${i}`} className="relative grid grid-cols-3 gap-2 px-2 py-1 text-[11px] hover:bg-bg-hover/30 rounded">
                  <div
                    className="absolute inset-0 bg-success/[0.08] rounded"
                    style={{ width: `${(level.total / orderbook.bids[orderbook.bids.length - 1].total) * 100}%`, right: 0, left: 'auto' }}
                  />
                  <span className="relative text-success tabular-nums">{formatPrice(level.price)}</span>
                  <span className="relative text-right text-text-secondary tabular-nums">{formatAmount(level.amount)}</span>
                  <span className="relative text-right text-text-muted tabular-nums">{formatAmount(level.total)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent trades */}
          <div className="rounded-2xl border border-border bg-bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Recent Trades</h3>
              <span className="text-[10px] text-text-muted">{recentTrades.length} trades</span>
            </div>
            <div className="px-4 py-2 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-text-muted font-medium border-b border-border/50">
              <span>Price</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Time</span>
            </div>
            <div className="px-2 py-1 max-h-[300px] overflow-y-auto">
              {recentTrades.map((trade) => (
                <div key={trade.id} className="grid grid-cols-3 gap-2 px-2 py-1 text-[11px] hover:bg-bg-hover/30 rounded">
                  <span className={`tabular-nums font-medium ${trade.side === 'buy' ? 'text-success' : 'text-danger'}`}>
                    {formatPrice(trade.price)}
                  </span>
                  <span className="text-right text-text-secondary tabular-nums">{formatAmount(trade.amount)}</span>
                  <span className="text-right text-text-muted">
                    {new Date(trade.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
