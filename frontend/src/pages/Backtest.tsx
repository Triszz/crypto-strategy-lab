import { useState } from 'react';
import { 
  ChevronDown, 
  HelpCircle, 
  Bell, 
  Play, 
  Info,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  TrendingUp
} from 'lucide-react';

interface TradeItem {
  id: number;
  pair: string;
  entryTime: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stoploss: number;
  takeprofit: number;
  exitPrice: number;
  fee: number;
  slippage: number;
  profit: number;
}

export default function Backtest() {
  const selectedPair = 'BTCUSDT';
  const timeframe = '5m';
  const [fromDate, setFromDate] = useState('2025-05-01');
  const [toDate, setToDate] = useState('2025-05-15');
  const [capital, setCapital] = useState(100);
  const selectedStrategy = 'MA Crossover';
  const [feePercent, setFeePercent] = useState(0.08);
  const [slippageBps, setSlippageBps] = useState(5);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const trades: TradeItem[] = [
    { id: 1, pair: 'BTCUSDT', entryTime: '01/05/2025 06:15', direction: 'LONG', entryPrice: 68120.50, stoploss: 67620.00, takeprofit: 69120.00, exitPrice: 69050.80, fee: -0.05, slippage: -0.03, profit: 0.83 },
    { id: 2, pair: 'BTCUSDT', entryTime: '01/05/2025 09:40', direction: 'SHORT', entryPrice: 69450.20, stoploss: 69950.00, takeprofit: 68450.00, exitPrice: 68430.10, fee: -0.05, slippage: -0.03, profit: 0.87 },
    { id: 3, pair: 'BTCUSDT', entryTime: '01/05/2025 12:25', direction: 'LONG', entryPrice: 68600.10, stoploss: 68100.00, takeprofit: 69600.00, exitPrice: 67980.00, fee: -0.05, slippage: -0.03, profit: -0.67 },
    { id: 4, pair: 'BTCUSDT', entryTime: '01/05/2025 16:10', direction: 'SHORT', entryPrice: 69320.30, stoploss: 69820.00, takeprofit: 68320.00, exitPrice: 68310.40, fee: -0.05, slippage: -0.03, profit: 0.90 },
    { id: 5, pair: 'BTCUSDT', entryTime: '02/05/2025 03:50', direction: 'LONG', entryPrice: 68800.40, stoploss: 68300.00, takeprofit: 69800.00, exitPrice: 69800.00, fee: -0.05, slippage: -0.03, profit: 0.95 },
    { id: 6, pair: 'BTCUSDT', entryTime: '02/05/2025 08:35', direction: 'SHORT', entryPrice: 69900.80, stoploss: 70400.00, takeprofit: 68900.00, exitPrice: 70430.00, fee: -0.05, slippage: -0.03, profit: -0.58 },
    { id: 7, pair: 'BTCUSDT', entryTime: '02/05/2025 13:05', direction: 'LONG', entryPrice: 68950.60, stoploss: 68450.00, takeprofit: 69950.00, exitPrice: 69930.20, fee: -0.05, slippage: -0.03, profit: 0.92 },
    { id: 8, pair: 'BTCUSDT', entryTime: '03/05/2025 01:20', direction: 'SHORT', entryPrice: 69120.70, stoploss: 69620.00, takeprofit: 68120.00, exitPrice: 68110.30, fee: -0.05, slippage: -0.03, profit: 0.86 },
    { id: 9, pair: 'BTCUSDT', entryTime: '03/05/2025 06:55', direction: 'LONG', entryPrice: 68520.30, stoploss: 68020.00, takeprofit: 69520.00, exitPrice: 68020.00, fee: -0.05, slippage: -0.03, profit: -0.55 },
    { id: 10, pair: 'BTCUSDT', entryTime: '03/05/2025 11:10', direction: 'SHORT', entryPrice: 69010.20, stoploss: 69510.00, takeprofit: 68010.00, exitPrice: 68005.50, fee: -0.05, slippage: -0.03, profit: 0.95 }
  ];

  const handleStartBacktest = () => {
    setIsRunning(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsRunning(false);
          return 100;
        }
        return prev + 10;
      });
    }, 150);
  };

  // Static chart data generator (25 items)
  const chartCandles = [
    68900, 68850, 68950, 69100, 69020, 69150, 69200, 69180, 
    69300, 69420, 69310, 69250, 69120, 69050, 68980, 68820,
    68900, 69120, 69240, 69180, 69260, 69380, 69450, 69390, 69420
  ].map((close, i) => {
    const change = (Math.random() - 0.45) * 60;
    const open = close - change;
    const high = Math.max(open, close) + Math.random() * 30;
    const low = Math.min(open, close) - Math.random() * 30;
    const volume = Math.round(50 + Math.random() * 600);
    return { open, high, low, close, volume, time: `0${i}:00` };
  });

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto relative">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Backtest & Kết quả giao dịch</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Chọn coin, thời gian test, vốn, strategy và đánh giá hiệu quả
          </p>
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

      {/* Backtest Parameters Control Bar */}
      <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap gap-5 items-end justify-between">
        <div className="flex flex-wrap gap-5">
          {/* Pair Select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pair / Coin</label>
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 min-w-[120px] justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-white text-[9px]">₿</span>
                  {selectedPair}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Timeframe Select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Timeframe</label>
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 min-w-[80px] justify-between">
                <span>{timeframe}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* From Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">From date</label>
            <div className="relative">
              <input 
                type="date" 
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none" 
              />
            </div>
          </div>

          {/* To Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">To date</label>
            <div className="relative">
              <input 
                type="date" 
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none" 
              />
            </div>
          </div>

          {/* Vốn (USD) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vốn (USD)</label>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 max-w-[110px]">
              <input 
                type="number" 
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value))}
                className="w-full py-2 bg-transparent text-xs font-bold text-slate-700 focus:outline-none border-none text-right pr-1"
              />
              <span className="text-[10px] text-slate-400 font-bold uppercase">USD</span>
            </div>
          </div>

          {/* Strategy */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Strategy</label>
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 min-w-[150px] justify-between">
                <span>{selectedStrategy}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Transaction cost */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Transaction Cost</label>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 max-w-[90px]">
              <input 
                type="number" 
                step="0.01"
                value={feePercent}
                onChange={(e) => setFeePercent(Number(e.target.value))}
                className="w-full py-2 bg-transparent text-xs font-bold text-slate-700 focus:outline-none border-none text-right pr-1"
              />
              <span className="text-[10px] text-slate-400 font-bold">%</span>
            </div>
          </div>

          {/* Slippage */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Slippage</label>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 max-w-[90px]">
              <input 
                type="number" 
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
                className="w-full py-2 bg-transparent text-xs font-bold text-slate-700 focus:outline-none border-none text-right pr-1"
              />
              <span className="text-[10px] text-slate-400 font-bold uppercase">bps</span>
            </div>
          </div>
        </div>

        {/* Start Button */}
        <button 
          onClick={handleStartBacktest}
          disabled={isRunning}
          className="flex items-center gap-2 py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{isRunning ? `Running ${progress}%` : 'Bắt đầu backtest'}</span>
        </button>
      </section>

      {/* Main Backtest Contents */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Left Column: Biểu đồ Backtest */}
        <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-extrabold text-slate-800">Biểu đồ Backtest (BTCUSDT - 5m)</h3>
            <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-blue-500 inline-block" /> MA(20) 69,135.45</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 bg-amber-500 inline-block" /> MA(50) 68,912.73</span>
            </div>
          </div>

          {/* SVG Backtest Chart Container */}
          <div className="h-[380px] w-full relative select-none bg-slate-50/20 rounded-xl border border-slate-100 p-2 overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 600 360" preserveAspectRatio="none">
              {/* Horizontal gridlines */}
              <line x1={0} y1={50} x2={540} y2={50} stroke="#f1f5f9" strokeDasharray="3,3" />
              <line x1={0} y1={120} x2={540} y2={120} stroke="#f1f5f9" strokeDasharray="3,3" />
              <line x1={0} y1={190} x2={540} y2={190} stroke="#f1f5f9" strokeDasharray="3,3" />
              <line x1={0} y1={260} x2={540} y2={260} stroke="#f1f5f9" strokeDasharray="3,3" />

              {/* Resistance line (Red) */}
              <line x1={0} y1={65} x2={540} y2={65} stroke="#ef4444" strokeWidth={1} strokeDasharray="4,4" />
              <text x={260} y={60} fill="#ef4444" fontSize="8.5" fontWeight="bold">Kháng cự 70,200.00</text>

              {/* Support line (Green) */}
              <line x1={0} y1={290} x2={540} y2={290} stroke="#10b981" strokeWidth={1} strokeDasharray="4,4" />
              <text x={260} y={285} fill="#10b981" fontSize="8.5" fontWeight="bold">Hỗ trợ 67,800.00</text>

              {/* Volume Bars overlay at bottom */}
              {chartCandles.map((c, i) => {
                const x = (i * 540) / 24;
                const barHeight = 25 + (c.volume / 600) * 35;
                const isGreen = c.close >= c.open;
                return (
                  <rect
                    key={`v-${i}`}
                    x={x - 4}
                    y={320 - barHeight}
                    width={8}
                    height={barHeight}
                    fill={isGreen ? '#a7f3d0' : '#fecaca'}
                    opacity={0.45}
                  />
                );
              })}

              {/* Candles */}
              {chartCandles.map((c, i) => {
                const x = (i * 540) / 24;
                
                // Scale values
                const scaleY = (val: number) => 300 - ((val - 68500) * 220) / 1100;
                
                const yOpen = scaleY(c.open);
                const yClose = scaleY(c.close);
                const yHigh = scaleY(c.high);
                const yLow = scaleY(c.low);
                
                const isGreen = c.close >= c.open;
                const color = isGreen ? '#10b981' : '#ef4444';

                return (
                  <g key={`c-${i}`}>
                    {/* Wick */}
                    <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.2} />
                    {/* Body */}
                    <rect
                      x={x - 5}
                      y={Math.min(yOpen, yClose)}
                      width={10}
                      height={Math.max(2, Math.abs(yOpen - yClose))}
                      fill={color}
                      stroke={color}
                      strokeWidth={0.5}
                      rx={0.5}
                    />
                  </g>
                );
              })}

              {/* Indicator Lines */}
              {/* MA(20) Blue Line */}
              <path
                d={chartCandles.reduce((path, c, i) => {
                  const x = (i * 540) / 24;
                  // simple wave for MA(20)
                  const maPrice = c.close - 40 - Math.sin(i / 3.5) * 80;
                  const y = 300 - ((maPrice - 68500) * 220) / 1100;
                  const cmd = path === '' ? 'M' : 'L';
                  return `${path} ${cmd} ${x} ${y}`;
                }, '')}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.5}
              />

              {/* MA(50) Orange Line */}
              <path
                d={chartCandles.reduce((path, c, i) => {
                  const x = (i * 540) / 24;
                  // simple wave for MA(50)
                  const maPrice = c.close - 120 - Math.cos(i / 4.5) * 90;
                  const y = 300 - ((maPrice - 68500) * 220) / 1100;
                  const cmd = path === '' ? 'M' : 'L';
                  return `${path} ${cmd} ${x} ${y}`;
                }, '')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1.5}
              />

              {/* BUY/SELL markers overlays */}
              {/* 1. LONG Entry Label */}
              <g transform="translate(112, 230)">
                <line x1={0} y1={0} x2={0} y2={15} stroke="#10b981" strokeWidth={1.5} />
                <polygon points="0,15 -3,10 3,10" fill="#10b981" />
                <rect x={-32} y={-17} width={64} height={14} fill="#e6f4ea" stroke="#34a853" strokeWidth={0.5} rx={3} />
                <text x={0} y={-8} fill="#137333" fontSize="7.5" fontWeight="bold" textAnchor="middle">LONG Entry</text>
              </g>

              {/* 2. SHORT Entry Label */}
              <g transform="translate(247, 85)">
                <polygon points="0,0 -3,5 3,5" fill="#ef4444" />
                <line x1={0} y1={5} x2={0} y2={20} stroke="#ef4444" strokeWidth={1.5} />
                <rect x={-32} y={-18} width={64} height={14} fill="#fce8e6" stroke="#c5221f" strokeWidth={0.5} rx={3} />
                <text x={0} y={-9} fill="#c5221f" fontSize="7.5" fontWeight="bold" textAnchor="middle">SHORT Entry</text>
              </g>

              {/* 3. Take Profit Label */}
              <g transform="translate(340, 110)">
                <line x1={0} y1={0} x2={40} y2={0} stroke="#10b981" strokeWidth={1} strokeDasharray="2,2" />
                <text x={45} y={3} fill="#10b981" fontSize="7.5" fontWeight="extrabold">Take Profit</text>
              </g>

              {/* 4. Stop Loss Label */}
              <g transform="translate(100, 310)">
                <line x1={0} y1={0} x2={40} y2={0} stroke="#ef4444" strokeWidth={1} strokeDasharray="2,2" />
                <text x={45} y={3} fill="#ef4444" fontSize="7.5" fontWeight="extrabold">Stop Loss</text>
              </g>

              {/* 5. Exit Label */}
              <g transform="translate(425, 142)">
                <rect x={-15} y={-15} width={30} height={14} fill="#e8f0fe" stroke="#1a73e8" strokeWidth={0.5} rx={3} />
                <text x={0} y={-5} fill="#1a73e8" fontSize="7.5" fontWeight="bold" textAnchor="middle">Exit</text>
              </g>

              {/* Price Axis on Right */}
              <g fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="start">
                <text x={546} y={54}>70,400.00</text>
                <text x={546} y={114}>69,600.00</text>
                <text x={546} y={174}>68,800.00</text>
                <text x={546} y={234}>68,000.00</text>
                <text x={546} y={294}>67,200.00</text>
              </g>

              {/* Timeline X-Axis */}
              <g fill="#94a3b8" fontSize="8" fontWeight="bold" textAnchor="middle">
                <text x={20} y={345}>06:00</text>
                <text x={120} y={345}>09:00</text>
                <text x={220} y={345}>12:00</text>
                <text x={320} y={345}>15:00</text>
                <text x={420} y={345}>18:00</text>
                <text x={520} y={345}>21:00</text>
              </g>
            </svg>

            {/* Load indicator */}
            {isRunning && (
              <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
                <span className="text-xs font-bold text-slate-700">Đang chạy backtest: {progress}%</span>
              </div>
            )}
          </div>
        </article>

        {/* Right Column: Danh sách lệnh giao dịch */}
        <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between min-h-[460px]">
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Danh sách lệnh giao dịch</h3>
            
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-[11px] font-bold text-slate-600 text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-2">Pair / Coin</th>
                    <th className="py-2.5 px-2">Thời gian vào lệnh</th>
                    <th className="py-2.5 px-2">Hướng</th>
                    <th className="py-2.5 px-2 text-right">Giá vào</th>
                    <th className="py-2.5 px-2 text-right">Stoploss</th>
                    <th className="py-2.5 px-2 text-right">Takeprofit</th>
                    <th className="py-2.5 px-2 text-right">Giá kết thúc</th>
                    <th className="py-2.5 px-2 text-right">Phí</th>
                    <th className="py-2.5 px-2 text-right">Slippage</th>
                    <th className="py-2.5 px-3 text-right">Profit (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((item) => (
                    <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-slate-400 font-medium">{item.id}</td>
                      <td className="py-2 px-2 text-slate-800">{item.pair}</td>
                      <td className="py-2 px-2 text-slate-500 font-medium">{item.entryTime}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wide ${
                          item.direction === 'LONG' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {item.direction}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-800">{item.entryPrice.toLocaleString('en-US')}</td>
                      <td className="py-2 px-2 text-right text-slate-400 font-medium">{item.stoploss.toLocaleString('en-US')}</td>
                      <td className="py-2 px-2 text-right text-slate-400 font-medium">{item.takeprofit.toLocaleString('en-US')}</td>
                      <td className="py-2 px-2 text-right text-slate-800">{item.exitPrice.toLocaleString('en-US')}</td>
                      <td className="py-2 px-2 text-right text-slate-400 font-medium">{item.fee}</td>
                      <td className="py-2 px-2 text-right text-slate-400 font-medium">{item.slippage}</td>
                      <td className={`py-2 px-3 text-right font-extrabold ${
                        item.profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {item.profit >= 0 ? '+' : ''}{item.profit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-4 border-t border-slate-100 pt-3 text-xs font-bold text-slate-500">
            <div className="flex items-center gap-1.5">
              <span>Hiển thị</span>
              <button className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg text-xs text-slate-700">
                10
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <span>1-10 của 178 lệnh</span>
            </div>

            <div className="flex items-center gap-1">
              <button className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-400 disabled:opacity-40" disabled>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="w-7 h-7 rounded-lg bg-blue-600 text-white font-extrabold text-xs flex items-center justify-center shadow-xs">
                1
              </button>
              <button className="w-7 h-7 rounded-lg hover:bg-slate-50 border border-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
                2
              </button>
              <button className="w-7 h-7 rounded-lg hover:bg-slate-50 border border-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
                3
              </button>
              <span className="px-1 text-slate-400 text-xs">...</span>
              <button className="w-7 h-7 rounded-lg hover:bg-slate-50 border border-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center">
                18
              </button>
              <button className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </article>

      </div>

      {/* Bottom Row metrics cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-6">
        
        {/* Metric 1: Winrate */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Winrate</span>
            <span className="text-2xl font-black text-slate-900 mt-1 leading-none tracking-tight">61.80%</span>
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 mt-3">
              <span className="text-emerald-500">110</span> / <span className="text-red-500">68</span>
              <span className="text-slate-300">|</span>
              <span>Tổng lệnh thắng</span>
            </div>
          </div>
          {/* Donut representation */}
          <div className="w-12 h-12 relative flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="24" cy="24" r="18" fill="transparent" stroke="#f1f5f9" strokeWidth="4.5" />
              <circle cx="24" cy="24" r="18" fill="transparent" stroke="#10b981" strokeWidth="4.5" strokeDasharray="113" strokeDashoffset={113 - (113 * 61.8) / 100} />
            </svg>
            <span className="absolute text-[8px] font-black text-slate-500">61%</span>
          </div>
        </div>

        {/* Metric 2: Total Profit */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Profit</span>
            <span className="text-2xl font-black text-emerald-600 mt-1 leading-none tracking-tight">+8.42 USD</span>
            <span className="text-[10px] font-bold text-emerald-500 mt-3 flex items-center gap-0.5">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>+8.42%</span>
            </span>
          </div>
          {/* Mini trend line */}
          <svg className="w-12 h-8" viewBox="0 0 40 20">
            <path d="M 0 15 L 10 16 L 20 12 L 30 14 L 40 4" fill="none" stroke="#10b981" strokeWidth="2" />
          </svg>
        </div>

        {/* Metric 3: Max Drawdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Max Drawdown</span>
            <span className="text-2xl font-black text-red-500 mt-1 leading-none tracking-tight">-3.21 USD</span>
            <span className="text-[10px] font-bold text-red-400 mt-3">-3.21%</span>
          </div>
          {/* Mini drawdown line */}
          <svg className="w-12 h-8" viewBox="0 0 40 20">
            <path d="M 0 5 L 10 12 L 20 18 L 30 14 L 40 16" fill="none" stroke="#ef4444" strokeWidth="2" />
          </svg>
        </div>

        {/* Metric 4: Total Trades */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
          <div className="flex flex-col text-left">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Trades</span>
            <span className="text-2xl font-black text-slate-900 mt-1 leading-none tracking-tight">178</span>
            <span className="text-[10px] font-bold text-slate-400 mt-3">100% lệnh đã thực hiện</span>
          </div>
          {/* Mini bar chart */}
          <div className="flex gap-0.5 items-end h-8">
            <div className="w-1.5 h-3 bg-slate-200 rounded-xs" />
            <div className="w-1.5 h-5 bg-slate-200 rounded-xs" />
            <div className="w-1.5 h-8 bg-blue-500 rounded-xs" />
            <div className="w-1.5 h-6 bg-slate-200 rounded-xs" />
            <div className="w-1.5 h-4 bg-slate-200 rounded-xs" />
          </div>
        </div>

        {/* Metric 5: Cách tính Profit */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
            Cách tính Profit <Info className="w-3.5 h-3.5 text-slate-300" />
          </span>
          <div className="flex justify-between items-center text-xs font-bold text-slate-600 mt-2.5">
            <div className="flex flex-col items-center">
              <span className="w-6 h-6 rounded bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-200/50">$</span>
              <span className="text-[8.5px] text-slate-400 mt-1 font-semibold">Tổng lãi/lỗ</span>
            </div>
            <span>-</span>
            <div className="flex flex-col items-center">
              <span className="w-6 h-6 rounded bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-200/50">%</span>
              <span className="text-[8.5px] text-slate-400 mt-1 font-semibold">Phí giao dịch</span>
            </div>
            <span>-</span>
            <div className="flex flex-col items-center">
              <span className="w-6 h-6 rounded bg-slate-50 flex items-center justify-center text-slate-700 border border-slate-200/50">bps</span>
              <span className="text-[8.5px] text-slate-400 mt-1 font-semibold">Slippage</span>
            </div>
            <span>=</span>
            <div className="flex flex-col items-center">
              <span className="w-6 h-6 rounded bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">$</span>
              <span className="text-[8.5px] text-blue-600 mt-1 font-bold">Lợi nhuận ròng</span>
            </div>
          </div>
        </div>

        {/* Metric 6: Giả định Backtest */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between text-left">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Giả định Backtest</span>
          
          <div className="flex flex-col gap-2 mt-2 text-[10px] font-bold text-slate-600">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Hỗ trợ cả LONG và SHORT</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Xử lý SL/TP theo giá thực tế (OHLC)</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Kết quả có thể tái lập (reproducible)</span>
            </div>
          </div>
        </div>

      </section>

    </div>
  );
}
