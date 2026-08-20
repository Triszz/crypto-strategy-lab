import { useState } from 'react';
import { 
  HelpCircle, 
  Bell, 
  Sparkles, 
  Trash2, 
  Globe, 
  Copy, 
  Check, 
  CheckCircle2, 
  FileJson, 
  Save, 
  Play, 
  MoreVertical,
  X
} from 'lucide-react';

interface StrategyItem {
  id: string;
  name: string;
  source: 'USER_PROMPT' | 'WEB_IMPORT';
  createdAt: string;
  version: string;
  tags: string[];
  status: 'Hợp lệ' | 'Lỗi';
}

const DEFAULT_JSON = `{
  "name": "RSI_BB_LB_LONG_SL2_TP4",
  "version": "1.0.0",
  "description": "LONG khi RSI < 30 và giá dưới Bollinger Lower Band. SL 2%, TP 4%.",
  "indicators": {
    "rsi": { "name": "RSI", "period": 14 },
    "bb": { "name": "Bollinger Bands", "period": 20, "stdDev": 2 }
  },
  "conditions": {
    "long": [
      { "indicator": "RSI", "operator": "<", "value": 30 },
      { "indicator": "Close", "position": "<", "indicatorRef": "BB_Lower" }
    ],
    "short": [
      { "indicator": "RSI", "operator": ">", "value": 70 },
      { "indicator": "Close", "position": ">", "indicatorRef": "BB_Upper" }
    ]
  },
  "riskManagement": {
    "stopLoss": { "type": "percent", "value": 2 },
    "takeProfit": { "type": "percent", "value": 4 }
  },
  "timeframe": "1h",
  "applicability": {
    "pairs": "USDT_ALL",
    "market": "spot"
  }
}`;

export default function StrategyEngine() {
  const [prompt, setPrompt] = useState(
    'Khi RSI dưới 30 và giá nằm dưới Bollinger Lower Band thì LONG. Stop loss 2%, take profit 4%.'
  );
  const [url, setUrl] = useState('https://www.tradingview.com/script/abc123-example/');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Strategy detail state
  const [strategyName, setStrategyName] = useState('RSI_BB_LB_LONG_SL2_TP4');
  const [strategyVersion, setStrategyVersion] = useState('1.0.0');
  const [strategyTags, setStrategyTags] = useState(['RSI', 'Bollinger', 'Mean Reversion', 'Long']);
  const [tagInput, setTagInput] = useState('');
  const [strategySource, setStrategySource] = useState<'USER_PROMPT' | 'WEB_IMPORT'>('USER_PROMPT');

  // JSON representation
  const [jsonDefinition, setJsonDefinition] = useState(DEFAULT_JSON);

  // Recent imports list
  const [history, setHistory] = useState<StrategyItem[]>([
    {
      id: '1',
      name: 'RSI_BB_LB_LONG_SL2_TP4',
      source: 'USER_PROMPT',
      createdAt: '20/05/2025 10:42',
      version: '1.0.0',
      tags: ['RSI', 'BB', 'Long'],
      status: 'Hợp lệ',
    },
    {
      id: '2',
      name: 'MACD_Cross_TrendFollow',
      source: 'WEB_IMPORT',
      createdAt: '19/05/2025 16:30',
      version: '1.2.1',
      tags: ['MACD', 'Trend', 'Swing'],
      status: 'Hợp lệ',
    },
  ]);

  // Simulate LLM Analysis
  const handleAnalyze = () => {
    if (!prompt.trim()) return;
    setIsAnalyzing(true);
    
    setTimeout(() => {
      setIsAnalyzing(false);
      setStrategySource('USER_PROMPT');
      setStrategyName('RSI_BB_LB_LONG_SL2_TP4');
      setStrategyTags(['RSI', 'Bollinger', 'Mean Reversion', 'Long']);
      setJsonDefinition(DEFAULT_JSON);
    }, 1200);
  };

  // Simulate web extraction
  const handleExtract = () => {
    if (!url.trim()) return;
    setIsExtracting(true);

    setTimeout(() => {
      setIsExtracting(false);
      setStrategySource('WEB_IMPORT');
      setStrategyName('TV_Trend_Strategy');
      setStrategyTags(['TradingView', 'Trend', 'Imported']);
      
      const newJson = `{
  "name": "TV_Trend_Strategy",
  "version": "1.0.0",
  "description": "Extracted from TradingView. Simple crossover strategy.",
  "indicators": {
    "ema_fast": { "name": "EMA", "period": 9 },
    "ema_slow": { "name": "EMA", "period": 21 }
  },
  "conditions": {
    "long": [
      { "indicator": "EMA_9", "operator": ">", "value": "EMA_21" }
    ],
    "short": [
      { "indicator": "EMA_9", "operator": "<", "value": "EMA_21" }
    ]
  },
  "riskManagement": {
    "stopLoss": { "type": "percent", "value": 1.5 },
    "takeProfit": { "type": "percent", "value": 3.0 }
  },
  "timeframe": "1h",
  "applicability": {
    "pairs": "BTCUSDT",
    "market": "futures"
  }
}`;
      setJsonDefinition(newJson);
    }, 1200);
  };

  // Copy JSON to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(jsonDefinition);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Add Tag
  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      if (!strategyTags.includes(tagInput.trim())) {
        setStrategyTags([...strategyTags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setStrategyTags(strategyTags.filter((t) => t !== tag));
  };

  // Save Strategy to history
  const handleSave = () => {
    if (!strategyName.trim()) return;
    
    const newItem: StrategyItem = {
      id: Date.now().toString(),
      name: strategyName,
      source: strategySource,
      createdAt: new Date().toLocaleString('vi-VN', { hour12: false }),
      version: strategyVersion,
      tags: [...strategyTags],
      status: 'Hợp lệ',
    };

    setHistory([newItem, ...history]);
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Tạo Strategy từ Prompt / URL</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Người dùng nhập ngôn ngữ tự nhiên hoặc link website để hệ thống sinh strategy và lưu vào thư viện
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

      {/* Main Grid Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Column (Inputs) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Nhập Mô Tả */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <span>Nhập mô tả strategy</span>
                <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
              </h3>
            </div>
            
            <textarea
              className="w-full h-40 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-xs leading-relaxed focus:outline-none focus:border-blue-500 resize-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ví dụ: Khi RSI dưới 30 thì LONG..."
              maxLength={1000}
            />
            
            <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
              <span>{prompt.length}/1000</span>
              <span>Giới hạn 1000 ký tự</span>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
              >
                <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isAnalyzing ? 'Đang phân tích...' : 'Phân tích bằng LLM'}</span>
              </button>
              <button 
                onClick={() => setPrompt('')}
                className="p-2.5 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                title="Xóa mô tả"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>

          {/* Nhập URL */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>Nhập URL chiến lược</span>
              <HelpCircle className="w-4 h-4 text-slate-400 cursor-pointer" />
            </h3>

            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <input
                  type="text"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium text-xs focus:outline-none focus:border-blue-500"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://tradingview.com/script/..."
                />
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                Hỗ trợ: TradingView, Blogger, Medium, GitHub Gist, Docs...
              </p>
            </div>

            <button 
              onClick={handleExtract}
              disabled={isExtracting}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-extrabold text-xs shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
            >
              <Globe className={`w-4 h-4 ${isExtracting ? 'animate-spin' : ''}`} />
              <span>{isExtracting ? 'Đang trích xuất...' : 'Trích xuất từ website'}</span>
            </button>
          </article>
        </div>

        {/* Middle Column (Analysis Output & JSON) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Strategy đã phân tích */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Strategy đã phân tích</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Conditions List */}
              <div className="flex flex-col gap-3">
                <div className="bg-emerald-50/50 border border-emerald-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Điều kiện LONG
                  </span>
                  <ul className="list-disc pl-4 text-[11px] font-semibold text-slate-600 flex flex-col gap-1">
                    <li>RSI (14) &lt; 30</li>
                    <li>Giá đóng cửa nằm dưới Bollinger Lower Band (20, 2)</li>
                  </ul>
                </div>

                <div className="bg-red-50/50 border border-red-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Điều kiện SHORT
                  </span>
                  <ul className="list-disc pl-4 text-[11px] font-semibold text-slate-600 flex flex-col gap-1">
                    <li>RSI (14) &gt; 70</li>
                    <li>Giá đóng cửa nằm trên Bollinger Upper Band (20, 2)</li>
                  </ul>
                </div>
              </div>

              {/* Params / Timeframe info */}
              <div className="flex flex-col gap-3">
                <div className="bg-purple-50/50 border border-purple-100 p-3.5 rounded-xl flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-purple-800 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Quản trị rủi ro
                  </span>
                  <ul className="list-disc pl-4 text-[11px] font-semibold text-slate-600 flex flex-col gap-1">
                    <li>Stop Loss: 2%</li>
                    <li>Take Profit: 4%</li>
                  </ul>
                </div>

                <div className="bg-slate-50 border border-slate-200/50 p-3.5 rounded-xl grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Khung thời gian</span>
                    <span className="text-xs font-extrabold text-slate-700 mt-1">1h (mặc định)</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Áp dụng cho cặp</span>
                    <span className="text-xs font-extrabold text-slate-700 mt-1">Tất cả cặp USDT</span>
                  </div>
                </div>
              </div>

            </div>
          </article>

          {/* JSON Definition */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3 relative">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <FileJson className="w-4 h-4 text-blue-500" />
                <span>Định nghĩa strategy (JSON)</span>
              </h3>
              <button 
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-bold text-slate-600 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
              </button>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto border border-slate-950 max-h-[300px]">
              <pre className="text-[11px] font-mono text-slate-300 leading-relaxed text-left whitespace-pre">
                <code>{jsonDefinition}</code>
              </pre>
            </div>
          </article>

          {/* Validation Indicators */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-800">Kiểm tra & Validation</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Thiếu trường bắt buộc</span>
                  <span className="text-xs font-bold text-slate-700 mt-0.5">Không có</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Kiểm tra logic</span>
                  <span className="text-xs font-bold text-slate-700 mt-0.5">Logic hợp lệ</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Chỉ báo hỗ trợ</span>
                  <span className="text-xs font-bold text-slate-700 mt-0.5">Hỗ trợ đầy đủ</span>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>

            </div>

            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 p-3 rounded-xl text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <div className="text-xs">
                <span className="font-bold">Trạng thái: </span>
                <span className="font-medium">Hợp lệ để lưu vào thư viện</span>
              </div>
            </div>
          </article>
        </div>

        {/* Right Column (Library form details) */}
        <div className="lg:col-span-1">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 h-full">
            <h3 className="text-sm font-extrabold text-slate-800">Lưu vào Strategy Library</h3>
            
            <div className="flex flex-col gap-4 flex-1">
              {/* Form - Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                />
              </div>

              {/* Form - Version */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Version</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategyVersion}
                  onChange={(e) => setStrategyVersion(e.target.value)}
                />
              </div>

              {/* Form - Tags */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tags</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl border border-slate-200 bg-slate-50 min-h-[44px]">
                  {strategyTags.map((tag) => (
                    <span 
                      key={tag} 
                      className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-lg text-[10px]"
                    >
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="text-slate-400 hover:text-red-500 transition-colors">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="flex-1 bg-transparent border-none text-xs font-semibold text-slate-700 min-w-[60px] focus:outline-none"
                    placeholder="Thêm tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                  />
                </div>
              </div>

              {/* Form - Source */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Source</label>
                <select
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                  value={strategySource}
                  onChange={(e) => setStrategySource(e.target.value as any)}
                >
                  <option value="USER_PROMPT">USER_PROMPT</option>
                  <option value="WEB_IMPORT">WEB_IMPORT</option>
                </select>
              </div>
            </div>

            <button 
              onClick={handleSave}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99]"
            >
              <Save className="w-4.5 h-4.5" />
              <span>Lưu Strategy</span>
            </button>
          </article>
        </div>

      </div>

      {/* Bottom Table Section */}
      <section className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-extrabold text-slate-800">Chiến lược đã import gần đây</h3>
          <button className="text-xs font-bold text-blue-600 hover:underline">Xem tất cả &gt;</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-bold text-slate-600 text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-400 border-b border-slate-100 text-[10px] tracking-wider">
                <th className="py-3 px-4">Tên strategy</th>
                <th className="py-3 px-3">Source</th>
                <th className="py-3 px-3">Ngày tạo</th>
                <th className="py-3 px-2">Version</th>
                <th className="py-3 px-3">Tags</th>
                <th className="py-3 px-3">Trạng thái</th>
                <th className="py-3 px-4 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-slate-800">{item.name}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${
                      item.source === 'USER_PROMPT' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                    }`}>
                      {item.source}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-500 font-medium">{item.createdAt}</td>
                  <td className="py-3 px-2 text-slate-500 font-semibold">{item.version}</td>
                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <span key={tag} className="bg-slate-100 border border-slate-200/50 text-slate-500 font-bold px-1.5 py-0.5 rounded text-[9px]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="flex items-center gap-1.5 text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>{item.status}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-2">
                      <button className="p-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 text-slate-500 hover:text-slate-900 transition-colors">
                        <Play className="w-3.5 h-3.5 fill-slate-500 hover:fill-slate-900" />
                      </button>
                      <button className="p-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 text-slate-500 hover:text-slate-900 transition-colors">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
