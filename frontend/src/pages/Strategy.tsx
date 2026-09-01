/**
 * Strategy — the Strategy catalogue and configuration page.
 *
 * Fetches strategies from GET /api/strategies and allows users to:
 *   1. Browse and filter the strategy catalogue.
 *   2. Select a strategy to see its detail and parameter form.
 *   3. Choose a symbol, algorithm, and maxCandidates; click Run Discovery
 *      to POST /api/search/start and navigate to /search/:id.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AlertCircle, RefreshCw, Search as SearchIcon } from "lucide-react";
import { StrategyCatalogue } from "./components/StrategyCatalogue";
import { StrategyDetail, type StrategyConfig } from "./components/StrategyDetail";
import {
  fetchStrategies,
  fetchStrategyById,
  type StrategyListItem,
  type StrategyDetail as StrategyDetailType,
} from "../services/strategyApi";
import {
  fetchSearchSymbols,
  fetchSearchAlgorithms,
  startSearch,
  type SymbolItem,
  type SearchAlgorithmItem,
} from "../services/searchApi";

type View = "catalogue" | "detail";

export default function StrategyPage() {
  // ── Catalogue state ────────────────────────────────────────────────
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  // ── Detail state ────────────────────────────────────────────────────
  const [detail, setDetail] = useState<StrategyDetailType | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── View ──────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("catalogue");

  // ── Discovery state (symbol / algorithm / maxCandidates) ──────────
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [algorithms, setAlgorithms] = useState<SearchAlgorithmItem[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // Last configured strategy (needed at click time)
  const [lastConfig, setLastConfig] = useState<StrategyConfig | null>(null);

  // Default selections — first symbol / first algorithm once loaded
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>("");
  const [selectedAlgorithmId, setSelectedAlgorithmId] = useState<string>("");
  const [maxCandidates, setMaxCandidates] = useState<number>(10);

  // ── Load catalogue ────────────────────────────────────────────────
  const loadCatalogue = useCallback(async () => {
    setCatalogueLoading(true);
    setCatalogueError(null);
    try {
      const result = await fetchStrategies();
      setStrategies([...result.strategies]);
    } catch (err) {
      setCatalogueError((err as Error).message ?? "Failed to load strategies.");
    } finally {
      setCatalogueLoading(false);
    }
  }, []);

  useEffect(() => { void loadCatalogue(); }, [loadCatalogue]);

  // ── Load strategy detail ───────────────────────────────────────────
  const loadDetail = useCallback(async (strategyId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const s = await fetchStrategyById(strategyId);
      setDetail(s);
    } catch (err) {
      setDetailError((err as Error).message ?? "Failed to load strategy detail.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Load symbols + algorithms for Discovery ────────────────────────
  const loadDiscoveryInputs = useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    try {
      const [syms, algos] = await Promise.all([
        fetchSearchSymbols(),
        fetchSearchAlgorithms(),
      ]);
      setSymbols(syms);
      setAlgorithms(algos);
      // Pre-select firsts (don't override if user already picked)
      setSelectedSymbolId((prev) => prev || syms[0]?.id || "");
      setSelectedAlgorithmId((prev) => prev || algos[0]?.id || "");
    } catch (err) {
      setDiscoveryError((err as Error).message ?? "Failed to load symbols or algorithms.");
    } finally {
      setDiscoveryLoading(false);
    }
  }, []);

  useEffect(() => { void loadDiscoveryInputs(); }, [loadDiscoveryInputs]);

  // ── URL routing ────────────────────────────────────────────────────
  const params = useParams<{ strategyId?: string }>();
  useEffect(() => {
    const id = params.strategyId;
    if (id) {
      setView("detail");
      void loadDetail(id);
    } else {
      setView("catalogue");
      setDetail(null);
    }
  }, [params.strategyId, loadDetail]);

  // ── Navigation ───────────────────────────────────────────────────
  const navigate = useNavigate();

  function handleSelectStrategy(strategy: StrategyListItem) {
    navigate(`/strategy/${encodeURIComponent(strategy.id)}`);
  }

  function handleBack() {
    navigate("/strategy");
  }

  // ── Run Discovery ─────────────────────────────────────────────────
  function handleConfigure(config: StrategyConfig) {
    // Just cache the strategy config; user must click Run Discovery
    setLastConfig(config);
  }

  async function handleRunDiscovery() {
    if (!lastConfig) {
      setDiscoveryError("Configure parameters first.");
      return;
    }
    if (!selectedSymbolId || !selectedAlgorithmId) {
      setDiscoveryError("Please select a symbol and algorithm.");
      return;
    }
    setDiscoveryError(null);
    setDiscoveryLoading(true);
    try {
      const algorithmCode = algorithms.find((a) => a.id === selectedAlgorithmId)?.code ?? "random";
      const result = await startSearch({
        algorithmId: selectedAlgorithmId,
        symbolId: selectedSymbolId,
        timeframe: lastConfig.timeframe,
        maxCandidates,
        algorithm: algorithmCode,
      });
      // Navigate to the search page with the start response in router state
      navigate(`/search/${encodeURIComponent(result.searchRunId)}`, {
        state: { startResponse: result },
      });
    } catch (err) {
      setDiscoveryError((err as Error).message ?? "Failed to start search.");
    } finally {
      setDiscoveryLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  if (view === "detail") {
    if (detailLoading) {
      return (
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <span className="text-xs font-semibold">Loading strategy…</span>
          </div>
        </div>
      );
    }

    if (detailError) {
      return (
        <div className="p-6 max-w-2xl mx-auto">
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-red-400">
            <AlertCircle className="w-10 h-10" />
            <p className="text-sm font-semibold text-center max-w-xs">{detailError}</p>
            <button
              onClick={handleBack}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700 transition-colors"
            >
              Back to catalogue
            </button>
          </div>
        </div>
      );
    }

    if (detail) {
      return (
        <div className="p-6 max-w-[1200px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: strategy detail */}
            <div className="lg:col-span-2">
              <StrategyDetail
                strategy={detail}
                onBack={handleBack}
                onConfigure={handleConfigure}
              />
            </div>

            {/* Right: Run Discovery panel */}
            <aside className="lg:col-span-1">
              <DiscoveryPanel
                lastConfig={lastConfig}
                symbols={symbols}
                algorithms={algorithms}
                selectedSymbolId={selectedSymbolId}
                selectedAlgorithmId={selectedAlgorithmId}
                onSymbolChange={setSelectedSymbolId}
                onAlgorithmChange={setSelectedAlgorithmId}
                maxCandidates={maxCandidates}
                onMaxCandidatesChange={setMaxCandidates}
                onRun={handleRunDiscovery}
                loading={discoveryLoading}
                error={discoveryError}
                loadingInputs={discoveryLoading && symbols.length === 0}
              />
            </aside>
          </div>
        </div>
      );
    }

    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <span className="text-xs font-semibold">Loading…</span>
        </div>
      </div>
    );
  }

  // Catalogue view
  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Strategy Catalogue</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Browse and configure registered trading strategies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!catalogueLoading && !catalogueError && (
            <span className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-500">
              {strategies.length} strategy{strategies.length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={() => void loadCatalogue()}
            className="p-2 rounded-xl border border-slate-100 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors"
            title="Refresh strategies"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <StrategyCatalogue
        strategies={strategies}
        isLoading={catalogueLoading}
        error={catalogueError}
        onSelectStrategy={handleSelectStrategy}
      />
    </div>
  );
}

// ─── Discovery Panel (right column on detail page) ──────────────────────────

interface DiscoveryPanelProps {
  lastConfig: StrategyConfig | null;
  symbols: SymbolItem[];
  algorithms: SearchAlgorithmItem[];
  selectedSymbolId: string;
  selectedAlgorithmId: string;
  onSymbolChange: (id: string) => void;
  onAlgorithmChange: (id: string) => void;
  maxCandidates: number;
  onMaxCandidatesChange: (n: number) => void;
  onRun: () => void;
  loading: boolean;
  error: string | null;
  loadingInputs: boolean;
}

function DiscoveryPanel(props: DiscoveryPanelProps) {
  const {
    lastConfig,
    symbols,
    algorithms,
    selectedSymbolId,
    selectedAlgorithmId,
    onSymbolChange,
    onAlgorithmChange,
    maxCandidates,
    onMaxCandidatesChange,
    onRun,
    loading,
    error,
    loadingInputs,
  } = props;

  const canRun = !!lastConfig && !!selectedSymbolId && !!selectedAlgorithmId && !loading;

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-4 sticky top-6">
      <div className="flex items-center gap-2">
        <SearchIcon className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-extrabold text-slate-800">Run Discovery</h3>
      </div>

      <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
        Submit the configured strategy to the Search service. The Search service will
        generate candidates and persist them. Backtest runs separately.
      </p>

      {/* Last config preview */}
      {lastConfig ? (
        <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 flex flex-col gap-1">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Configured strategy</span>
          <span className="text-xs font-extrabold text-slate-700 font-mono">{lastConfig.strategyId}</span>
          <span className="text-[10px] text-slate-500 font-semibold">Timeframe: {lastConfig.timeframe}</span>
          <span className="text-[10px] text-slate-500 font-semibold">
            {Object.keys(lastConfig.parameters).length} parameter(s)
          </span>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-[11px] text-amber-700 font-semibold">
          Configure and validate parameters first (click the button in the parameters form).
        </div>
      )}

      {/* Algorithm */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Search algorithm</label>
        <select
          value={selectedAlgorithmId}
          onChange={(e) => onAlgorithmChange(e.target.value)}
          disabled={loadingInputs}
          className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer disabled:opacity-50"
        >
          {algorithms.length === 0 ? (
            <option value="">{loadingInputs ? "Loading…" : "No algorithms available"}</option>
          ) : (
            algorithms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.code})
              </option>
            ))
          )}
        </select>
      </div>

      {/* Symbol */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Symbol</label>
        <select
          value={selectedSymbolId}
          onChange={(e) => onSymbolChange(e.target.value)}
          disabled={loadingInputs}
          className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer disabled:opacity-50"
        >
          {symbols.length === 0 ? (
            <option value="">{loadingInputs ? "Loading…" : "No symbols available"}</option>
          ) : (
            symbols.map((s) => (
              <option key={s.id} value={s.id}>
                {s.symbol} ({s.baseAsset}/{s.quoteAsset})
              </option>
            ))
          )}
        </select>
      </div>

      {/* maxCandidates */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Max candidates
        </label>
        <input
          type="number"
          value={maxCandidates}
          min={1}
          max={10000}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onMaxCandidatesChange(isNaN(v) ? 1 : Math.max(1, Math.min(10000, v)));
          }}
          className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
        />
        <p className="text-[10px] text-slate-400">1 – 10000 (backend limit)</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] text-red-700 font-semibold flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={onRun}
        disabled={!canRun}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <SearchIcon className="w-3.5 h-3.5" />
            Run Discovery
          </>
        )}
      </button>
    </div>
  );
}