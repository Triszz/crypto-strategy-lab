/**
 * StrategyCatalogue — displays the list of all registered strategies
 * fetched from GET /api/strategies.
 *
 * - Loading, error, and empty states are handled.
 * - Client-side filtering by name and family.
 * - Strategy cards are fully dynamic — no hard-coded strategy names.
 */
import { useState, useMemo } from "react";
import {
  Search,
  TrendingUp,
  Activity,
  Zap,
  BarChart2,
  Layers,
  ChevronRight,
  Loader2,
  AlertCircle,
  Clock,
  Settings2,
  Info,
} from "lucide-react";
import type { StrategyListItem } from "../../services/strategyApi";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Map strategy family strings to colour/badge classes. */
function familyBadgeClass(family: string): string {
  const f = family.toUpperCase();
  if (f.includes("TREND")) return "bg-blue-50 text-blue-600 border-blue-100";
  if (f.includes("MOMENTUM")) return "bg-purple-50 text-purple-600 border-purple-100";
  if (f.includes("STRUCTURE")) return "bg-amber-50 text-amber-600 border-amber-100";
  if (f.includes("VOLATILITY")) return "bg-emerald-50 text-emerald-600 border-emerald-100";
  if (f.includes("SENTIMENT")) return "bg-rose-50 text-rose-600 border-rose-100";
  return "bg-slate-50 text-slate-600 border-slate-100";
}

/** Small icon per family. */
function familyIcon(family: string): React.ReactNode {
  const f = family.toUpperCase();
  const cls = "w-3.5 h-3.5";
  if (f.includes("TREND")) return <TrendingUp className={cls} />;
  if (f.includes("MOMENTUM")) return <Activity className={cls} />;
  if (f.includes("STRUCTURE")) return <BarChart2 className={cls} />;
  if (f.includes("VOLATILITY")) return <Zap className={cls} />;
  if (f.includes("SENTIMENT")) return <Layers className={cls} />;
  return <TrendingUp className={cls} />;
}

/** Badge for the strategy type. */
function typeBadge(type: string) {
  return (
    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 tracking-wide">
      {type}
    </span>
  );
}

// ─── StrategyCard ────────────────────────────────────────────────────────────

interface StrategyCardProps {
  strategy: StrategyListItem;
  onSelect: (strategy: StrategyListItem) => void;
}

function StrategyCard({ strategy, onSelect }: StrategyCardProps) {
  const { name, family, description, type, requiredHistory, supportedTimeframes, parameterSpec } =
    strategy;
  const fieldCount = parameterSpec.fields.length;
  const timeframes = supportedTimeframes ?? [];

  return (
    <button
      onClick={() => onSelect(strategy)}
      className="group w-full text-left bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:border-blue-200 hover:shadow-md hover:shadow-blue-100 transition-all duration-200 flex flex-col gap-3"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Family badge */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${familyBadgeClass(family)}`}
            >
              {familyIcon(family)}
              {family}
            </span>
            {typeBadge(type)}
          </div>
          <h3 className="text-sm font-extrabold text-slate-900 truncate leading-tight mt-0.5">
            {name}
          </h3>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 mt-1 transition-colors" />
      </div>

      {/* Description */}
      {description && (
        <p className="text-[11px] text-slate-400 font-medium leading-relaxed line-clamp-2">
          {description}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-400 font-semibold">
        {/* Required history */}
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {requiredHistory} candles
        </span>

        {/* Parameter count */}
        <span className="flex items-center gap-1">
          <Settings2 className="w-3 h-3" />
          {fieldCount} param{fieldCount !== 1 ? "s" : ""}
        </span>

        {/* Timeframes */}
        {timeframes.length > 0 && (
          <span className="flex items-center gap-1">
            <BarChart2 className="w-3 h-3" />
            {timeframes.slice(0, 4).join(", ")}
            {timeframes.length > 4 ? ` +${timeframes.length - 4}` : ""}
          </span>
        )}
      </div>

      {/* Hint */}
      <span className="text-[10px] text-blue-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
        Configure strategy →
      </span>
    </button>
  );
}

// ─── Filter Bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  nameFilter: string;
  onNameFilter: (v: string) => void;
  familyFilter: string;
  onFamilyFilter: (v: string) => void;
  families: string[];
}

function FilterBar({ nameFilter, onNameFilter, familyFilter, onFamilyFilter, families }: FilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {/* Name search */}
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          placeholder="Search strategies…"
          value={nameFilter}
          onChange={(e) => onNameFilter(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 placeholder-slate-300 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
        />
      </div>

      {/* Family filter */}
      <select
        value={familyFilter}
        onChange={(e) => onFamilyFilter(e.target.value)}
        className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer"
      >
        <option value="">All families</option>
        {families.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Loading / Error / Empty states ───────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin" />
      <span className="text-xs font-semibold">Loading strategies…</span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-400">
      <AlertCircle className="w-8 h-8" />
      <span className="text-xs font-semibold text-center max-w-xs">{message}</span>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
      <Info className="w-8 h-8" />
      <span className="text-xs font-semibold">
        {filtered ? "No strategies match your filters." : "No strategies are registered."}
      </span>
    </div>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────────

export interface StrategyCatalogueProps {
  /** Strategies fetched from the parent page. */
  strategies: StrategyListItem[];
  /** True while the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message if the fetch failed. */
  error: string | null;
  /** Called when the user clicks "Configure" on a strategy card. */
  onSelectStrategy: (strategy: StrategyListItem) => void;
}

export function StrategyCatalogue({
  strategies,
  isLoading,
  error,
  onSelectStrategy,
}: StrategyCatalogueProps) {
  const [nameFilter, setNameFilter] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");

  // Collect unique families for the filter dropdown
  const families = useMemo(
    () => Array.from(new Set(strategies.map((s) => s.family))).sort(),
    [strategies],
  );

  // Apply filters
  const filtered = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return strategies.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (familyFilter && s.family !== familyFilter) return false;
      return true;
    });
  }, [strategies, nameFilter, familyFilter]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (strategies.length === 0) return <EmptyState filtered={false} />;

  return (
    <div className="flex flex-col gap-5">
      <FilterBar
        nameFilter={nameFilter}
        onNameFilter={setNameFilter}
        familyFilter={familyFilter}
        onFamilyFilter={setFamilyFilter}
        families={families}
      />

      {filtered.length === 0 ? (
        <EmptyState filtered />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <StrategyCard key={s.id} strategy={s} onSelect={onSelectStrategy} />
          ))}
        </div>
      )}
    </div>
  );
}
