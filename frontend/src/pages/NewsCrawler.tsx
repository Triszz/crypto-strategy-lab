import { useState } from 'react';
import { 
  HelpCircle, 
  Bell, 
  Play, 
  Settings, 
  Globe, 
  Rss, 
  Code, 
  Check, 
  RefreshCw, 
  ArrowRight,
  TrendingUp,
  ChevronDown
} from 'lucide-react';

interface NewsItem {
  id: number;
  asset: 'BTC' | 'ETH' | 'SOL';
  title: string;
  source: string;
  time: string;
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export default function NewsCrawler() {
  const [sources, setSources] = useState<string[]>(['Website']);
  const selectedAsset = 'BTC, ETH, SOL';
  const [refreshInterval, setRefreshInterval] = useState('1m');
  const [isCrawling, setIsCrawling] = useState(false);
  const [selfHealingActive, setSelfHealingActive] = useState(true);

  // Sentiment state values
  const [posPct, setPosPct] = useState(58);
  const neuPct = 27;
  const [negPct, setNegPct] = useState(15);
  const [analyzedCount, setAnalyzedCount] = useState(1248);

  const [newsFeed, setNewsFeed] = useState<NewsItem[]>([
    {
      id: 1,
      asset: 'BTC',
      title: "BlackRock's Bitcoin ETF sees $200M inflows as BTC holds above $69K",
      source: "CoinDesk",
      time: "10:40",
      summary: "Dòng tiền vào các quỹ ETF Bitcoin giao ngay tại Mỹ tiếp tục tăng, dẫn dắt bởi BlackRock IBIT trong bối cảnh giá giữ vững mốc hỗ trợ.",
      sentiment: 'positive'
    },
    {
      id: 2,
      asset: 'ETH',
      title: "Ethereum Pectra testnet upgrade live, developers eye final launch",
      source: "The Block",
      time: "10:32",
      summary: "Bản nâng cấp Pectra trên testnet Sepolia đã hoạt động ổn định, mục tiêu triển khai mainnet vào cuối tháng 5 để tối ưu chi phí gas.",
      sentiment: 'positive'
    },
    {
      id: 3,
      asset: 'SOL',
      title: "Solana network fees drop 60% amid lower memecoin activity",
      source: "Decrypt",
      time: "10:28",
      summary: "Phí giao dịch trên Solana giảm mạnh khi hoạt động giao dịch memecoin hạ nhiệt, cải thiện đáng kể tốc độ và trải nghiệm người dùng.",
      sentiment: 'neutral'
    },
    {
      id: 4,
      asset: 'BTC',
      title: "CME Bitcoin futures open interest hits new all-time high",
      source: "Cointelegraph",
      time: "10:20",
      summary: "Hợp đồng tương lai Bitcoin trên CME đạt mức cao kỷ lục, cho thấy nhu cầu phòng ngừa rủi ro từ các tổ chức tài chính lớn tăng mạnh.",
      sentiment: 'positive'
    },
    {
      id: 5,
      asset: 'ETH',
      title: "Vitalik outlines roadmap for Ethereum scaling post-Pectra",
      source: "Bankless",
      time: "10:15",
      summary: "Vitalik Buterin chia sẻ định hướng mở rộng quy mô Ethereum bằng công nghệ L2 rollup mới sau khi hoàn thành Pectra.",
      sentiment: 'neutral'
    },
    {
      id: 6,
      asset: 'SOL',
      title: "Solana Mobile Chapter 2 pre-orders start, token BONK spikes",
      source: "The Defiant",
      time: "10:05",
      summary: "Đơn đặt hàng trước cho điện thoại Solana Mobile thế hệ hai đã bắt đầu, thúc đẩy khối lượng giao dịch cho hệ sinh thái SPL.",
      sentiment: 'positive'
    }
  ]);

  // Simulate crawl
  const handleStartCrawl = () => {
    setIsCrawling(true);
    setTimeout(() => {
      setIsCrawling(false);
      // Prepend a simulated news item
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      
      const newArticles: NewsItem[] = [
        {
          id: Date.now(),
          asset: Math.random() > 0.6 ? 'BTC' : Math.random() > 0.3 ? 'ETH' : 'SOL',
          title: Math.random() > 0.6 
            ? "US Fed holds interest rates steady, crypto markets react with volatility" 
            : Math.random() > 0.3 
            ? "L2 Scaling networks reach new transaction milestone, beating Mainnet" 
            : "Solana DeFi TVL surges 15% in a week, leading indicators show strong demand",
          source: Math.random() > 0.5 ? "CoinDesk" : "Cointelegraph",
          time: timeStr,
          summary: "Phản ứng thị trường nhanh chóng ghi nhận khối lượng tăng cao sau các tin tức mới nhất từ giới chức và nhà lập trình.",
          sentiment: Math.random() > 0.4 ? 'positive' : 'negative'
        }
      ];

      setNewsFeed(prev => [newArticles[0], ...prev.slice(0, 5)]);

      // Animate sentiment slightly
      if (newArticles[0].sentiment === 'positive') {
        setPosPct(prev => Math.min(prev + 1, 100));
        setNegPct(prev => Math.max(prev - 1, 0));
      } else {
        setNegPct(prev => Math.min(prev + 1, 100));
        setPosPct(prev => Math.max(prev - 1, 0));
      }
      setAnalyzedCount(prev => prev + 1);

    }, 1500);
  };

  const toggleSource = (src: string) => {
    if (sources.includes(src)) {
      setSources(sources.filter(s => s !== src));
    } else {
      setSources([...sources, src]);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">News Crawler & Phân tích thị trường</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Thu nhập tin tức, hiểu HTML bằng LLM, lưu template và phân tích sentiment
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

      {/* Crawl Control Panel */}
      <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap gap-6 items-end justify-between">
        <div className="flex flex-wrap gap-6">
          {/* Sources Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nguồn</label>
            <div className="flex gap-2">
              <button 
                onClick={() => toggleSource('Website')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  sources.includes('Website') 
                    ? 'border-blue-600 bg-blue-50 text-blue-600' 
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Website</span>
              </button>
              <button 
                onClick={() => toggleSource('RSS')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  sources.includes('RSS') 
                    ? 'border-blue-600 bg-blue-50 text-blue-600' 
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Rss className="w-3.5 h-3.5" />
                <span>RSS</span>
              </button>
              <button 
                onClick={() => toggleSource('HTML')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  sources.includes('HTML') 
                    ? 'border-blue-600 bg-blue-50 text-blue-600' 
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>{`</> HTML`}</span>
              </button>
            </div>
          </div>

          {/* Pair selector */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pair (Asset)</label>
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 min-w-[140px] justify-between">
                <span>{selectedAsset}</span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Auto Refresh selector */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Auto refresh</label>
            <div className="flex p-0.75 bg-slate-50 rounded-xl border border-slate-200/80">
              {['1 phút', '2 phút', '3 phút', '4 phút', '5 phút'].map((int) => (
                <button
                  key={int}
                  onClick={() => setRefreshInterval(int)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    refreshInterval === int
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {int}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={handleStartCrawl}
            disabled={isCrawling}
            className="flex items-center gap-2 py-2.5 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
          >
            <Play className={`w-4 h-4 fill-white ${isCrawling ? 'animate-spin' : ''}`} />
            <span>{isCrawling ? 'Đang crawl...' : 'Bắt đầu crawl'}</span>
          </button>
        </div>
      </section>

      {/* Main Grid Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left column (Tin tức đầu vào, occupies 1.5 columns) */}
        <div className="xl:col-span-1.5">
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Tin tức đầu vào</h3>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                <RefreshCw className="w-3 h-3" /> Cập nhật: 10:45:18
              </span>
            </div>

            <div className="flex flex-col gap-3 max-h-[750px] overflow-y-auto pr-1">
              {newsFeed.map((item) => (
                <div 
                  key={item.id} 
                  className="p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-xs bg-slate-50/40 hover:bg-white transition-all flex gap-3.5 items-start text-left group cursor-pointer"
                >
                  <span className={`w-9 h-9 rounded-lg font-black text-xs flex items-center justify-center border shrink-0 ${
                    item.asset === 'BTC' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                    item.asset === 'ETH' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                    'bg-purple-50 text-purple-600 border-purple-100'
                  }`}>
                    {item.asset === 'BTC' ? '₿' : item.asset === 'ETH' ? 'Ξ' : 'S'}
                  </span>
                  
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="text-xs font-black text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                        {item.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2.5 text-[9.5px] font-bold text-slate-400">
                      <span>{item.source}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span>{item.time}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span className={`px-1.5 py-0.25 rounded text-[8px] font-black ${
                        item.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-600' :
                        item.sentiment === 'negative' ? 'bg-red-50 text-red-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {item.sentiment.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5">
                      {item.summary}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button className="w-full py-2.5 border-t border-slate-100 text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors flex items-center justify-center gap-1 mt-1">
              <span>Xem tất cả tin tức</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </article>
        </div>

        {/* Middle column (Extraction Flow Diagram, occupies 1.5 columns) */}
        <div className="xl:col-span-1.5 flex flex-col gap-6">
          
          {/* LLM-assisted Extraction */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">LLM-assisted Extraction</h3>
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-600 font-bold text-[10px]">
                Template: v1.4.2
              </span>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-4">
              <div className="flex justify-between items-start text-center">
                {/* Step 1 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 font-bold text-xs flex items-center justify-center border border-blue-100 shadow-sm">
                    1
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">HTML thô</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Thu thập nội dung HTML từ nguồn</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Step 2 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 font-bold text-xs flex items-center justify-center border border-purple-100 shadow-sm">
                    2
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">LLM hiểu tag HTML</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Đọc & hiểu, nhận diện vùng</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Step 3 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-xs flex items-center justify-center border border-emerald-100 shadow-sm">
                    3
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Sinh template</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Tạo template trích xuất đề xuất</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Step 4 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 font-bold text-xs flex items-center justify-center border border-amber-100 shadow-sm">
                    4
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Lưu template</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Quản lý phiên bản lưu trữ</span>
                </div>
              </div>

              {/* Extraction Specs Panel */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/50 text-xs font-bold text-slate-700">
                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left">
                  <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Nhận diện vùng:</span>
                  <div className="flex flex-col gap-0.5 font-mono text-[9px] text-slate-600">
                    <div>title &rarr; <span className="text-blue-600">h1.article-title</span></div>
                    <div>summary &rarr; <span className="text-blue-600">p.summary</span></div>
                    <div>source &rarr; <span className="text-blue-600">span.source</span></div>
                  </div>
                  <div className="text-[9px] text-emerald-600 mt-2.5 font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Độ tin cậy: 0.92
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Các phiên bản:</span>
                    <div className="flex flex-col gap-1.5 mt-1.5 text-[9.5px]">
                      <div className="flex justify-between items-center font-semibold text-slate-700">
                        <span className="text-blue-600">v1.4.2 (Hiện tại)</span>
                        <span className="text-slate-400 font-medium">10:32 • 18/05/2025</span>
                      </div>
                      <div className="flex justify-between items-center font-semibold text-slate-400">
                        <span>v1.4.1</span>
                        <span>09:10 • 17/05/2025</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold mt-2 pt-1 border-t border-slate-100">
                    <span>Fields: 5 | Score: 0.92</span>
                    <button className="text-blue-600">Xem tất cả</button>
                  </div>
                </div>
              </div>
            </div>
          </article>

          {/* Self-healing extraction */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Self-healing extraction</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400">Tự động bật</span>
                <button 
                  onClick={() => setSelfHealingActive(!selfHealingActive)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${
                    selfHealingActive ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                    selfHealingActive ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-4">
              <div className="flex justify-between items-start text-center">
                {/* Step 1 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 font-bold text-xs flex items-center justify-center border border-blue-100 shadow-sm">
                    1
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Validate kết quả</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Kiểm tra chất lượng kết quả trích xuất</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Decision Step */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 font-bold text-xs flex items-center justify-center border border-rose-100 shadow-sm border-dashed">
                    ?
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Lỗi cao? (vd &gt; 10%)</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Nếu Yes &rarr; Kích hoạt LLM sửa</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Step 3 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 font-bold text-xs flex items-center justify-center border border-purple-100 shadow-sm">
                    3
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">LLM sửa template</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">LLM phân tích lỗi & đề xuất sửa đổi</span>
                </div>
                
                <span className="text-slate-300 text-xs font-bold mt-2">&rarr;</span>
                
                {/* Step 4 */}
                <div className="flex flex-col items-center flex-1">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-xs flex items-center justify-center border border-emerald-100 shadow-sm">
                    4
                  </span>
                  <span className="text-[9px] font-bold text-slate-700 mt-2">Lưu version mới</span>
                  <span className="text-[8px] text-slate-400 font-semibold leading-tight mt-0.5 max-w-[80px]">Tự động cập nhật bản chạy mới</span>
                </div>
              </div>

              {/* Validation Specs panel */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200/50 text-xs font-bold text-slate-700">
                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Chỉ số hiện tại:</span>
                    <div className="flex flex-col gap-1.5 mt-1.5 font-semibold text-[10px] text-slate-600">
                      <div className="flex justify-between"><span>Fields rỗng:</span><span className="text-slate-800 font-bold">8.7%</span></div>
                      <div className="flex justify-between"><span>Sai định dạng:</span><span className="text-slate-800 font-bold">3.2%</span></div>
                      <div className="flex justify-between"><span>Độ tin cậy TB:</span><span className="text-emerald-600 font-bold">0.76</span></div>
                    </div>
                  </div>
                  <div className="text-[10px] text-red-500 font-black mt-3 pt-1 border-t border-slate-100 flex justify-between">
                    <span>Tổng lỗi:</span>
                    <span>11.9%</span>
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200/50 text-left flex flex-col justify-between">
                  <div>
                    <span className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Đề xuất template mới:</span>
                    <div className="flex flex-col gap-1 mt-1 font-semibold text-[10px]">
                      <div className="text-slate-700 font-bold">v1.4.3 (draft)</div>
                      <div className="text-emerald-600 mt-1 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" /> Giảm lỗi dự kiến: 11.9% &rarr; 4.1%
                      </div>
                      <div className="text-slate-500 text-[9px] mt-0.5">Độ tin cậy dự kiến: 0.93</div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-3 pt-1 border-t border-slate-100">
                    <button className="text-[9px] text-blue-600">Xem diff</button>
                    <button className="px-2 py-0.75 bg-blue-600 text-white rounded text-[8px] font-black">Áp dụng ngay</button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        {/* Right column (Analysis Output & Strategy Integration, occupies 1 column) */}
        <div className="flex flex-col gap-6">
          {/* Đầu ra phân tích */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-extrabold text-slate-800">Đầu ra phân tích</h3>
              <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Cập nhật: 10:45
              </span>
            </div>

            {/* Sentiment Gauge Segment bar */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Sentiment tổng hợp (24h)</span>
              
              <div className="w-full h-3 rounded-full overflow-hidden flex mt-1">
                <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${posPct}%` }} title={`Positive: ${posPct}%`} />
                <div className="bg-slate-300 h-full transition-all duration-300" style={{ width: `${neuPct}%` }} title={`Neutral: ${neuPct}%`} />
                <div className="bg-red-500 h-full transition-all duration-300" style={{ width: `${negPct}%` }} title={`Negative: ${negPct}%`} />
              </div>

              <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-500 mt-1">
                <span className="text-emerald-600">■ Positive ({posPct}%)</span>
                <span className="text-slate-400">■ Neutral ({neuPct}%)</span>
                <span className="text-red-500">■ Negative ({negPct}%)</span>
              </div>
            </div>

            {/* Event Type tag cloud */}
            <div className="flex flex-col gap-2 pt-3 border-t border-slate-50">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Event Type (Top)</span>
              <div className="flex flex-wrap gap-1.5 mt-0.5 text-[9px] font-bold">
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">ETF / Fund Flow <span className="text-slate-400 ml-0.5">28%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Protocol Upgrade <span className="text-slate-400 ml-0.5">22%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Regulation <span className="text-slate-400 ml-0.5">15%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Partnership <span className="text-slate-400 ml-0.5">12%</span></span>
                <span className="bg-slate-100 border border-slate-200/50 text-slate-700 px-2 py-0.75 rounded-lg">Market Trend <span className="text-slate-400 ml-0.5">23%</span></span>
              </div>
            </div>

            {/* Confidence Stats */}
            <table className="w-full text-xs font-bold text-slate-600 pt-2 border-t border-slate-50">
              <tbody>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Confidence Score (TB)</td>
                  <td className="py-2.5 text-right text-slate-800">0.78</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Số lượng tin đã phân tích (24h)</td>
                  <td className="py-2.5 text-right text-slate-800">{analyzedCount.toLocaleString('en-US')}</td>
                </tr>
                <tr className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400">Độ bao phủ nguồn</td>
                  <td className="py-2.5 text-right text-emerald-600">92%</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-slate-400">Nguồn hoạt động</td>
                  <td className="py-2.5 text-right text-slate-800 flex items-center justify-end gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>23 / 25</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </article>

          {/* Tích hợp với Strategy */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
            <h3 className="text-sm font-extrabold text-slate-800">Tích hợp với Strategy</h3>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
              News Sentiment được sử dụng trực tiếp trong Strategy Engine làm bộ lọc tin tức.
            </p>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
              <div className="flex flex-col gap-2 items-center text-center">
                
                {/* News Sentiment Block */}
                <div className="bg-white border border-slate-200/80 p-2 rounded-lg text-[9.5px] font-bold text-slate-700 w-full flex justify-between items-center shadow-xs">
                  <span>News Sentiment (Realtime)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                </div>
                
                {/* Down Arrow */}
                <div className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1">
                  <span>&darr;</span> <span className="text-[8px] font-semibold">API / Stream</span>
                </div>

                {/* Condition Block */}
                <div className="bg-white border border-slate-200/80 p-2.5 rounded-lg text-[9.5px] font-bold text-slate-700 w-full flex flex-col gap-1 items-center shadow-xs">
                  <span className="text-slate-400 font-semibold text-[8px] uppercase">Điều kiện vào lệnh</span>
                  <span>Sentiment &gt; 0.65</span>
                </div>

                {/* Down Arrow */}
                <div className="text-[10px] text-slate-400 font-bold">
                  <span>&darr;</span> <span className="text-[8px] font-medium">Hoặc sử dụng trực tiếp</span>
                </div>

                {/* Strategy Node Block */}
                <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-xl text-[10px] font-extrabold text-blue-700 w-full flex flex-col items-center gap-1 shadow-sm">
                  <span>NewsSentimentStrategy</span>
                  <span className="text-[8px] text-blue-500 font-semibold">Chiến lược mẫu</span>
                </div>

              </div>
            </div>
          </article>
        </div>

      </div>
    </div>
  );
}
