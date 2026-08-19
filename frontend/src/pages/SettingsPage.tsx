import { useState } from 'react';
import { Bell, Save, RefreshCw, Sliders, Palette, Database, Check } from 'lucide-react';

interface SettingsForm {
  defaultSymbol: string;
  defaultTimeframe: string;
  theme: 'dark' | 'light';
  notifications: boolean;
  soundEnabled: boolean;
  autoRefresh: boolean;
  refreshInterval: number;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-accent' : 'bg-bg-secondary border border-border'
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
        <Icon className="w-5 h-5 text-accent" />
      </div>
      <div>
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="text-xs text-text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsForm>({
    defaultSymbol: 'BTCUSDT',
    defaultTimeframe: '1h',
    theme: 'dark',
    notifications: true,
    soundEnabled: true,
    autoRefresh: true,
    refreshInterval: 30,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];
  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Settings</h2>
          <p className="text-sm text-text-muted mt-1">Configure your application preferences</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
            saved
              ? 'bg-success text-white shadow-success/20'
              : 'bg-accent hover:bg-accent-hover text-white shadow-accent/20'
          }`}
        >
          {isSaving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </div>

      {/* Default Settings */}
      <div className="rounded-2xl border border-border bg-bg-card p-6">
        <SectionHeader icon={Sliders} title="Default Settings" subtitle="Set default values for new sessions" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
              Default Symbol
            </label>
            <select
              value={settings.defaultSymbol}
              onChange={(e) => setSettings({ ...settings, defaultSymbol: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              {symbols.map(sym => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
              Default Timeframe
            </label>
            <select
              value={settings.defaultTimeframe}
              onChange={(e) => setSettings({ ...settings, defaultTimeframe: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              {timeframes.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="rounded-2xl border border-border bg-bg-card p-6">
        <SectionHeader icon={Palette} title="Appearance" subtitle="Customize the look and feel" />
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">Theme</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSettings({ ...settings, theme: 'dark' })}
              className={`p-4 rounded-xl border-2 transition-all ${
                settings.theme === 'dark'
                  ? 'border-accent bg-accent-muted/50'
                  : 'border-border bg-bg-secondary hover:border-accent/30'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-900 to-slate-700 border border-slate-600 mx-auto mb-2.5" />
              <p className="text-sm font-semibold text-text-primary">Dark</p>
              <p className="text-xs text-text-muted mt-0.5">Easy on the eyes</p>
            </button>
            <button
              onClick={() => setSettings({ ...settings, theme: 'light' })}
              className={`p-4 rounded-xl border-2 transition-all ${
                settings.theme === 'light'
                  ? 'border-accent bg-accent-muted/50'
                  : 'border-border bg-bg-secondary hover:border-accent/30'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-white to-slate-100 border border-slate-300 mx-auto mb-2.5" />
              <p className="text-sm font-semibold text-text-primary">Light</p>
              <p className="text-xs text-text-muted mt-0.5">Clean & bright</p>
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-2xl border border-border bg-bg-card p-6">
        <SectionHeader icon={Bell} title="Notifications" subtitle="Manage notification preferences" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Enable Notifications</p>
              <p className="text-xs text-text-muted">Get notified about important events</p>
            </div>
            <Toggle checked={settings.notifications} onChange={() => setSettings({ ...settings, notifications: !settings.notifications })} />
          </div>
          <div className="h-px bg-border/50" />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Sound Effects</p>
              <p className="text-xs text-text-muted">Play sounds for alerts</p>
            </div>
            <Toggle checked={settings.soundEnabled} onChange={() => setSettings({ ...settings, soundEnabled: !settings.soundEnabled })} />
          </div>
        </div>
      </div>

      {/* Data Refresh */}
      <div className="rounded-2xl border border-border bg-bg-card p-6">
        <SectionHeader icon={Database} title="Data Refresh" subtitle="Configure automatic data updates" />
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">Auto Refresh</p>
              <p className="text-xs text-text-muted">Automatically refresh market data</p>
            </div>
            <Toggle checked={settings.autoRefresh} onChange={() => setSettings({ ...settings, autoRefresh: !settings.autoRefresh })} />
          </div>
          {settings.autoRefresh && (
            <div className="pt-2">
              <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                Refresh Interval (seconds)
              </label>
              <input
                type="number"
                value={settings.refreshInterval}
                onChange={(e) => setSettings({ ...settings, refreshInterval: parseInt(e.target.value) || 30 })}
                min={10}
                max={300}
                className="w-full px-3.5 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
