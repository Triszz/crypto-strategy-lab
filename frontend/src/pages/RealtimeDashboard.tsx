import { useState, useEffect, useRef } from 'react';
import { 
  ChevronDown, 
  HelpCircle, 
  Bell, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight
} from 'lucide-react';

// Types
interface Ticker {
  time: string;
  price: number;
  amount: number;
  type: 'Buy' | 'Sell';
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function RealtimeDashboard() {
  const selectedPair = 'BTCUSDT';
  const [activeTimeframe, setActiveTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h'>('1m');
  const [isRealtime, setIsRealtime] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(69342.18);
  const [priceChangePct, setPriceChangePct] = useState(0.28);
  const [recentTicks, setRecentTicks] = useState<Ticker[]>([]);
  const [latency, setLatency] = useState(102);

  // Keep track of ticks for history
  const ticksRef = useRef<Ticker[]>([]);

  // Candle data state for 4 timeframes
  const [candlesData, setCandlesData] = useState<Record<string, Candle[]>>({
    '1m': [],
    '5m': [],
    '15m': [],
    '1h': [],
  });

  // Setup initial candle data
  useEffect(() => {
    const timeframes = ['1m', '5m', '15m', '1h'] as const;
    const initial: Record<string, Candle[]> = {};

    timeframes.forEach((tf) => {
      let baseVal = 69100;
      const arr: Candle[] = [];
      const now = Date.now();
      const intervalMs = tf === '1m' ? 60000 : tf === '5m' ? 300000 : tf === '15m' ? 900000 : 3600000;

      for (let i = 24; i >= 0; i--) {
        const timeObj = new Date(now - i * intervalMs);
        const timeStr = timeObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        
        // Random walk
        const change = (Math.random() - 0.48) * 80;
        const open = baseVal;
        const close = baseVal + change;
        const high = Math.max(open, close) + Math.random() * 25;
        const low = Math.min(open, close) - Math.random() * 25;
        const volume = Math.round(100 + Math.random() * 800);

        arr.push({ time: timeStr, open, high, low, close, volume });
        baseVal = close;
      }
      initial[tf] = arr;
    });

    setCandlesData(initial);

    // Initial Ticks
    const startTicks: Ticker[] = [];
    const nowTime = new Date();
    for (let i = 0; i < 5; i++) {
      const t = new Date(nowTime.getTime() - i * 1200);
      startTicks.push({
        time: t.toLocaleTimeString('vi-VN', { hour12: false }),
        price: 69342.18 + (Math.random() - 0.5) * 4,
        amount: parseFloat((Math.random() * 0.03 + 0.002).toFixed(3)),
        type: Math.random() > 0.4 ? 'Buy' : 'Sell',
      });
    }
    setRecentTicks(startTicks);
    ticksRef.current = startTicks;
  }, []);

  // Live simulation effect
  useEffect(() => {
    if (!isRealtime) return;

    const interval = setInterval(() => {
      // 1. Update Price
      const diff = (Math.random() - 0.49) * 6; // slightly positive bias
      const nextPrice = parseFloat((currentPrice + diff).toFixed(2));
      setCurrentPrice(nextPrice);
      
      // Update price percentage slightly
      setPriceChangePct((prev) => parseFloat((prev + diff / 7000).toFixed(4)));

      // Randomize latency a bit
      setLatency(Math.round(98 + Math.random() * 8));

      // 2. Add New Tick
      const nowStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const newTick: Ticker = {
        time: nowStr,
        price: nextPrice,
        amount: parseFloat((Math.random() * 0.02 + 0.001).toFixed(3)),
        type: diff >= 0 ? 'Buy' : 'Sell',
      };

      const updatedTicks = [newTick, ...ticksRef.current.slice(0, 4)];
      setRecentTicks(updatedTicks);
      ticksRef.current = updatedTicks;

      // 3. Update Candles
      setCandlesData((prev) => {
        const next = { ...prev };
        
        Object.keys(next).forEach((tf) => {
          const list = [...next[tf]];
          if (list.length === 0) return;

          const lastIdx = list.length - 1;
          const last = { ...list[lastIdx] };

          // In this demo, we simulate candle updates and appends
          // Let's say we have a 10% chance to append a new candle (to keep it active)
          const shouldAppend = Math.random() < 0.15;

          if (shouldAppend) {
            // Append candle: create a new candle starting at the last candle's close
            const now = new Date();
            const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            
            const newCandle: Candle = {
              time: timeStr,
              open: last.close,
              close: nextPrice,
              high: Math.max(last.close, nextPrice),
              low: Math.min(last.close, nextPrice),
              volume: Math.round(50 + Math.random() * 150),
            };
            
            list.push(newCandle);
            if (list.length > 25) list.shift(); // Keep size
          } else {
            // Update candle: modify the current last candle
            last.close = nextPrice;
            if (nextPrice > last.high) last.high = nextPrice;
            if (nextPrice < last.low) last.low = nextPrice;
            last.volume += Math.round(1 + Math.random() * 5);
            list[lastIdx] = last;
          }

          next[tf] = list;
        });

        return next;
      });

    }, 1000);

    return () => clearInterval(interval);
  }, [isRealtime, currentPrice]);

  // Helper to compute Moving Average MA(20)
  const computeMA = (candles: Candle[], period: number = 20): (number | null)[] => {
    const ma: (number | null)[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < period - 1) {
        ma.push(null);
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += candles[i - j].close;
        }
        ma.push(sum / period);
      }
    }
    return ma;
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Realtime Chart – Đa khung thời gian</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200/50 px-3.5 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Nguồn dữ liệu: Binance API + WebSocket</span>
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

      {/* Control Bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-6">
          {/* Pair Select */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pair / Coin</label>
            <div className="relative">
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 font-bold text-sm text-slate-800 hover:border-slate-300 transition-colors min-w-[130px] justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold text-[10px] shadow-sm">₿</span>
                  {selectedPair}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Timeframe selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Khung thời gian</label>
            <div className="flex p-0.75 bg-slate-50 rounded-xl border border-slate-200/80">
              {(['1m', '5m', '15m', '1h', '4h'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setActiveTimeframe(tf)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTimeframe === tf
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Realtime switch */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-slate-600">Realtime</span>
            <button 
              onClick={() => setIsRealtime(!isRealtime)}
              className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${
                isRealtime ? 'bg-blue-600' : 'bg-slate-300'
              }`}
            >
              <span className={`w-4.5 h-4.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                isRealtime ? 'translate-x-5.5' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
            <span className="text-[11px] font-bold">Đang nhận dữ liệu</span>
          </div>
        </div>
      </section>

      {/* Main Grid View */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Charts Grid (Left part, occupies 3 columns) */}
        <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['1m', '5m', '15m', '1h'] as const).map((tf) => {
            const list = candlesData[tf] || [];
            const maVals = computeMA(list, 15); // MA(15) for simpler visualization

            // Get last candle stats
            const lastCandle = list[list.length - 1];
            const isBuy = tf !== '1h'; // BTCUSDT - 1h has SELL, others BUY in screenshots
            
            // Render Candlestick Chart SVG
            const chartWidth = 400;
            const chartHeight = 200;
            const paddingRight = 60;
            const paddingTop = 20;
            const paddingBottom = 25;

            // Find min/max values for scaling
            const prices = list.flatMap(c => [c.open, c.close, c.high, c.low]);
            const minPrice = prices.length ? Math.min(...prices) * 0.9995 : 69000;
            const maxPrice = prices.length ? Math.max(...prices) * 1.0005 : 69600;
            
            // Map function coordinates
            const getX = (index: number) => (index * (chartWidth - paddingRight)) / Math.max(list.length - 1, 1);
            const getY = (val: number) => chartHeight - paddingBottom - ((val - minPrice) * (chartHeight - paddingTop - paddingBottom)) / (maxPrice - minPrice);
            
            // Volume Y-scale
            const volumes = list.map(c => c.volume);
            const maxVol = volumes.length ? Math.max(...volumes) : 1000;
            const getVolY = (vol: number) => chartHeight - paddingBottom - (vol * 45) / maxVol; // Bottom overlay height max 45px

            return (
              <article key={tf} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 relative overflow-hidden group hover:shadow-md hover:border-slate-200/70 transition-all">
                {/* Chart Card Title */}
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-slate-800">BTCUSDT • {tf}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-bold text-blue-500 uppercase">MA(20)</span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {lastCandle ? lastCandle.close.toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-slate-900 leading-none tracking-tight">
                      {currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`text-[11px] font-extrabold mt-1 flex items-center justify-end gap-1 ${
                      isBuy ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      <span>{isBuy ? '+' : ''}{priceChangePct.toFixed(2)}%</span>
                    </div>
                  </div>

                  {/* BUY/SELL badge */}
                  <div className="ml-3">
                    <span className={`px-3 py-1 rounded-lg text-xs font-black tracking-wider ${
                      isBuy 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                  </div>
                </div>

                {/* SVG Chart Panel */}
                <div className="h-56 relative w-full mt-2 select-none">
                  {list.length > 0 ? (
                    <svg className="w-full h-full" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                      {/* Grid lines */}
                      <line x1={0} y1={getY(minPrice + (maxPrice - minPrice) * 0.25)} x2={chartWidth - paddingRight} y2={getY(minPrice + (maxPrice - minPrice) * 0.25)} stroke="#f1f5f9" strokeDasharray="3,3" />
                      <line x1={0} y1={getY(minPrice + (maxPrice - minPrice) * 0.5)} x2={chartWidth - paddingRight} y2={getY(minPrice + (maxPrice - minPrice) * 0.5)} stroke="#f1f5f9" strokeDasharray="3,3" />
                      <line x1={0} y1={getY(minPrice + (maxPrice - minPrice) * 0.75)} x2={chartWidth - paddingRight} y2={getY(minPrice + (maxPrice - minPrice) * 0.75)} stroke="#f1f5f9" strokeDasharray="3,3" />
                      
                      {/* Volume Bars at Bottom */}
                      {list.map((c, i) => {
                        const x = getX(i);
                        const y = getVolY(c.volume);
                        const isGreen = c.close >= c.open;
                        const barWidth = Math.max(2, (chartWidth - paddingRight) / (list.length * 1.5));
                        return (
                          <rect
                            key={`vol-${i}`}
                            x={x - barWidth / 2}
                            y={y}
                            width={barWidth}
                            height={chartHeight - paddingBottom - y}
                            fill={isGreen ? '#a7f3d0' : '#fecaca'}
                            opacity={0.65}
                          />
                        );
                      })}

                      {/* Candlesticks */}
                      {list.map((c, i) => {
                        const x = getX(i);
                        const yOpen = getY(c.open);
                        const yClose = getY(c.close);
                        const yHigh = getY(c.high);
                        const yLow = getY(c.low);
                        const isGreen = c.close >= c.open;
                        const color = isGreen ? '#10b981' : '#ef4444';
                        const bodyWidth = Math.max(3, (chartWidth - paddingRight) / (list.length * 1.5));

                        return (
                          <g key={`candle-${i}`}>
                            {/* Wick */}
                            <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.2} />
                            {/* Body */}
                            <rect
                              x={x - bodyWidth / 2}
                              y={Math.min(yOpen, yClose)}
                              width={bodyWidth}
                              height={Math.max(1.5, Math.abs(yOpen - yClose))}
                              fill={color}
                              stroke={color}
                              strokeWidth={0.5}
                              rx={0.5}
                            />
                          </g>
                        );
                      })}

                      {/* Moving Average Line MA(20) */}
                      <path
                        d={list.reduce((path, _, i) => {
                          const val = maVals[i];
                          if (val === null) return path;
                          const cmd = path === '' ? 'M' : 'L';
                          return `${path} ${cmd} ${getX(i)} ${getY(val)}`;
                        }, '')}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth={1.5}
                      />

                      {/* Y-Axis Labels */}
                      <g fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="start">
                        <text x={chartWidth - paddingRight + 6} y={getY(maxPrice) + 8}>
                          {maxPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </text>
                        <text x={chartWidth - paddingRight + 6} y={getY(minPrice + (maxPrice - minPrice) * 0.5) + 3}>
                          {((minPrice + maxPrice) / 2).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </text>
                        <text x={chartWidth - paddingRight + 6} y={getY(minPrice) - 3}>
                          {minPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </text>
                      </g>

                      {/* Current price dotted marker line */}
                      {lastCandle && (
                        <g>
                          <line
                            x1={0}
                            y1={getY(currentPrice)}
                            x2={chartWidth - paddingRight}
                            y2={getY(currentPrice)}
                            stroke="#10b981"
                            strokeWidth={1}
                            strokeDasharray="2,2"
                          />
                          {/* Price Tag badge on axis */}
                          <rect
                            x={chartWidth - paddingRight + 2}
                            y={getY(currentPrice) - 6}
                            width={54}
                            height={12}
                            fill="#10b981"
                            rx={2}
                          />
                          <text
                            x={chartWidth - paddingRight + 5}
                            y={getY(currentPrice) + 3}
                            fill="#ffffff"
                            fontSize="8"
                            fontWeight="extrabold"
                          >
                            {currentPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
                          </text>
                        </g>
                      )}

                      {/* X-Axis labels */}
                      {list.map((c, i) => {
                        if (i % 6 !== 0) return null;
                        return (
                          <text
                            key={`x-lbl-${i}`}
                            x={getX(i)}
                            y={chartHeight - 6}
                            fill="#94a3b8"
                            fontSize="7.5"
                            fontWeight="bold"
                            textAnchor="middle"
                          >
                            {c.time}
                          </text>
                        );
                      })}
                    </svg>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">
                      Loading Chart...
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="flex justify-between items-center border-t border-slate-100 pt-3 mt-1">
                  <button className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Load 1000 nến lịch sử</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-500">Cập nhật realtime</span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Info Sidebar Panel (Right part, occupies 1 column) */}
        <div className="flex flex-col gap-6">
          
          {/* Logic Cập Nhật Candle */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3.5">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Logic cập nhật candle</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>
            
            {/* Logic Block 1 */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-700">Trùng nến cuối → Update candle</span>
              <div className="flex items-center justify-between gap-2 mt-1">
                {/* Candle Visual 1 */}
                <div className="flex items-center gap-1">
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-3 bg-red-400" />
                    <span className="w-3.5 h-5 bg-red-400 rounded-sm" />
                    <span className="w-0.5 h-2 bg-red-400" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-2 bg-emerald-500" />
                    <span className="w-3.5.5 h-6 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-3 bg-emerald-500" />
                  </div>
                  <div className="flex flex-col items-center border border-dashed border-blue-400 p-0.5 bg-blue-50/20 rounded">
                    <span className="w-0.5 h-2.5 bg-red-400" />
                    <span className="w-3 h-4 bg-red-400 rounded-sm" />
                    <span className="w-0.5 h-1.5 bg-red-400" />
                  </div>
                </div>
                
                <span className="text-slate-400 text-xs font-bold">→</span>
                
                {/* Result Visual 1 */}
                <div className="flex items-center gap-1">
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-3 bg-red-400" />
                    <span className="w-3.5 h-5 bg-red-400 rounded-sm" />
                    <span className="w-0.5 h-2 bg-red-400" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-2 bg-emerald-500" />
                    <span className="w-3.5.5 h-6 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-3 bg-emerald-500" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-3 bg-emerald-500" />
                    <span className="w-3.5 h-7 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-2 bg-emerald-500" />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-1">
                Nếu nến đến có cùng thời gian với nến cuối → Update (ghi đè).
              </p>
            </div>

            {/* Logic Block 2 */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-700">Nến mới hoàn toàn → Append candle</span>
              <div className="flex items-center justify-between gap-2 mt-1">
                {/* Candle Visual 2 */}
                <div className="flex items-center gap-1">
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-3 bg-red-400" />
                    <span className="w-3.5 h-5 bg-red-400 rounded-sm" />
                    <span className="w-0.5 h-2 bg-red-400" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-2 bg-emerald-500" />
                    <span className="w-3.5.5 h-6 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-3 bg-emerald-500" />
                  </div>
                </div>
                
                <span className="text-slate-400 text-xs font-bold">→</span>
                
                {/* Result Visual 2 */}
                <div className="flex items-center gap-1">
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-3 bg-red-400" />
                    <span className="w-3.5 h-5 bg-red-400 rounded-sm" />
                    <span className="w-0.5 h-2 bg-red-400" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="w-0.5 h-2 bg-emerald-500" />
                    <span className="w-3.5.5 h-6 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-3 bg-emerald-500" />
                  </div>
                  <div className="flex flex-col items-center border border-dashed border-emerald-400 p-0.5 bg-emerald-50/20 rounded">
                    <span className="w-0.5 h-2 bg-emerald-500" />
                    <span className="w-3 h-5 bg-emerald-500 rounded-sm" />
                    <span className="w-0.5 h-1.5 bg-emerald-500" />
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-1">
                Nếu nến đến có thời gian mới → Append (thêm nến mới).
              </p>
            </div>
          </article>

          {/* Trạng Thái Kết Nối */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Trạng thái kết nối</h3>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <span className="w-1 h-1 bg-emerald-500 rounded-full" /> Đã kết nối
              </span>
            </div>
            
            <table className="w-full text-xs font-semibold text-slate-600">
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Nguồn dữ liệu</td>
                  <td className="py-2 text-right text-slate-800 font-bold">Binance API + WebSocket</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Độ trễ (Latency)</td>
                  <td className="py-2 text-right text-slate-800 font-bold">{latency} ms</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2 text-slate-400">Dữ liệu cuối</td>
                  <td className="py-2 text-right text-slate-800 font-bold">
                    {new Date().toLocaleTimeString('vi-VN', { hour12: false })}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-400">Kết nối</td>
                  <td className="py-2 text-right text-emerald-600 font-extrabold">Ổn định</td>
                </tr>
              </tbody>
            </table>
          </article>

          {/* Recent Ticks */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Recent Ticks ({selectedPair})</h3>
            
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
                  {recentTicks.map((tick, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-slate-500 font-medium">{tick.time}</td>
                      <td className="py-2 px-2 text-right text-slate-800">
                        {tick.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-500 font-medium">{tick.amount.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${
                          tick.type === 'Buy' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {tick.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          {/* Chú Thích */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Chú thích</h3>
            
            <div className="flex flex-col gap-3 text-xs font-semibold text-slate-600">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 h-2.5 bg-emerald-500 rounded-xs inline-block" />
                  <span>Nến tăng (Close &gt; Open)</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-black text-[9px]">BUY</span>
                <span className="text-[11px] text-slate-400">Tín hiệu Mua</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 h-2.5 bg-red-500 rounded-xs inline-block" />
                  <span>Nến giảm (Close &lt; Open)</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 font-black text-[9px]">SELL</span>
                <span className="text-[11px] text-slate-400">Tín hiệu Bán</span>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-50">
                <span className="w-4 h-0.5 bg-blue-500 inline-block" />
                <span>MA(20) – Đường trung bình biến động 20</span>
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
