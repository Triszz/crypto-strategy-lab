import { useState, useEffect } from 'react';
import { 
  HelpCircle, 
  Bell, 
  Plus, 
  ChevronRight, 
  Play, 
  ArrowUp, 
  ArrowDown, 
  Minus,
  Award
} from 'lucide-react';

interface IndicatorInfo {
  id: string;
  name: string;
  desc: string;
}

export default function Discovery() {
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(['MA', 'RSI', 'SR']);
  
  // Weighted voting parameters
  const [maWeight, setMaWeight] = useState(0.40);
  const [rsiWeight, setRsiWeight] = useState(0.30);
  const [srWeight, setSrWeight] = useState(0.30);

  // Voting checkbox states
  const [maChecked, setMaChecked] = useState(true);
  const [rsiChecked, setRsiChecked] = useState(true);
  const [srChecked, setSrChecked] = useState(true);

  // Score states
  const [longScore, setLongScore] = useState(0.62);
  const [holdScore, setHoldScore] = useState(-0.08);
  const [shortScore, setShortScore] = useState(-0.54);

  // Discovery Method
  const [discoveryMethod, setDiscoveryMethod] = useState<'random' | 'domain' | 'genetic'>('random');
  const [progressVal, setProgressVal] = useState(47);

  // Recalculate signals when weights or checked items change
  useEffect(() => {
    // Signals values: MA = 0.85, RSI = 0.75, SR = -0.15 (neutral/weak sell)
    const maSignal = maChecked ? 0.85 : 0;
    const rsiSignal = rsiChecked ? 0.75 : 0;
    const srSignal = srChecked ? -0.15 : 0;

    const totalWeight = 
      (maChecked ? maWeight : 0) + 
      (rsiChecked ? rsiWeight : 0) + 
      (srChecked ? srWeight : 0);

    if (totalWeight === 0) {
      setLongScore(0);
      setHoldScore(1);
      setShortScore(0);
      return;
    }

    // Weighted Score
    const weightedScore = (
      (maSignal * (maChecked ? maWeight : 0)) + 
      (rsiSignal * (rsiChecked ? rsiWeight : 0)) + 
      (srSignal * (srChecked ? srWeight : 0))
    ) / totalWeight;

    // Scale scores to fit nice visual representation
    setLongScore(parseFloat(weightedScore.toFixed(2)));
    setShortScore(parseFloat((-weightedScore * 0.88).toFixed(2)));
    setHoldScore(parseFloat((0.2 - Math.abs(weightedScore) * 0.45).toFixed(2)));

  }, [maWeight, rsiWeight, srWeight, maChecked, rsiChecked, srChecked]);

  const indicators: IndicatorInfo[] = [
    { id: 'rsi', name: 'RSI', desc: 'Đo động lượng và xác định vùng quá mua / quá bán.' },
    { id: 'ma', name: 'MA', desc: 'Theo xu hướng bằng đường trung bình động.' },
    { id: 'bb', name: 'Bollinger Bands', desc: 'Đo độ biến động và phát hiện phá vỡ dải.' },
    { id: 'sr', name: 'Support / Resistance', desc: 'Xác định vùng hỗ trợ và kháng cự quan trọng.' },
    { id: 'smc', name: 'SMC', desc: 'Phân tích cấu trúc thị trường theo Smart Money Concepts.' },
    { id: 'wyckoff', name: 'Wyckoff', desc: 'Nhận diện giai đoạn tích lũy và phân phối.' },
  ];

  // Suggestion handlers
  const applySuggestion = (items: string[]) => {
    setSelectedIndicators(items);
    setMaChecked(items.includes('MA'));
    setRsiChecked(items.includes('RSI'));
    setSrChecked(items.includes('SR'));
  };

  // Run progress bar simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setProgressVal((prev) => {
        if (prev >= 500) return 0;
        return prev + 1;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Strategy Engine & Loop Discovery</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Tạo strategy đơn, strategy kết hợp và tự động tìm biến thể tốt nhất
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

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: Strategy Đơn */}
        <div className="flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Strategy đơn</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            <div className="flex flex-col gap-3">
              {indicators.map((ind) => (
                <div 
                  key={ind.id} 
                  className="group flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:border-blue-200 bg-slate-50/50 hover:bg-white cursor-pointer transition-all hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {/* Badge container with specific color */}
                    <span className={`w-9 h-9 rounded-lg font-bold text-xs flex items-center justify-center border ${
                      ind.id === 'rsi' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                      ind.id === 'ma' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                      ind.id === 'bb' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                      ind.id === 'sr' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      ind.id === 'smc' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                      'bg-indigo-50 text-indigo-600 border-indigo-100'
                    }`}>
                      {ind.name.split(' ')[0]}
                    </span>
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-extrabold text-slate-800">{ind.name}</span>
                      <span className="text-[10px] text-slate-400 font-semibold mt-0.5 leading-tight">{ind.desc}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
                </div>
              ))}
            </div>

            <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-blue-600 border-dashed text-blue-600 hover:bg-blue-50/50 font-extrabold text-xs transition-colors">
              <Plus className="w-4 h-4" />
              <span>Tạo strategy đơn mới</span>
            </button>
          </article>
        </div>

        {/* Middle Column: Strategy Kết Hợp */}
        <div className="flex flex-col gap-6">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4.5">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Strategy kết hợp</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            {/* Select tags */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chọn các strategy để kết hợp</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-xl border border-slate-200 bg-slate-50 min-h-[44px]">
                {selectedIndicators.map((ind) => (
                  <span 
                    key={ind} 
                    className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-lg text-[10px]"
                  >
                    {ind}
                  </span>
                ))}
              </div>
            </div>

            {/* Quick Combination suggestions */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Gợi ý kết hợp nhanh</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => applySuggestion(['MA', 'RSI'])}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  MA + RSI
                </button>
                <button 
                  onClick={() => applySuggestion(['RSI', 'Bollinger'])}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  RSI + Bollinger
                </button>
                <button 
                  onClick={() => applySuggestion(['MA', 'RSI', 'SR'])}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  MA + RSI + S/R
                </button>
              </div>
            </div>

            {/* Weighted Voting table */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                Weighted Voting (Tín hiệu tổng hợp)
                <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-pointer" />
              </span>
              
              <div className="flex flex-col gap-3.5 mt-1.5">
                {/* MA Weight row */}
                {selectedIndicators.includes('MA') && (
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      checked={maChecked}
                      onChange={(e) => setMaChecked(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" 
                    />
                    <div className="w-20 text-xs font-bold text-slate-700">MA (20, 50)</div>
                    <input 
                      type="range" 
                      min="0.10" 
                      max="1.00" 
                      step="0.05"
                      value={maWeight}
                      onChange={(e) => setMaWeight(parseFloat(e.target.value))}
                      disabled={!maChecked}
                      className="flex-1 accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-30" 
                    />
                    <div className="w-10 text-right text-xs font-bold text-slate-800">{maWeight.toFixed(2)}</div>
                    <div className="w-6 flex justify-center">
                      {maChecked ? (
                        <span className="w-5 h-5 rounded bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
                          <ArrowUp className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                          <Minus className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* RSI Weight row */}
                {selectedIndicators.includes('RSI') && (
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      checked={rsiChecked}
                      onChange={(e) => setRsiChecked(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" 
                    />
                    <div className="w-20 text-xs font-bold text-slate-700">RSI (14)</div>
                    <input 
                      type="range" 
                      min="0.10" 
                      max="1.00" 
                      step="0.05"
                      value={rsiWeight}
                      onChange={(e) => setRsiWeight(parseFloat(e.target.value))}
                      disabled={!rsiChecked}
                      className="flex-1 accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-30" 
                    />
                    <div className="w-10 text-right text-xs font-bold text-slate-800">{rsiWeight.toFixed(2)}</div>
                    <div className="w-6 flex justify-center">
                      {rsiChecked ? (
                        <span className="w-5 h-5 rounded bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
                          <ArrowUp className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                          <Minus className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* SR Weight row */}
                {selectedIndicators.includes('SR') && (
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      checked={srChecked}
                      onChange={(e) => setSrChecked(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" 
                    />
                    <div className="w-20 text-xs font-bold text-slate-700">Support / Res</div>
                    <input 
                      type="range" 
                      min="0.10" 
                      max="1.00" 
                      step="0.05"
                      value={srWeight}
                      onChange={(e) => setSrWeight(parseFloat(e.target.value))}
                      disabled={!srChecked}
                      className="flex-1 accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-30" 
                    />
                    <div className="w-10 text-right text-xs font-bold text-slate-800">{srWeight.toFixed(2)}</div>
                    <div className="w-6 flex justify-center">
                      {srChecked ? (
                        <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200">
                          <Minus className="w-3 h-3" />
                        </span>
                      ) : (
                        <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                          <Minus className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Current Signal indicators */}
            <div className="flex flex-col gap-2.5 pt-4 border-t border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Tín hiệu tổng hợp hiện tại</span>
              
              <div className="grid grid-cols-3 gap-3">
                <div className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 ${
                  longScore >= 0.30 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs' 
                    : 'bg-slate-50/50 text-slate-400 border-slate-100'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider">LONG</span>
                  <ArrowUp className="w-4 h-4" />
                  <span className="text-sm font-black">{longScore > 0 ? `+${longScore}` : longScore}</span>
                </div>

                <div className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 ${
                  Math.abs(longScore) < 0.30 
                    ? 'bg-slate-100 text-slate-700 border-slate-200 shadow-xs' 
                    : 'bg-slate-50/50 text-slate-400 border-slate-100'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider">HOLD</span>
                  <Minus className="w-4 h-4" />
                  <span className="text-sm font-black">{holdScore}</span>
                </div>

                <div className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 ${
                  longScore <= -0.30 
                    ? 'bg-red-50 text-red-700 border-red-200 shadow-xs' 
                    : 'bg-slate-50/50 text-slate-400 border-slate-100'
                }`}>
                  <span className="text-[10px] font-bold uppercase tracking-wider">SHORT</span>
                  <ArrowDown className="w-4 h-4" />
                  <span className="text-sm font-black">{shortScore}</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold mt-1">
                <span>Ngưỡng vào lệnh: |score| &ge; 0.30</span>
                <span className="flex items-center gap-1 text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Cập nhật realtime
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-2">
              <button className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs transition-colors shadow-sm">
                Lưu strategy kết hợp
              </button>
              <button className="flex-1 flex items-center justify-center py-2.5 rounded-xl border border-blue-600 text-blue-600 hover:bg-blue-50/50 font-extrabold text-xs transition-colors">
                <Play className="w-3.5 h-3.5 fill-blue-600 mr-1" />
                Backtest ngay
              </button>
            </div>
          </article>
        </div>

        {/* Right Column: Loop Discovery & Stats */}
        <div className="flex flex-col gap-6">
          {/* Loop Discovery Flow */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Loop Discovery</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            {/* Diagram */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
              <div className="flex items-center justify-between text-center">
                {/* Generate */}
                <div className="flex flex-col items-center">
                  <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 font-bold text-[10px] flex items-center justify-center border border-indigo-100 shadow-sm">
                    G
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-1">Generate</span>
                  <span className="text-[7.5px] text-slate-400 font-medium">Tạo biến thể</span>
                </div>
                <span className="text-slate-300 text-xs font-bold">&rarr;</span>
                {/* Backtest */}
                <div className="flex flex-col items-center">
                  <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-[10px] flex items-center justify-center border border-emerald-100 shadow-sm">
                    B
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-1">Backtest</span>
                  <span className="text-[7.5px] text-slate-400 font-medium">Test lịch sử</span>
                </div>
                <span className="text-slate-300 text-xs font-bold">&rarr;</span>
                {/* Evaluate */}
                <div className="flex flex-col items-center">
                  <span className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 font-bold text-[10px] flex items-center justify-center border border-purple-100 shadow-sm">
                    E
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-1">Evaluate</span>
                  <span className="text-[7.5px] text-slate-400 font-medium">Đánh giá</span>
                </div>
                <span className="text-slate-300 text-xs font-bold">&rarr;</span>
                {/* Rank */}
                <div className="flex flex-col items-center">
                  <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 font-bold text-[10px] flex items-center justify-center border border-amber-100 shadow-sm">
                    R
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-1">Rank</span>
                  <span className="text-[7.5px] text-slate-400 font-medium">Xếp hạng</span>
                </div>
                <span className="text-slate-300 text-xs font-bold">&rarr;</span>
                {/* Leaderboard */}
                <div className="flex flex-col items-center">
                  <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 font-bold text-[10px] flex items-center justify-center border border-rose-100 shadow-sm">
                    L
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-1">Leaderboard</span>
                  <span className="text-[7.5px] text-slate-400 font-medium">Hiển thị top</span>
                </div>
              </div>
            </div>

            {/* Leaderboard Table */}
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" /> Leaderboard (Top strategies)
              </span>

              <div className="overflow-hidden rounded-xl border border-slate-100 text-xs font-bold">
                <table className="w-full text-left text-slate-600">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-[10px] tracking-wider border-b border-slate-100">
                      <th className="py-2.5 px-3">Rank</th>
                      <th className="py-2.5 px-2">Strategy</th>
                      <th className="py-2.5 px-2 text-right">Profit (USDT)</th>
                      <th className="py-2.5 px-3 text-right">Winrate</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-3 text-amber-500 font-black">🥇 1</td>
                      <td className="py-2 px-2 text-slate-800">
                        <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] mr-1">MA</span>
                        <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] mr-1">RSI</span>
                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px]">S/R</span>
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-600 font-extrabold">+2,342.18</td>
                      <td className="py-2 px-3 text-right text-slate-500 font-semibold">68.21%</td>
                    </tr>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-3 text-slate-400 font-black">🥈 2</td>
                      <td className="py-2 px-2 text-slate-800">
                        <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] mr-1">RSI</span>
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Bollinger</span>
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-600 font-extrabold">+1,864.76</td>
                      <td className="py-2 px-3 text-right text-slate-500 font-semibold">64.73%</td>
                    </tr>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-3 text-amber-700 font-black">🥉 3</td>
                      <td className="py-2 px-2 text-slate-800">
                        <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] mr-1">MA</span>
                        <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px]">RSI</span>
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-600 font-extrabold">+1,512.33</td>
                      <td className="py-2 px-3 text-right text-slate-500 font-semibold">62.19%</td>
                    </tr>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-3 text-slate-500 font-bold">4</td>
                      <td className="py-2 px-2 text-slate-800">
                        <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] mr-1">MA</span>
                        <span className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] mr-1">RSI</span>
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Bollinger</span>
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-600 font-extrabold">+1,102.47</td>
                      <td className="py-2 px-3 text-right text-slate-500 font-semibold">59.48%</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 text-slate-500 font-bold">5</td>
                      <td className="py-2 px-2 text-slate-800">
                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] mr-1">S/R</span>
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Bollinger</span>
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-600 font-extrabold">+987.15</td>
                      <td className="py-2 px-3 text-right text-slate-500 font-semibold">57.63%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phương pháp Discovery radio options */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                Phương pháp Discovery
                <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-pointer" />
              </span>

              <div className="flex flex-col gap-2.5 mt-1 text-xs font-semibold text-slate-600">
                <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200/60 bg-slate-50 hover:bg-slate-100 cursor-pointer">
                  <input 
                    type="radio" 
                    name="discovery-method" 
                    checked={discoveryMethod === 'random'}
                    onChange={() => setDiscoveryMethod('random')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 mt-0.5" 
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-extrabold text-slate-800">Random Search</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">Sinh ngẫu nhiên các biến thể.</span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200/60 bg-slate-50 hover:bg-slate-100 cursor-pointer">
                  <input 
                    type="radio" 
                    name="discovery-method" 
                    checked={discoveryMethod === 'domain'}
                    onChange={() => setDiscoveryMethod('domain')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 mt-0.5" 
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-extrabold text-slate-800">Domain-guided Search</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">Tìm kiếm dựa trên kiến thức và ràng buộc.</span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200/60 bg-slate-50 hover:bg-slate-100 cursor-pointer">
                  <input 
                    type="radio" 
                    name="discovery-method" 
                    checked={discoveryMethod === 'genetic'}
                    onChange={() => setDiscoveryMethod('genetic')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 mt-0.5" 
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-extrabold text-slate-800">Genetic Search</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">Tiến hóa qua chọn lọc và lai ghép.</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Discovery progress */}
            <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                Tiến trình Discovery
                <HelpCircle className="w-3.5 h-3.5 text-slate-400 cursor-pointer" />
              </span>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex flex-col gap-2.5 mt-0.5">
                <div className="flex justify-between items-center text-xs font-extrabold">
                  <span className="text-slate-600">Iteration hiện tại</span>
                  <span className="text-blue-600">{progressVal} / 500</span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${(progressVal / 500) * 100}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold mt-1">
                  <span>Đã kiểm tra</span>
                  <span className="text-slate-700">2,350 candidates</span>
                </div>

                <div className="border-t border-slate-200/50 pt-2.5 mt-1 flex flex-col gap-1 text-left">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Best strategy so far</span>
                  <div className="flex justify-between items-center text-[11px] font-extrabold text-slate-800">
                    <span>MA + RSI + S/R</span>
                    <div className="flex items-center gap-3">
                      <span className="text-emerald-600">+2,342.18 USDT</span>
                      <span className="text-slate-400">Winrate: 68.21%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </article>
        </div>

      </div>

    </div>
  );
}
