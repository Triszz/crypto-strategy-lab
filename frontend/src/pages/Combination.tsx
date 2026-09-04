/**
 * Combination Builder — UI for composing a Strategy Combination.
 *
 * Implements Module 6 §17 from the project requirements (Domain-guided
 * Search): the user selects ONE strategy from each required family group
 * (Trend, Momentum, Volatility, Structure, Information) and submits the
 * combination into the Search pipeline.
 *
 * The page submits to POST /api/search/start with:
 *   - algorithm: "domain_guided"
 *   - generatorConfig: { familyGroups: [...], mode: "EXHAUSTIVE" }
 *
 * The backend's `DomainGuidedGenerator` enumerates every legal combination
 * (one strategy per group) and emits each as a `CompositeCandidate` for the
 * Search pipeline (Generate → Backtest → Evaluate → Rank).
 *
 * Reference: docs/Crypto Strategy Lab – Đồ án cuối kỳ.md §17.2
 *
 * After a successful submit the user is navigated to /search/:id so they
 * can watch candidates populate and run Backtest on each one.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  HelpCircle,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  TrendingUp,
  Waves,
  Activity,
  Newspaper,
  Workflow,
} from "lucide-react";
import {
  fetchStrategies,
  saveCombination,
  type StrategyListItem,
} from "../services/strategyApi";
import {
  fetchSearchAlgorithms,
  fetchSearchSymbols,
  startSearch,
  type SearchAlgorithmItem,
  type SymbolItem,
} from "../services/searchApi";
import { startLoop, type LoopStatusResponse } from "../services/loopApi";

/**
 * Resolve the parent StrategyVersion for the initial loop iteration.
 *
 * Picks the FIRST CandidateStrategy row from the SearchRun. The actual
 * loop parent will be re-derived from the iteration's best candidate by
 * the backend runner on SearchCompleted — this value is only used as a
 * valid FK placeholder.
 *
 * Falls back to ANY active StrategyVersion when the SearchRun has no
 * candidates yet (rare race condition).
 */
async function resolveInitialParentId(searchRunId: string): Promise<string> {
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(
      `${base}/api/search/${encodeURIComponent(searchRunId)}/candidates`,
      { credentials: "include" },
    );
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: Array<{ strategyVersionId: string }> }
        | null;
      if (json?.success && json.data && json.data.length > 0 && json.data[0]?.strategyVersionId) {
        return json.data[0].strategyVersionId;
      }
    }
  } catch {
    // ignore — fallback below
  }
  // Last-resort fallback: any active StrategyVersion.
  try {
    const res = await fetch(`${base}/api/strategy/list`, { credentials: "include" });
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: Array<{ strategyVersionId?: string }> }
        | null;
      const candidate = json?.data?.find((s) => !!s.strategyVersionId);
      if (candidate?.strategyVersionId) return candidate.strategyVersionId;
    }
  } catch {
    // ignore — final throw below
  }
  throw new Error(
    "Unable to resolve an initial parent StrategyVersion for the Continuous Loop. " +
      "Make sure the Combination search produced at least one candidate before starting the loop.",
  );
}

// ─── Family Groups (Domain Rules — Module 6 §17.2) ───────────────────────────

/**
 * The five family groups defined by the domain rules. A valid composite
 * MUST contain at least one Trend + one Momentum + one Structure strategy.
 * Volatility and Information are optional but encouraged.
 */
interface FamilyGroupDef {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly description: string;
  readonly icon: typeof TrendingUp;
  readonly accent: Accent;
}

const FAMILY_GROUPS: ReadonlyArray<FamilyGroupDef> = [
  {
    key: "trend",
    label: "Trend",
    required: true,
    description: "Bám theo xu hướng giá (MA, MACD, …)",
    icon: TrendingUp,
    accent: "blue",
  },
  {
    key: "momentum",
    label: "Momentum",
    required: true,
    description: "Đo lường đà tăng/giảm (RSI, Stochastic, …)",
    icon: Activity,
    accent: "purple",
  },
  {
    key: "volatility",
    label: "Volatility",
    required: false,
    description: "Phản ứng theo biến động giá (BB, ATR, …)",
    icon: Waves,
    accent: "emerald",
  },
  {
    key: "structure",
    label: "Structure",
    required: true,
    description: "Các vùng hỗ trợ/kháng cự (S/R, SMC, …)",
    icon: Layers,
    accent: "amber",
  },
  {
    key: "information",
    label: "Information",
    required: false,
    description: "Tin tức & sentiment thị trường",
    icon: Newspaper,
    accent: "rose",
  },
] as const;

// ─── Local Types ─────────────────────────────────────────────────────────────

interface CombinationState {
  /** strategyId chosen for each family group (key). Empty = none. */
  readonly selected: Readonly<Record<string, string>>;
  /** name shown in the resulting CompositeStrategy and SearchRun config */
  readonly name: string;
}

const DEFAULT_NAME = "Custom Combination";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CombinationPage() {
  const navigate = useNavigate();

  // Real strategies from /api/strategies
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  // Search inputs
  const [algorithms, setAlgorithms] = useState<SearchAlgorithmItem[]>([]);
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [searchInputsLoading, setSearchInputsLoading] = useState(true);
  const [searchInputsError, setSearchInputsError] = useState<string | null>(
    null,
  );

  const [selectedAlgorithmId, setSelectedAlgorithmId] = useState<string>("");
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("1h");
  const [maxCandidates, setMaxCandidates] = useState<number>(20);

  // Combination state
  const [combination, setCombination] = useState<CombinationState>({
    selected: {},
    name: DEFAULT_NAME,
  });

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── "Save Combination" feedback ─────────────────────────────────────
  const [savingOnly, setSavingOnly] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // ── Load strategies ──
  const loadStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    setStrategiesError(null);
    try {
      const res = await fetchStrategies();
      setStrategies([...res.strategies]);
    } catch (err) {
      setStrategiesError(
        (err as Error).message ?? "Failed to load strategies.",
      );
    } finally {
      setStrategiesLoading(false);
    }
  }, []);

  // ── Load search inputs ──
  const loadSearchInputs = useCallback(async () => {
    setSearchInputsLoading(true);
    setSearchInputsError(null);
    try {
      const [algos, syms] = await Promise.all([
        fetchSearchAlgorithms(),
        fetchSearchSymbols(),
      ]);
      setAlgorithms(algos);
      setSymbols(syms);
      // Pre-select the domain_guided algorithm by code
      const dg = algos.find((a) => a.code === "domain_guided");
      setSelectedAlgorithmId((prev) => prev || dg?.id || algos[0]?.id || "");
      setSelectedSymbolId((prev) => prev || syms[0]?.id || "");
    } catch (err) {
      setSearchInputsError(
        (err as Error).message ?? "Failed to load search inputs.",
      );
    } finally {
      setSearchInputsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStrategies();
    void loadSearchInputs();
  }, [loadStrategies, loadSearchInputs]);

  // ── Group strategies by family (lowercase compare, sentiment → information) ──
  const strategiesByFamily = useMemo(() => {
    const map: Record<string, StrategyListItem[]> = {};
    for (const g of FAMILY_GROUPS) map[g.key] = [];
    for (const s of strategies) {
      const family = (s.family ?? "").toLowerCase();
      const groupKey = family === "sentiment" ? "information" : family;
      if (map[groupKey]) {
        map[groupKey]!.push(s);
      }
    }
    return map;
  }, [strategies]);

  // ── Validation ──
  const requiredMissing = useMemo(
    () =>
      FAMILY_GROUPS.filter((g) => g.required && !combination.selected[g.key]),
    [combination.selected],
  );

  const filledCount = useMemo(
    () => FAMILY_GROUPS.filter((g) => combination.selected[g.key]).length,
    [combination.selected],
  );

  const totalLegalslots = useMemo(() => {
    const n = filledCount;
    if (n < 2) return 0;
    // Number of valid k-subsets where k ∈ [2, n]
    let total = 0;
    for (let k = 2; k <= n; k++) {
      let c = 1;
      for (let i = 1; i <= k; i++) c = (c * (n - i + 1)) / i;
      total += c;
    }
    return total;
  }, [filledCount]);

  const isValid = requiredMissing.length === 0;

  // ── Mutations ──
  const setSelection = (familyKey: string, strategyId: string) => {
    setCombination((prev) => ({
      ...prev,
      selected: { ...prev.selected, [familyKey]: strategyId },
    }));
  };

  const clearGroup = (familyKey: string) => {
    setCombination((prev) => {
      const next = { ...prev.selected };
      delete next[familyKey];
      return { ...prev, selected: next };
    });
  };

  const clearAll = () => {
    setCombination({ selected: {}, name: DEFAULT_NAME });
  };

  // ── Build a CombinationRequest from the current state ──
  function buildCombinationPayload(): {
    filledGroups: typeof FAMILY_GROUPS;
    components: Array<{ strategyId: string; weight: number; position: number }>;
    algorithmCode: string;
    name: string;
  } {
    const algorithmCode =
      algorithms.find((a) => a.id === selectedAlgorithmId)?.code ??
      "domain_guided";
    const filledGroups = FAMILY_GROUPS.filter(
      (g) => combination.selected[g.key],
    );
    const components = filledGroups.map((g, idx) => ({
      strategyId: combination.selected[g.key]!,
      weight: 1 / filledGroups.length,
      position: idx,
    }));
    return {
      filledGroups,
      components,
      algorithmCode,
      name: combination.name.trim() || DEFAULT_NAME,
    };
  }

  /**
   * Persist the current combination to saved_combinations. Returns the
   * saved record (or null on failure). Used both by the dedicated
   * "Save Combination" button and as the first step of Run Combination.
   */
  async function persistCombination(): Promise<{
    id: string;
    name: string;
    filledGroups: typeof FAMILY_GROUPS;
    components: Array<{ strategyId: string; weight: number; position: number }>;
    algorithmCode: string;
  } | null> {
    const payload = buildCombinationPayload();
    const saved = await saveCombination({
      name: payload.name,
      operator: "WEIGHTED",
      components: payload.components,
      tags: ["composite", payload.algorithmCode],
      ownerId: "combination-builder",
    });
    return { ...payload, id: saved.id, name: saved.name };
  }

  // ── "Save Combination" only — no search, no navigation ──
  async function handleSaveOnly() {
    setSaveError(null);
    setSubmitError(null);
    if (!isValid) {
      setSaveError(
        `Composite chưa đủ nhóm bắt buộc: ${requiredMissing
          .map((g) => g.label)
          .join(", ")}.`,
      );
      return;
    }
    setSavingOnly(true);
    try {
      const saved = await persistCombination();
      if (!saved) throw new Error("Failed to save combination.");
      setLastSaved({ id: saved.id, name: saved.name });
    } catch (err) {
      setSaveError((err as Error).message ?? "Failed to save combination.");
    } finally {
      setSavingOnly(false);
    }
  }

  // ── Submit (Run Combination) ──
  async function handleSubmit() {
    setSubmitError(null);
    if (!isValid) {
      setSubmitError(
        `Composite chưa đủ nhóm bắt buộc: ${requiredMissing
          .map((g) => g.label)
          .join(", ")}.`,
      );
      return;
    }
    if (!selectedAlgorithmId || !selectedSymbolId) {
      setSubmitError("Vui lòng chọn thuật toán và symbol.");
      return;
    }
    setSubmitting(true);
    try {
      // ── Step 1: Save the combination to saved_combinations ──────────
      const saved = await persistCombination();
      if (!saved) throw new Error("Failed to save combination.");

      // ── Step 2: Build generatorConfig based on algorithm ─────────────
      // Domain-guided uses the new subset-enumeration mode with min/max
      // component counts so it can generate multiple diverse composite
      // candidates (e.g. MA+RSI, MA+RSI+BB, MA+RSI+BB+SR, ...).
      //
      // IMPORTANT: `requiredFamilies` is the official Module 6 §17.2 domain
      // rule (TREND + MOMENTUM + STRUCTURE), NOT the user's filled
      // selection. Sending the user's filled selection here would force
      // every composite to contain ALL filled families (effectively a
      // single 4-strategy candidate when all 4 are filled).
      //
      // `domainMode: "GUIDED"` tells the backend to keep `requiredFamilies`
      // as a *preference* (rank domain-valid composites first) instead of a
      // hard filter, so 2-strategy / 3-strategy combinations are also
      // emitted alongside the 3-strategy and 4-strategy domain-valid ones.

      const selectedFamilies = saved.filledGroups.map((g) =>
        g.key === "information" ? "SENTIMENT" : g.key.toUpperCase()
      );

      const generatorConfig =
        saved.algorithmCode === "domain_guided"
          ? {
              minComponents: 2,
              maxComponents: Math.max(2, saved.filledGroups.length),
              requiredFamilies: selectedFamilies,
              domainMode: "GUIDED" as const,
              mode: "EXHAUSTIVE" as const,
              combinationId: saved.id,
              // familyGroups retained for backward-compatible consumers
              familyGroups: saved.filledGroups.map((g) => ({
                name: g.key,
                families: [
                  g.key === "information" ? "SENTIMENT" : g.key.toUpperCase(),
                ],
              })),
            }
          : {
              compositeMode: "COMPOSITE" as const,
              minComponents: 2,
              maxComponents: Math.max(2, saved.filledGroups.length),
              combinationId: saved.id,
            };

      // ── Step 3: Start the search ───────────────────────────────────
      const result = await startSearch({
        algorithmId: selectedAlgorithmId,
        algorithm: saved.algorithmCode,
        symbolId: selectedSymbolId,
        timeframe,
        maxCandidates: Math.max(1, maxCandidates),
        generatorConfig,
        createdBy: "combination-builder",
      });

      // ── Step 4: Auto-start the Continuous Strategy Loop ─────────────
      // The team has decided that "Run Combination" must automatically
      // start the Continuous Strategy Loop. The Loop is the source of
      // truth for next-candidate generation once `NewTopStrategyFound`
      // fires from the Leaderboard. We pass a deterministic loopId
      // (derived from the SearchRun id) so multiple concurrent Run
      // Combination actions can each have their own loop instance and
      // the Search page can navigate to /loop?loopId=… without guessing.
      //
      // The INITIAL iteration of the loop is the SearchRun we just
      // created (no new SearchRun is started for iteration #1). We
      // forward `initialSearchRunId` so the runner registers iteration
      // #1 correctly. The parent StrategyVersion is updated AFTER
      // evaluation completes (the runner sets it from the best
      // candidate of the iteration). For the schema FK constraint we
      // still need a valid UUID placeholder — we resolve the first
      // strategyVersionId produced by the search.
      let startedLoop: LoopStatusResponse | null = null;
      let loopStartError: string | null = null;
      try {
        const initialParentId = await resolveInitialParentId(result.searchRunId);
        startedLoop = await startLoop({
          loopId: `combo-${result.searchRunId}`,
          maxCandidates: Math.max(10, maxCandidates * 5),
          maxIterations: 20,
          candidateCountPerIteration: 5,
          timeLimitSeconds: 1800,
          noImprovementCap: 25,
          initialSearchRunId: result.searchRunId,
          parentStrategyVersionId: initialParentId,
        });
      } catch (err) {
        loopStartError =
          (err as Error).message ?? "Failed to auto-start Continuous Loop.";
        // Non-fatal: continue without a Loop so the user can still see
        // the SearchRun results. The dedicated /loop page will reflect
        // the missing loop correctly.
      }

      // Navigate to the live search page so the user can watch
      // candidates populate and run Backtest on each one. The loopId is
      // forwarded via router state so Search.tsx can render the
      // Continuous Loop status card and expose the "View Continuous
      // Loop" button.
      navigate(`/search/${encodeURIComponent(result.searchRunId)}`, {
        state: {
          startResponse: result,
          combinationId: saved.id,
          combinationName: saved.name,
          // Persist the real loopId from the backend response (never
          // invent one in React). Falls back to the deterministic
          // combo-<searchRunId> derived id so the Search page can still
          // surface the loop card and "View Continuous Loop" button
          // even if the backend response was unexpectedly minimal.
          loopId: startedLoop?.loopId ?? `combo-${result.searchRunId}`,
          loopStartError,
        },
      });
    } catch (err) {
      setSubmitError(
        (err as Error).message ?? "Failed to start combination search.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      <Header
        filled={filledCount}
        total={FAMILY_GROUPS.length}
        onBack={() => navigate("/strategy")}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ─── Left: Family group pickers ────────────────────────────── */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          {strategiesError && <Banner kind="error" message={strategiesError} />}
          {searchInputsError && (
            <Banner kind="error" message={searchInputsError} />
          )}

          {/* Domain rules card */}
          <article className="bg-gradient-to-br from-blue-50/60 to-indigo-50/40 border border-blue-100/60 p-5 rounded-2xl flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Workflow className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-extrabold text-slate-800">
                Combination Rules (Module 6 §17.2)
              </h3>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Một composite strategy <span className="font-bold">bắt buộc</span>{" "}
              phải có:
              <span className="font-extrabold text-blue-700"> ≥1 Trend</span>,
              <span className="font-extrabold text-purple-700">
                {" "}
                ≥1 Momentum
              </span>
              ,
              <span className="font-extrabold text-amber-700">
                {" "}
                ≥1 Structure
              </span>
              . Hai nhóm{" "}
              <span className="font-extrabold text-emerald-700">
                Volatility
              </span>{" "}
              và
              <span className="font-extrabold text-rose-700">
                {" "}
                Information
              </span>{" "}
              là tùy chọn nhưng được khuyến khích.
            </p>
          </article>

          {/* Group list */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-500" />
                <span>Family Groups</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ml-1">
                  {filledCount}/{FAMILY_GROUPS.length}
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearAll}
                  disabled={filledCount === 0}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-50"
                >
                  Clear all
                </button>
                <button
                  onClick={() => void loadStrategies()}
                  disabled={strategiesLoading}
                  className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${strategiesLoading ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
            </div>

            {strategiesLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-semibold">
                  Đang tải strategies...
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {FAMILY_GROUPS.map((g) => (
                  <FamilyGroupPicker
                    key={g.key}
                    group={g}
                    strategies={strategiesByFamily[g.key] ?? []}
                    selectedStrategyId={combination.selected[g.key]}
                    onSelect={(id) => setSelection(g.key, id)}
                    onClear={() => clearGroup(g.key)}
                  />
                ))}
              </div>
            )}

            {/* Validation hint */}
            {requiredMissing.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-[11px] text-amber-700 font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Thiếu nhóm bắt buộc:
                  <span className="font-extrabold ml-1">
                    {requiredMissing.map((g) => g.label).join(", ")}
                  </span>
                </span>
              </div>
            )}
          </article>
        </div>

        {/* ─── Right: Combination preview + Submit ─────────────────── */}
        <aside className="xl:col-span-1 flex flex-col gap-6">
          {/* Combination name */}
          <article className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-3">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span>Combination</span>
            </h3>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Composite name
              </label>
              <input
                type="text"
                value={combination.name}
                onChange={(e) =>
                  setCombination((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder={DEFAULT_NAME}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
              />
            </div>

            {/* Selected components preview */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Components ({filledCount}/{FAMILY_GROUPS.length})
              </span>

              {filledCount === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center text-[11px] text-slate-400 font-semibold">
                  Chưa chọn strategy nào.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {FAMILY_GROUPS.filter((g) => combination.selected[g.key]).map(
                    (g) => {
                      const sid = combination.selected[g.key]!;
                      const s = strategies.find((x) => x.id === sid);
                      const Icon = g.icon;
                      return (
                        <div
                          key={g.key}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${accentBg(g.accent)}`}
                        >
                          <Icon
                            className={`w-3.5 h-3.5 ${accentText(g.accent)} shrink-0`}
                          />
                          <span
                            className={`text-[10px] font-extrabold uppercase tracking-wider ${accentText(g.accent)}`}
                          >
                            {g.label}
                          </span>
                          <ChevronRight
                            className={`w-3 h-3 ${accentText(g.accent)} opacity-40`}
                          />
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {s?.name ?? sid}
                          </span>
                          <Check className="w-3.5 h-3.5 text-emerald-500 ml-auto shrink-0" />
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400 font-semibold pt-2 border-t border-slate-100">
              Backend sẽ sinh{" "}
              <span className="font-extrabold text-slate-700">
                {totalLegalslots.toLocaleString("vi-VN")}
              </span>{" "}
              tổ hợp hợp lệ (mỗi nhóm lấy 1 strategy), giới hạn bởi{" "}
              <span className="font-mono">maxCandidates</span> bên dưới.
            </div>
          </article>

          {/* Discovery config */}
          <article className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-4 sticky top-6">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-blue-500" />
              <span>Search Config</span>
            </h3>

            {/* Algorithm — domain_guided recommended for combination */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Algorithm
              </label>
              <select
                value={selectedAlgorithmId}
                onChange={(e) => setSelectedAlgorithmId(e.target.value)}
                disabled={searchInputsLoading}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                {algorithms.length === 0 ? (
                  <option value="">
                    {searchInputsLoading ? "Loading…" : "No algorithms"}
                  </option>
                ) : (
                  algorithms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.code})
                    </option>
                  ))
                )}
              </select>
              {(() => {
                const sel = algorithms.find(
                  (a) => a.id === selectedAlgorithmId,
                );
                if (sel && sel.code === "random") {
                  return (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 text-[10px] text-amber-700 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Random search ignores family groups — it samples
                      strategies freely.
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Symbol */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Symbol
              </label>
              <select
                value={selectedSymbolId}
                onChange={(e) => setSelectedSymbolId(e.target.value)}
                disabled={searchInputsLoading}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                {symbols.length === 0 ? (
                  <option value="">
                    {searchInputsLoading ? "Loading…" : "No symbols"}
                  </option>
                ) : (
                  symbols.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.symbol} ({s.baseAsset}/{s.quoteAsset})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Timeframe */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Timeframe
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors cursor-pointer"
              >
                {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>

            {/* Max candidates */}
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
                  setMaxCandidates(
                    isNaN(v) ? 1 : Math.max(1, Math.min(10000, v)),
                  );
                }}
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
              />
              <p className="text-[10px] text-slate-400">
                1 – 10000 (backend limit)
              </p>
            </div>

            {/* Submit */}
            {submitError && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] text-red-700 font-semibold flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <button
              onClick={() => void handleSubmit()}
              disabled={
                !isValid || submitting || searchInputsLoading || savingOnly
              }
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-extrabold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Đang submit…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Run Combination
                </>
              )}
            </button>

            {/* Save-only (without starting a search) */}
            <button
              onClick={() => void handleSaveOnly()}
              disabled={
                !isValid || submitting || savingOnly || searchInputsLoading
              }
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-700 text-xs font-extrabold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingOnly ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Đang lưu…
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save Combination
                </>
              )}
            </button>

            {saveError && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] text-red-700 font-semibold flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {lastSaved && !saveError && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-[11px] text-emerald-700 font-semibold flex items-start gap-1.5">
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span>
                    Đã lưu combination{" "}
                    <span className="font-extrabold">"{lastSaved.name}"</span>.
                  </span>
                  <span className="font-mono text-[10px] text-emerald-600/80">
                    id: {lastSaved.id}
                  </span>
                </div>
              </div>
            )}

            <div className="text-[10px] text-slate-400 font-medium leading-relaxed pt-2 border-t border-slate-100">
              <strong>Run Combination</strong> lưu vào database, tạo SearchRun,
              rồi chuyển sang
              <span className="font-mono font-bold"> /search/:id</span>.
              <strong> Save Combination</strong> chỉ lưu vào database (không
              chạy search). Với{" "}
              <span className="font-mono font-bold">domain_guided</span> thì
              truyền familyGroups, với{" "}
              <span className="font-mono font-bold">random</span> thì không.
            </div>
          </article>
        </aside>
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  filled,
  total,
  onBack,
}: {
  filled: number;
  total: number;
  onBack: () => void;
}) {
  return (
    <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors"
          title="Back to Strategy"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Strategy Combination Builder
          </h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Chọn một strategy cho mỗi nhóm chỉ báo (Trend / Momentum / Structure
            / …) và chạy Domain-guided Search.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-[10px] font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
            filled === total
              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
              : filled > 0
                ? "bg-blue-50 text-blue-700 border-blue-100"
                : "bg-slate-50 text-slate-500 border-slate-100"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          {filled}/{total} groups filled
        </span>
      </div>
    </header>
  );
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function Banner({
  kind,
  message,
}: {
  kind: "error" | "info";
  message: string;
}) {
  const cls =
    kind === "error"
      ? "bg-red-50 border-red-100 text-red-700"
      : "bg-blue-50 border-blue-100 text-blue-700";
  return (
    <div
      className={`flex gap-2 items-start rounded-xl p-3 text-[11px] font-semibold border ${cls}`}
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ─── Family Group Picker ─────────────────────────────────────────────────────

interface FamilyGroupPickerProps {
  group: FamilyGroupDef;
  strategies: ReadonlyArray<StrategyListItem>;
  selectedStrategyId: string | undefined;
  onSelect: (strategyId: string) => void;
  onClear: () => void;
}

function FamilyGroupPicker({
  group,
  strategies,
  selectedStrategyId,
  onSelect,
  onClear,
}: FamilyGroupPickerProps) {
  const Icon = group.icon;
  const selected = strategies.find((s) => s.id === selectedStrategyId);

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 transition-all ${
        selectedStrategyId
          ? `${accentBorder(group.accent)} ${accentBg(group.accent)}`
          : "border-slate-100 bg-slate-50/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center border ${accentIconBg(group.accent)}`}
          >
            <Icon className={`w-4 h-4 ${accentText(group.accent)}`} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold text-slate-800">
                {group.label}
              </span>
              {group.required ? (
                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-100">
                  Required
                </span>
              ) : (
                <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-100">
                  Optional
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-500 font-medium mt-0.5">
              {group.description}
            </span>
          </div>
        </div>

        {selectedStrategyId && (
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-slate-400 hover:text-slate-700 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Strategy list */}
      {strategies.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-lg px-3 py-3 text-center text-[11px] text-slate-400 font-semibold">
          Chưa có strategy thuộc family{" "}
          <span className="font-mono">{group.key}</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {strategies.map((s) => {
            const active = s.id === selectedStrategyId;
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`text-left p-2.5 rounded-lg border transition-all flex items-center gap-2 ${
                  active
                    ? `${accentActiveBorder(group.accent)} bg-white shadow-sm`
                    : "border-slate-100 bg-white hover:border-slate-200"
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-md font-bold text-[10px] flex items-center justify-center border shrink-0 ${
                    active
                      ? accentActiveBadge(group.accent)
                      : "bg-slate-50 text-slate-500 border-slate-100"
                  }`}
                >
                  {initials(s.name)}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-extrabold text-slate-800 truncate">
                    {s.name}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono truncate">
                    {s.id}
                  </span>
                </div>
                {active && (
                  <Check
                    className={`w-3.5 h-3.5 ml-auto ${accentText(group.accent)}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="text-[10px] text-slate-500 font-semibold pt-2 border-t border-white/40">
          ✓ Đã chọn{" "}
          <span className="font-extrabold text-slate-700">{selected.name}</span>
        </div>
      )}
    </div>
  );
}

// ─── Tailwind accent helpers ─────────────────────────────────────────────────

const AccentValues = ["blue", "purple", "emerald", "amber", "rose"] as const;
type Accent = (typeof AccentValues)[number];

function accentBg(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "bg-blue-50/60",
    purple: "bg-purple-50/60",
    emerald: "bg-emerald-50/60",
    amber: "bg-amber-50/60",
    rose: "bg-rose-50/60",
  };
  return map[a];
}

function accentBorder(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "border-blue-200",
    purple: "border-purple-200",
    emerald: "border-emerald-200",
    amber: "border-amber-200",
    rose: "border-rose-200",
  };
  return map[a];
}

function accentActiveBorder(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "border-blue-500",
    purple: "border-purple-500",
    emerald: "border-emerald-500",
    amber: "border-amber-500",
    rose: "border-rose-500",
  };
  return map[a];
}

function accentText(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "text-blue-600",
    purple: "text-purple-600",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
  };
  return map[a];
}

function accentIconBg(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "bg-blue-50 border-blue-100",
    purple: "bg-purple-50 border-purple-100",
    emerald: "bg-emerald-50 border-emerald-100",
    amber: "bg-amber-50 border-amber-100",
    rose: "bg-rose-50 border-rose-100",
  };
  return map[a];
}

function accentActiveBadge(a: Accent): string {
  const map: Record<Accent, string> = {
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200",
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    rose: "bg-rose-100 text-rose-700 border-rose-200",
  };
  return map[a];
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 3).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}
