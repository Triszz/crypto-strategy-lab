import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Settings2,
  Trophy,
  Newspaper,
  FlaskConical,
  Play,
  Bell,
  Search,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';

const navItems = [
  { path: '/realtime', icon: Activity, label: 'Realtime' },
  { path: '/strategy', icon: FlaskConical, label: 'Strategy' },
  { path: '/backtest', icon: Play, label: 'Backtest' },
  { path: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { path: '/news', icon: Newspaper, label: 'News' },
  { path: '/settings', icon: Settings2, label: 'Settings' },
];

export default function MainLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentPage = navItems.find(item => 
    location.pathname === item.path || 
    (item.path !== '/dashboard' && location.pathname.startsWith(item.path))
  );

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-bg-secondary border-r border-border transition-all duration-300 ${
          sidebarOpen ? 'w-64' : 'w-20'
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-accent" />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="font-semibold text-text-primary">Crypto</span>
                <span className="text-xs text-accent">Strategy Lab</span>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && (
                <span className="font-medium">{label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar Toggle */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="m-3 p-2 rounded-xl hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors flex items-center justify-center"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* User */}
        {sidebarOpen && (
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-card">
              <div className="w-10 h-10 rounded-full bg-accent-muted flex items-center justify-center">
                <span className="text-accent font-semibold">T</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary truncate">
                  Trader
                </p>
                <p className="text-xs text-text-muted truncate">
                  Demo User
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-bg-secondary border-b border-border z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
            <FlaskConical className="w-4 h-4 text-accent" />
          </div>
          <span className="font-semibold text-text-primary">Crypto Strategy Lab</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-primary"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Mobile Menu */}
      <div
        className={`lg:hidden fixed top-16 left-0 bottom-0 w-72 bg-bg-secondary border-r border-border z-50 transform transition-transform duration-300 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="p-4 space-y-1">
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-muted flex items-center justify-center">
              <span className="text-accent font-semibold">T</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-text-primary">Trader</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 bg-bg-secondary/80 backdrop-blur-md border-b border-border flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <h1 className="text-base lg:text-lg font-semibold text-text-primary">
              {currentPage?.label || 'Dashboard'}
            </h1>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Search */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search..."
                className="w-64 pl-10 pr-4 py-2 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            {/* Notifications */}
            <button className="relative p-2 rounded-xl hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-accent rounded-full" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto px-4 py-6 lg:px-8 lg:py-8">
          <div className="max-w-[1600px] mx-auto animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
