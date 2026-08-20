import { useState } from 'react';
import { 
  HelpCircle, 
  Bell, 
  Save, 
  Shield, 
  Key, 
  Database, 
  MessageSquareCode
} from 'lucide-react';

export default function Settings() {
  const [defaultSymbol, setDefaultSymbol] = useState('BTCUSDT');
  const [defaultTimeframe, setDefaultTimeframe] = useState('5m');
  const [apiKey, setApiKey] = useState('binance_api_key_xxxxxxxxxxxxxxxxx');
  const [apiSecret, setApiSecret] = useState('••••••••••••••••••••••••••••••••••••');
  const [llmProvider, setLlmProvider] = useState('gemini-3.5-flash');
  const [llmKey, setLlmKey] = useState('gemini_api_key_xxxxxxxxxxxxxxxxx');
  const [dbSync, setDbSync] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);

  const handleSaveSettings = () => {
    alert('Cài đặt đã được lưu thành công!');
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Settings</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Cấu hình tham số hệ thống, API Key và tùy chỉnh giao diện
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

      {/* Settings Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Panel 1: Binance API Credentials */}
        <article className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-500" />
            <span>Cấu hình Binance API (Read-only)</span>
          </h3>

          <div className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Binance API Key</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Binance API Secret</label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </div>
          </div>
        </article>

        {/* Panel 2: LLM Parser config */}
        <article className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <MessageSquareCode className="w-4 h-4 text-blue-500" />
            <span>Cấu hình LLM Parser (Strategy Engine)</span>
          </h3>

          <div className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">LLM Model Provider</label>
              <select
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="gemini-3.5-pro">Gemini 3.5 Pro</option>
                <option value="openai-gpt-4o">GPT-4o</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">LLM API Key</label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
              />
            </div>
          </div>
        </article>

        {/* Panel 3: Default Configuration */}
        <article className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-500" />
            <span>Tham số mặc định hệ thống</span>
          </h3>

          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Default Pair</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={defaultSymbol}
                onChange={(e) => setDefaultSymbol(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Default Timeframe</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold text-xs focus:outline-none focus:border-blue-500"
                value={defaultTimeframe}
                onChange={(e) => setDefaultTimeframe(e.target.value)}
              />
            </div>
          </div>
        </article>

        {/* Panel 4: Notification and sync */}
        <article className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 text-left justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-500" />
              <span>Bảo mật & Đồng bộ hóa</span>
            </h3>

            <div className="flex flex-col gap-4 mt-4">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700">Đồng bộ Database local</span>
                  <span className="text-[10px] text-slate-400 font-semibold mt-0.5">Tự động đồng bộ hóa cấu hình chiến lược với database</span>
                </div>
                <button 
                  onClick={() => setDbSync(!dbSync)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${
                    dbSync ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                    dbSync ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700">Thông báo đẩy (Push notification)</span>
                  <span className="text-[10px] text-slate-400 font-semibold mt-0.5">Nhận thông báo khi phát hiện tín hiệu mua/bán realtime</span>
                </div>
                <button 
                  onClick={() => setPushNotif(!pushNotif)}
                  className={`w-9 h-5 rounded-full transition-colors relative flex items-center ${
                    pushNotif ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 bg-white rounded-full absolute shadow-sm transition-transform ${
                    pushNotif ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </div>

          <button 
            onClick={handleSaveSettings}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-200 transition-all hover:scale-[1.01] active:scale-[0.99] mt-6"
          >
            <Save className="w-4.5 h-4.5" />
            <span>Lưu tất cả cấu hình</span>
          </button>
        </article>

      </div>
    </div>
  );
}
