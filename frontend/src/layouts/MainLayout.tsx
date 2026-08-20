import { NavLink, Outlet } from 'react-router-dom';
import { 
  Activity, 
  Cpu, 
  Search, 
  LineChart, 
  Newspaper, 
  Settings, 
  FlaskConical, 
  ChevronDown, 
  GraduationCap
} from 'lucide-react';

export default function MainLayout() {
  const menuItems = [
    { path: '/realtime', label: 'Realtime', icon: Activity },
    { path: '/strategy-engine', label: 'Strategy Engine', icon: Cpu },
    { path: '/discovery', label: 'Discovery', icon: Search },
    { path: '/backtest', label: 'Backtest', icon: LineChart },
    { path: '/news-crawler', label: 'News Crawler', icon: Newspaper },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col justify-between shrink-0 h-screen sticky top-0">
        <div className="p-5 flex flex-col gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
              <FlaskConical className="w-5.5 h-5.5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-tight text-[15px]">Crypto</h1>
              <p className="text-[13px] font-semibold text-slate-500 leading-none">Strategy Lab</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom Part */}
        <div className="p-5 flex flex-col gap-4">
          {/* Pro Student Badge */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex gap-3 items-start">
            <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100/55 shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-bold text-slate-950">Pro Student</span>
              <span className="text-[11px] text-slate-400 font-medium">Gói đang dùng</span>
              <span className="text-[11px] text-slate-400 font-medium mt-0.5">Hết hạn: 20/06/2025</span>
            </div>
          </div>

          {/* User Profile */}
          <div className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors border border-transparent hover:border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm border border-indigo-200">
                NM
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[13px] font-semibold text-slate-800 leading-tight">Nguyễn Minh</span>
                <span className="text-[11px] text-slate-400 truncate w-32 font-medium">student@example.com</span>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-h-screen overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
