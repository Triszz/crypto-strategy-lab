/**
 * Loop — Continuous Strategy Loop monitoring + control UI.
 *
 * Phase 3 — Correctness
 * ----------------------
 * - Reads loopId ONLY from `?loopId=...` URL param. No fallback to "main".
 *   Direct navigation to `/loop` (no param) shows "No Loop Selected".
 * - All metrics come from the backend loop state (loop-local best, not global leaderboard).
 * - Separate counters:
 *     cumulative candidates  = totalEvaluated  (across all iterations)
 *     current-iteration     = currentIterationCandidateCount / candidateCountPerIteration
 *     current-iteration ev = currentIterationEvaluatedCount / candidateCountPerIteration
 * - Candidate history grouped by iteration via GET /api/loop/candidates.
 * - Iteration-level stop conditions (MAX_ITERATIONS, MAX_CANDIDATES, TIMEOUT, NO_IMPROVEMENT, MANUAL).
 *
 * This page does NOT modify Backtest.tsx, the Leaderboard UI, or Evaluation.
 * All loop mechanics live in the backend LoopOrchestratorRunner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  Play,
  Pause,
  RotateCcw,
  Square,
  AlertCircle,
  Loader2,
  RefreshCw,
  History,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  startLoop,
  pauseLoop,
  resumeLoop,
  stopLoop,
  getLoopStatus,
  getLoopProgress,
  getLoopCandidates,
  listLoops,
  getActiveLoop,
  setActiveLoop as setActiveLoopApi,
  clearActiveLoop as clearActiveLoopApi,
  type LoopProgressResponse,
  type LoopStatusResponse,
  type LoopIterationData,
  type LoopListItem,
  type StartLoopInput,
} from "../services/loopApi";

import LeaderboardCard from "../components/LeaderboardCard";

const POLL_INTERVAL_MS = 3000;

/* ── Formatters ─────────────────────────────────────────────────────────── */

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "00:00:00";
  const hh = Math.floor(s / 3600).toString().padStart(2, "0");
  const mm = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "RUNNING":
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "PAUSED":
      return "bg-amber-50 text-amber-700 border border-amber-200";
    case "STOPPED_MAX_CANDIDATES":
    case "STOPPED_TIMEOUT":
    case "STOPPED_NO_IMPROVEMENT":
    case "STOPPED_MAX_ITERATIONS":
    case "STOPPED_MANUAL":
    case "STOPPED":
      return "bg-slate-100 text-slate-700 border border-slate-300";
    default:
      return "bg-slate-100 text-slate-600 border border-slate-200";
  }
}

function stopReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "STOPPED_MAX_CANDIDATES":  return "Max candidates reached";
    case "STOPPED_TIMEOUT":         return "Time limit reached";
    case "STOPPED_NO_IMPROVEMENT":  return "No-improvement limit reached";
    case "STOPPED_MAX_ITERATIONS":  return "Max iterations reached";
    case "STOPPED_MANUAL":          return "Manually stopped";
    case null:
    case undefined:
    case "":                        return "—";
    default:                        return reason;
  }
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function scoreDisplay(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return score.toFixed(2);
}

/* ── Strategy name helper ────────────────────────────────────────────────── */

function bestStrategyDisplayName(s: Pick<LoopStatusResponse,
  "bestStrategyName" | "bestStrategyVersionId"
>): string {
  const name = s.bestStrategyName?.trim();
  if (name) return name;
  if (s.bestStrategyVersionId) return s.bestStrategyVersionId.slice(0, 8) + "…";
  return "(none yet)";
}

function bestStrategyContext(s: Pick<LoopStatusResponse,
  "bestStrategySymbolCode" | "bestStrategyTimeframe"
>): string {
  const parts: string[] = [];
  if (s.bestStrategySymbolCode) parts.push(s.bestStrategySymbolCode);
  if (s.bestStrategyTimeframe) parts.push(s.bestStrategyTimeframe);
  return parts.join(" · ");
}

/* ── Candidate history row ─────────────────────────────────────────────── */

function CandidateRow({ c }: { c: LoopIterationData["candidates"][number] }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-0.5 px-4 py-1.5 hover:bg-slate-50 rounded-lg transition-colors text-xs">
      <span className="font-medium text-slate-700 truncate" title={c.strategyName}>
        {c.strategyName}
      </span>
      <span className="text-slate-400 font-mono text-right w-16">
        {c.strategyType === "COMPOSITE" ? "COMPOSITE" : "BASE"}
      </span>
      <span className="text-slate-400 font-mono text-right w-16">
        {scoreDisplay(c.overallScore)}
      </span>
      <span className="text-slate-400 text-right w-20">
        {formatSignedPercent(c.totalReturn)}
      </span>
      <span className="text-slate-400 text-right w-16">
        {formatPercent(c.winRate)}
      </span>
    </div>
  );
}

/* ── Iteration section ─────────────────────────────────────────────────── */

function IterationSection({
  iter,
  isExpanded,
  onToggle,
}: {
  iter: LoopIterationData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const best = iter.candidates.reduce<typeof iter.candidates[number] | null>(
    (prev, c) =>
      !prev || (c.overallScore ?? -Infinity) > (prev.overallScore ?? -Infinity) ? c : prev,
    null,
  );
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        )}
        <span className="text-xs font-extrabold text-slate-700">
          Iteration {iter.iterationIndex}
        </span>
        <span className="text-xs text-slate-400">
          {iter.candidateCount} candidates · {iter.evaluatedCount} evaluated
        </span>
        {iter.bestScoreInIteration > 0 && (
          <span className="ml-auto text-xs font-mono text-slate-500">
            best&nbsp;
            <span className="font-bold text-slate-700">{scoreDisplay(iter.bestScoreInIteration)}</span>
          </span>
        )}
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            iter.status === "RUNNING"
              ? "bg-blue-50 text-blue-600 border-blue-200"
              : "bg-slate-100 text-slate-500 border-slate-200"
          }`}
        >
          {iter.status}
        </span>
      </button>

      {/* Expanded candidate list */}
      {isExpanded && (
        <div className="border-t border-slate-100">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-0.5 px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-50">
            <span>Strategy</span>
            <span className="text-right w-16">Type</span>
            <span className="text-right w-16">Score</span>
            <span className="text-right w-20">Return</span>
            <span className="text-right w-16">Win Rate</span>
          </div>
          {iter.candidates.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 italic">No candidates yet.</p>
          ) : (
            iter.candidates.map((c) => <CandidateRow key={c.id} c={c} />)
          )}
          {best && best.overallScore !== null && (
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-t border-emerald-100 text-xs">
              <span className="text-emerald-600 font-bold">★ Best:</span>
              <span className="text-emerald-700">{best.strategyName}</span>
              <span className="text-emerald-600 font-mono ml-auto">
                Score {scoreDisplay(best.overallScore)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function Loop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const loopIdFromUrl = searchParams.get("loopId");

  // NO fallback to "main" — if no URL param, show "No Loop Selected" state
  // and let the active-loop discovery effect either auto-restore the
  // followed loop (via the explicit LoopActivePointer) or render the
  // today's-history list.
  const [loopId, setLoopId] = useState<string>(loopIdFromUrl ?? "");

  useEffect(() => {
    if (loopIdFromUrl) setLoopId(loopIdFromUrl);
  }, [loopIdFromUrl]);

  const [status, setStatus] = useState<LoopStatusResponse | null>(null);
  const [, setProgress] = useState<LoopProgressResponse | null>(null);
  const [iterations, setIterations] = useState<LoopIterationData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedIters, setExpandedIters] = useState<Set<number>>(new Set([1]));

  const previousBestRef = useRef<number | null>(null);
  const [newTopFlash, setNewTopFlash] = useState<string | null>(null);

  // Phase 3.4 — FIX D: a single guarded helper for the active-loop
  // pointer API. Wrapping these calls keeps a network failure or a
  // torn-down import from ever surfacing as an
  //   "Cannot read properties of undefined (reading 'catch')"
  // runtime error. The import is also aliased (`setActiveLoopApi`,
  // `clearActiveLoopApi`) above so the state setter `setActiveLoop`
  // is not shadowed by the API function of the same name.
  const safelyPersistActiveLoop = useCallback(async (id: string) => {
    try {
      const p = setActiveLoopApi(id);
      if (p && typeof (p as Promise<unknown>).then === "function") {
        await (p as Promise<unknown>);
      }
    } catch (err) {
      // Non-fatal: the active pointer is a soft signal used only
      // for auto-restore. Log but never unhandled-throw.
      console.warn("[Loop] safelyPersistActiveLoop failed:", err);
    }
  }, []);
  const safelyClearActiveLoop = useCallback(async () => {
    try {
      const p = clearActiveLoopApi();
      if (p && typeof (p as Promise<unknown>).then === "function") {
        await (p as Promise<unknown>);
      }
    } catch (err) {
      console.warn("[Loop] safelyClearActiveLoop failed:", err);
    }
  }, []);

  // Phase 3.3: active-loop discovery + today's-history support.
  const [activeLoop, setActiveLoop] = useState<{
    loopId: string;
    status: string;
  } | null>(null);
  const [todaysLoops, setTodaysLoops] = useState<LoopListItem[]>([]);
  const [activeResolved, setActiveResolved] = useState(false);
  const [historyResolved, setHistoryResolved] = useState(false);

  // On mount, if no loopId in URL, ask the backend for the active loop
  // and auto-navigate to it. This is the "restoration after navigation"
  // path. We only navigate when the URL genuinely lacks the param so
  // existing direct-URL links keep their precedence.
  useEffect(() => {
    if (loopIdFromUrl) {
      // Direct URL: also persist as active pointer so refresh restores it.
      void safelyPersistActiveLoop(loopIdFromUrl);
      setActiveResolved(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const active = await getActiveLoop();
        if (cancelled) return;
        // `active` is the response payload (loopId+status); assign
        // it to the state setter `setActiveLoop`. This is NOT the
        // API service — that import is aliased to `setActiveLoopApi`
        // and is never called here.
        setActiveLoop(active);
        if (active?.loopId) {
          // Auto-restore: rewrite the URL so the rest of the page picks
          // it up uniformly. We use replace() so the user's back button
          // doesn't get an extra history entry.
          setSearchParams({ loopId: active.loopId }, { replace: true });
          setLoopId(active.loopId);
        }
      } catch {
        // No active loop — fall through to history view.
      } finally {
        if (!cancelled) setActiveResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally only run this once on mount: changing loopIdFromUrl
    // afterwards is handled by the regular useEffect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (!loopId) return;
    try {
      const [s, p, iters] = await Promise.all([
        getLoopStatus(loopId),
        getLoopProgress(loopId),
        getLoopCandidates(loopId),
      ]);
      setStatus(s);
      setProgress(p);
      setIterations(iters);
      setError(null);
      if (p && p.bestScore !== null) {
        const newBest = p.bestScore;
        if (
          previousBestRef.current !== null &&
          newBest > previousBestRef.current
        ) {
          setNewTopFlash(`New Top-1 score: ${newBest.toFixed(2)}`);
          window.setTimeout(() => setNewTopFlash(null), 4000);
        }
        previousBestRef.current = newBest;
      }
    } catch (err) {
      const msg = (err as Error).message ?? "Failed to load loop state";
      if (msg.includes("NOT_FOUND")) {
        setStatus(null);
        setIterations([]);
        setError(null);
      } else {
        setError(msg);
      }
    }
  }, [loopId]);

  // Phase 3.3 / 3.4: refresh today's loop history. The backend
  // accepts an optional `tzOffsetMinutes`; we send the user's local
  // offset so "today" matches the user's calendar day.
  const refreshHistory = useCallback(async () => {
    try {
      const rows = await listLoops({
        today: true,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      setTodaysLoops(rows);
      setHistoryResolved(true);
    } catch {
      setTodaysLoops([]);
      setHistoryResolved(true);
    }
  }, []);

  // Initial history load.
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Poll while the selected loop is RUNNING or while we don't yet know
  // its status (initial mount / navigated to URL mid-iteration).
  //
  // Phase 3.2 — fixed: the previous effect depended on
  // `status?.status`, which could re-create the interval right when
  // an iteration transition briefly looked "stopped". The polling
  // now keys ONLY on `loopId` + the loop's RUNNING-ness. We poll on a
  // fixed cadence regardless of which iteration is in flight, and
  // stop polling only when the loop is in a terminal state.
  useEffect(() => {
    if (!loopId) return;
    void refresh();
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loopId, refresh]);

  // Form inputs.
  const [maxIterations, setMaxIterations] = useState(20);
  const [maxCandidates, setMaxCandidates] = useState(100);
  const [candidateCountPerIteration, setCandidateCountPerIteration] = useState(5);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(3600);
  const [noImprovementCap, setNoImprovementCap] = useState(50);
  const [mutationRatio, setMutationRatio] = useState(0.4);
  const [crossoverRatio, setCrossoverRatio] = useState(0.2);
  const [explorationRatio, setExplorationRatio] = useState(0.4);
  const [elitePoolSize, setElitePoolSize] = useState(3);

  const handleStart = async () => {
    if (!loopId.trim()) {
      setError("Please enter a Loop ID first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: StartLoopInput = {
        loopId,
        maxIterations,
        maxCandidates,
        candidateCountPerIteration,
        timeLimitSeconds,
        noImprovementCap,
        mutationRatio,
        crossoverRatio,
        explorationRatio,
        elitePoolSize,
      };
      const res = await startLoop(input);
      setStatus(res);
      // Persist as the user's active loop so refresh restores it.
      await safelyPersistActiveLoop(loopId);
      await refresh();
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message ?? "Failed to start loop");
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await pauseLoop(loopId);
      setStatus(res);
    } catch (err) {
      setError((err as Error).message ?? "Failed to pause loop");
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await resumeLoop(loopId);
      setStatus(res);
    } catch (err) {
      setError((err as Error).message ?? "Failed to resume loop");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await stopLoop(loopId);
      setStatus(res);
      // Phase 3.3: clear the active pointer so the next auto-restore
      // doesn't land on a stopped loop. The loop is still reachable via
      // Today's Loop History (which works for both RUNNING and STOPPED).
      await safelyClearActiveLoop();
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message ?? "Failed to stop loop");
    } finally {
      setBusy(false);
    }
  };

  const loopStatus = status?.status ?? "IDLE";
  const isRunning = loopStatus === "RUNNING";
  const isPaused = loopStatus === "PAUSED";
  const isStopped =
    loopStatus === "STOPPED_MAX_CANDIDATES" ||
    loopStatus === "STOPPED_TIMEOUT" ||
    loopStatus === "STOPPED_NO_IMPROVEMENT" ||
    loopStatus === "STOPPED_MAX_ITERATIONS" ||
    loopStatus === "STOPPED_MANUAL" ||
    loopStatus === "STOPPED";

  const elapsedSeconds = useMemo(() => {
    if (!status) return 0;
    if (loopStatus === "RUNNING") {
      return Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000);
    }
    return status.elapsedSeconds;
  }, [status, loopStatus]);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [isRunning]);

  function toggleIter(idx: number) {
    setExpandedIters((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  /* ── No Loop Selected state ─────────────────────────────────────── */
  // Section is shown when the URL has no loopId AND the active-loop
  // discovery has finished AND no loop has been auto-restored.
  if (!loopIdFromUrl && !status && activeResolved) {
    const openLoop = (id: string) => {
      setSearchParams({ loopId: id }, { replace: true });
      setLoopId(id);
    };
    return (
      <div className="p-6 flex flex-col gap-6 max-w-[1100px] mx-auto w-full">
        <div className="flex flex-col items-center gap-3 text-center">
          <Activity className="w-12 h-12 text-slate-300" />
          <h2 className="text-lg font-extrabold text-slate-700">Continuous Strategy Loop</h2>
          <p className="text-sm text-slate-400 max-w-[560px]">
            {activeLoop
              ? `Continuing active loop ${activeLoop.loopId} (status: ${activeLoop.status}). This loop was started earlier — opening /loop does not start a new one.`
              : "No active loop is being followed. Start a new loop, or pick one from today's history below."}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-4">
            <h3 className="text-sm font-extrabold text-slate-700 flex items-center gap-1.5">
              <Play className="w-4 h-4 text-blue-500" />
              Start a New Loop
            </h3>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loop ID</span>
              <input
                type="text"
                value={loopId}
                onChange={(e) => setLoopId(e.target.value)}
                placeholder="e.g. combo-abc123 or my-loop-1"
                className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Max Iterations" value={maxIterations} min={1} max={1000} onChange={setMaxIterations} />
              <NumberField label="Max Candidates" value={maxCandidates} min={1} max={100000} onChange={setMaxCandidates} />
              <NumberField label="Per Iteration" value={candidateCountPerIteration} min={1} max={100} onChange={setCandidateCountPerIteration} />
              <NumberField label="Time Limit (s)" value={timeLimitSeconds} min={1} max={86400} onChange={setTimeLimitSeconds} />
            </div>
            <button
              onClick={handleStart}
              disabled={busy || !loopId.trim()}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start Loop
            </button>
            {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          </div>
          <TodaysHistoryCard
            loading={!historyResolved}
            rows={todaysLoops}
            onPick={openLoop}
            onRefresh={refreshHistory}
          />
        </div>
      </div>
    );
  }

  /* ── Full Loop page ──────────────────────────────────────────────── */
  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            Continuous Strategy Loop
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Iteration: {status?.currentIteration ?? 0} / {status?.maxIterations ?? 0}&nbsp;&nbsp;·&nbsp;&nbsp;
            Loop ID:{" "}
            <span className="font-mono text-slate-500">{loopId}</span>
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="p-2 rounded-xl border border-slate-100 hover:bg-slate-50 text-slate-500 hover:text-slate-950 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-sm font-semibold">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
          <button className="ml-auto underline text-red-800 font-bold" onClick={() => setError(null)}>Close</button>
        </div>
      )}

      {/* New Top flash */}
      {newTopFlash && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-2xl text-sm font-semibold">
          🎉 {newTopFlash}
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Live Progress */}
          <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <h3 className="text-sm font-extrabold text-slate-800">Live Progress</h3>
              <span className={`px-3 py-1 rounded-lg text-xs font-black tracking-wider ${statusBadgeClass(loopStatus)}`}>
                {loopStatus}
              </span>
            </div>

            {!status ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">Loading loop state…</span>
              </div>
            ) : (
              <>
                {/* Primary metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricBox
                    label="Iteration"
                    value={`${status.currentIteration} / ${status.maxIterations}`}
                  />
                  <MetricBox
                    label="Candidates Checked"
                    value={`${status.totalEvaluated} / ${status.maxCandidates}`}
                  />
                  <MetricBox
                    label="Current Iteration"
                    value={
                      status.currentIterationCandidateCount > 0
                        ? `${status.currentIterationEvaluatedCount} / ${status.currentIterationCandidateCount}`
                        : "—"
                    }
                    hint="evaluated"
                  />
                  <MetricBox
                    label="Best Score"
                    value={scoreDisplay(status.bestScore)}
                  />
                  <MetricBox
                    label="Best Strategy"
                    value={bestStrategyDisplayName(status)}
                    hint={bestStrategyContext(status) || undefined}
                  />
                  <MetricBox
                    label="Profit / Return"
                    value={formatSignedPercent(status.bestTotalReturn)}
                  />
                  <MetricBox
                    label="Win Rate"
                    value={formatPercent(status.bestWinRate)}
                  />
                  <MetricBox
                    label="Max Drawdown"
                    value={formatPercent(status.bestMaxDrawdown)}
                  />
                  <MetricBox
                    label="No Improvement"
                    value={`${status.noImprovementCount} / ${status.noImprovementCap}`}
                  />
                  <MetricBox
                    label="Elapsed"
                    value={formatSeconds(elapsedSeconds)}
                    hint={`limit ${formatSeconds(status.timeLimitSeconds)}`}
                  />
                  <MetricBox
                    label="Stop Reason"
                    value={stopReasonLabel(status.stopReason)}
                  />
                  <MetricBox
                    label="Status"
                    value={status.stopReason ? stopReasonLabel(status.stopReason) : loopStatus}
                  />
                </div>

                {status.lastIterationSearchRunId && (
                  <p className="text-[11px] text-slate-400 font-mono pt-2 border-t border-slate-100">
                    Last iteration SearchRun:{" "}
                    <span className="text-slate-600">{status.lastIterationSearchRunId}</span>
                  </p>
                )}
              </>
            )}
          </article>

          {/* Candidate History */}
          {status && (
            <article className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-extrabold text-slate-800">Candidate History</h3>
                <span className="ml-auto text-xs text-slate-400">
                  {iterations.length} iteration{iterations.length !== 1 ? "s" : ""}
                </span>
              </div>

              {iterations.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4 text-center">
                  No iterations recorded yet. Candidates appear here after each SearchRun completes.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {iterations.map((iter) => (
                    <IterationSection
                      key={iter.iterationIndex}
                      iter={iter}
                      isExpanded={expandedIters.has(iter.iterationIndex)}
                      onToggle={() => toggleIter(iter.iterationIndex)}
                    />
                  ))}
                </div>
              )}
            </article>
          )}

          {/* Embedded Leaderboard Card */}
          <LeaderboardCard limit={5} title="Leaderboard (Top strategies)" />
        </div>

        {/* Controls sidebar */}
        <aside className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 sticky top-6">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
            <Square className="w-4 h-4 text-blue-500" />
            Controls
          </h3>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loop ID</label>
            <input
              type="text"
              value={loopId}
              onChange={(e) => setLoopId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
              disabled={isRunning}
            />
          </div>

          {/* Limits */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Limits</span>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Max Iterations" value={maxIterations} min={1} max={1000} onChange={setMaxIterations} disabled={isRunning} />
              <NumberField label="Max Candidates" value={maxCandidates} min={1} max={100000} onChange={setMaxCandidates} disabled={isRunning} />
              <NumberField label="Per Iteration" value={candidateCountPerIteration} min={1} max={100} onChange={setCandidateCountPerIteration} disabled={isRunning} />
              <NumberField label="Time Limit (s)" value={timeLimitSeconds} min={1} max={86400} onChange={setTimeLimitSeconds} disabled={isRunning} />
              <NumberField label="No-Imp Cap" value={noImprovementCap} min={1} max={10000} onChange={setNoImprovementCap} disabled={isRunning} />
            </div>
          </div>

          {/* Generation ratios */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Generation Mix (sum = 1)
            </span>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Mutation" value={mutationRatio} min={0} max={1} step={0.1} onChange={setMutationRatio} disabled={isRunning} />
              <NumberField label="Crossover" value={crossoverRatio} min={0} max={1} step={0.1} onChange={setCrossoverRatio} disabled={isRunning} />
              <NumberField label="Exploration" value={explorationRatio} min={0} max={1} step={0.1} onChange={setExplorationRatio} disabled={isRunning} />
            </div>
          </div>

          <NumberField label="Elite Pool Size" value={elitePoolSize} min={1} max={20} onChange={setElitePoolSize} disabled={isRunning} />

          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={handleStart}
              disabled={busy || isRunning}
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Start
            </button>
            <button
              onClick={handlePause}
              disabled={busy || !isRunning}
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
            <button
              onClick={handleResume}
              disabled={busy || !isPaused}
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Resume
            </button>
            <button
              onClick={handleStop}
              disabled={busy || (!isRunning && !isPaused)}
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </div>

          {isStopped && (
            <div className="bg-slate-50 rounded-xl px-3 py-2 text-[10px] text-slate-500 font-semibold">
              <span className="font-bold text-slate-700">Stop reason: </span>
              {stopReasonLabel(status?.stopReason)}
            </div>
          )}
        </aside>

        {/* Phase 3.3: Today's Loop Runs (UTC-bounded by the backend). */}
        <aside className="lg:col-span-3">
          <TodaysHistoryCard
            loading={!historyResolved}
            rows={todaysLoops}
            onPick={(id) => setSearchParams({ loopId: id }, { replace: true })}
            onRefresh={refreshHistory}
          />
        </aside>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────── */

function MetricBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-extrabold text-slate-800 mt-0.5 font-mono leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(isNaN(v) ? min : Math.max(min, Math.min(max, v)));
        }}
        className="w-full px-2 py-1.5 rounded-lg border text-[11px] font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors disabled:opacity-50"
      />
    </div>
  );
}

/* ── Today's Loop History card ──────────────────────────────────────── */

function TodaysHistoryCard({
  loading,
  rows,
  onPick,
  onRefresh,
}: {
  loading: boolean;
  rows: LoopListItem[];
  onPick: (loopId: string) => void;
  onRefresh: () => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    // RUNNING first, then PAUSED, then STOPPED_*, then by updatedAt desc.
    const rank = (s: string) => {
      if (s === "RUNNING") return 0;
      if (s === "PAUSED") return 1;
      return 2;
    };
    const ra = rank(a.status);
    const rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-extrabold text-slate-700">Today's Loop Runs</h3>
        <span className="text-[10px] text-slate-400 ml-1">(your timezone)</span>
        <button
          onClick={onRefresh}
          className="ml-auto p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400 text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-6 text-center">
          No loop runs were created today. Start a new loop to populate this list.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1">
          {sorted.map((row) => (
            <TodaysHistoryRow key={row.id} row={row} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function TodaysHistoryRow({
  row,
  onPick,
}: {
  row: LoopListItem;
  onPick: (loopId: string) => void;
}) {
  const shortId =
    row.loopId.length > 18 ? row.loopId.slice(0, 8) + "…" + row.loopId.slice(-6) : row.loopId;
  const started = new Date(row.startedAt);
  const updated = new Date(row.updatedAt);
  const bestScore = Number(row.bestScoreSoFar);
  return (
    <button
      type="button"
      onClick={() => onPick(row.loopId)}
      className="w-full flex flex-col gap-1.5 p-3 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/40 transition-colors text-left"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-slate-700 truncate">{shortId}</span>
        <span className={`text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusBadgeClass(row.status)}`}>
          {row.status === "RUNNING" || row.status === "PAUSED"
            ? row.status
            : stopReasonLabel(row.status)}
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 ml-auto" />
      </div>
      <div className="flex items-center gap-3 text-[10px] text-slate-500 font-semibold">
        <span>Iter {row.currentIteration}</span>
        <span className="text-slate-300">·</span>
        <span>{row.candidateCount} cands · {row.evaluatedCount} eval</span>
        <span className="text-slate-300">·</span>
        <span>Best {Number.isFinite(bestScore) ? bestScore.toFixed(2) : "—"}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <span>Started {started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="text-slate-300">·</span>
        <span>Updated {updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        {row.stopReason && row.status !== "RUNNING" && row.status !== "PAUSED" && (
          <>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-slate-500">{stopReasonLabel(row.stopReason)}</span>
          </>
        )}
      </div>
    </button>
  );
}
