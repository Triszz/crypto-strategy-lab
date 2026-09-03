/**
 * Loop — Continuous Strategy Loop control + live progress UI.
 *
 * Behaviour
 * ---------
 * - Reads the current loop state from `GET /api/loop/status`.
 * - Reads iteration + best-score progress from `GET /api/loop/progress`.
 * - Polls every 3s while the loop is RUNNING so progress stays fresh
 *   without forcing the user to refresh.
 * - All metrics (iteration, candidates, score, profit, win rate, etc.)
 *   are read from the backend — no values are hardcoded here.
 * - Start / Pause / Resume / Stop buttons call the corresponding
 *   `/api/loop/*` endpoint and refresh the displayed state.
 *
 * Scope notes
 * -----------
 * - This page does NOT modify `Backtest.tsx`, the Leaderboard UI, or
 *   the Evaluation UI — those remain teammates' territory.
 * - The loop's mechanics (stop conditions, candidate generation,
 *   iteration execution) live in the backend `LoopOrchestratorRunner`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Play,
  Pause,
  RotateCcw,
  Square,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  startLoop,
  pauseLoop,
  resumeLoop,
  stopLoop,
  getLoopStatus,
  getLoopProgress,
  type LoopProgressResponse,
  type LoopStatusResponse,
} from "../services/loopApi";

const POLL_INTERVAL_MS = 3000;

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
    case "STOPPED_MANUAL":
    case "STOPPED":
      return "bg-slate-100 text-slate-600 border border-slate-200";
    default:
      return "bg-slate-50 text-slate-500 border border-slate-200";
  }
}

export default function Loop() {
  // Default loop id; the backend auto-creates one if none exists.
  const [loopId, setLoopId] = useState<string>("main");

  const [status, setStatus] = useState<LoopStatusResponse | null>(null);
  const [progress, setProgress] = useState<LoopProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Track previous best score to surface "NEW TOP!" toasts.
  const previousBestRef = useRef<number | null>(null);
  const [newTopFlash, setNewTopFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        getLoopStatus(loopId),
        getLoopProgress(loopId),
      ]);
      setStatus(s);
      setProgress(p);
      setError(null);
      if (p) {
        const newBest = p.bestScoreSoFar;
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
      setError((err as Error).message ?? "Failed to load loop state");
    }
  }, [loopId]);

  // Poll while RUNNING.
  useEffect(() => {
    void refresh();
    if (status?.status !== "RUNNING") return;
    const t = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [status?.status, refresh]);

  // Form inputs.
  const [maxCandidates, setMaxCandidates] = useState<number>(5);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState<number>(300);
  const [noImprovementCap, setNoImprovementCap] = useState<number>(3);

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await startLoop({
        loopId,
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
      });
      setStatus(res);
      await refresh();
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
    loopStatus === "STOPPED_MANUAL" ||
    loopStatus === "STOPPED";

  const elapsedSeconds = useMemo(() => {
    if (!status) return 0;
    if (loopStatus === "RUNNING") {
      return Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000);
    }
    return status.elapsedSeconds;
  }, [status, loopStatus]);
  // Force re-eval every second while running so the elapsed timer ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [isRunning]);

  // ── Render ──────────────────────────────────────────────────────────
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
            Auto-generates new candidates from each new Top-1 strategy found by the Leaderboard.
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
          <button
            className="ml-auto underline text-red-800 font-bold"
            onClick={() => setError(null)}
          >
            Đóng
          </button>
        </div>
      )}

      {/* New Top flash */}
      {newTopFlash && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-2xl text-sm font-semibold">
          <span>🎉 {newTopFlash}</span>
        </div>
      )}

      {/* Main grid: 2/3 = live panel, 1/3 = controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Panel */}
        <article className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-extrabold text-slate-800">Live Progress</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Loop ID: <span className="font-mono">{loopId}</span>
              </p>
            </div>
            <span
              data-testid="loop-status"
              className={`px-3 py-1 rounded-lg text-xs font-black tracking-wider ${statusBadgeClass(loopStatus)}`}
            >
              {loopStatus}
            </span>
          </div>

          {!status ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
              {busy ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Activity className="w-6 h-6" />
              )}
              <span className="text-xs">No loop started yet. Configure the loop and click Start.</span>
            </div>
          ) : (
            <>
              {/* Iteration / candidates / score */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <MetricBox
                  label="Iteration"
                  value={`${status.currentIteration} / ${status.maxIterations}`}
                />
                <MetricBox
                  label="Candidates Checked"
                  value={`${status.totalEvaluated} / ${status.maxCandidates}`}
                />
                <MetricBox
                  label="Best Score"
                  value={status.bestScoreSoFar.toFixed(2)}
                />
                <MetricBox
                  label="No Improvement"
                  value={`${status.noImprovementCount} / ${status.noImprovementCap}`}
                />
                <MetricBox
                  label="Elapsed"
                  value={formatSeconds(elapsedSeconds)}
                />
                <MetricBox
                  label="Time Limit"
                  value={formatSeconds(status.timeLimitSeconds)}
                />
              </div>

              {/* Best strategy reference */}
              <div className="border-t border-slate-100 pt-4 mt-2">
                <h4 className="text-xs font-extrabold text-slate-700 mb-2">Current Best Strategy</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <MetricBox
                    label="Strategy Version"
                    value={
                      status.bestStrategyVersionId
                        ? status.bestStrategyVersionId.slice(0, 8) + "…"
                        : "(none yet)"
                    }
                  />
                  <MetricBox
                    label="Type"
                    value={status.bestStrategyType ?? "—"}
                  />
                  {progress?.leaderboardTopScore !== null &&
                    progress?.leaderboardTopScore !== undefined && (
                      <MetricBox
                        label="Leaderboard Top Score"
                        value={progress.leaderboardTopScore.toFixed(2)}
                      />
                    )}
                  {progress?.lastIterationParentStrategyVersionId && (
                    <MetricBox
                      label="Last Iteration Parent"
                      value={
                        progress.lastIterationParentStrategyVersionId.slice(0, 8) + "…"
                      }
                    />
                  )}
                </div>
              </div>

              {/* Last iteration search run link */}
              {status.lastIterationSearchRunId && (
                <div className="text-[11px] text-slate-400 font-mono">
                  Last iteration SearchRun:{" "}
                  <span className="text-slate-700">{status.lastIterationSearchRunId}</span>
                </div>
              )}
            </>
          )}
        </article>

        {/* Controls */}
        <aside className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 sticky top-6">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
            <Square className="w-4 h-4 text-blue-500" />
            Controls
          </h3>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Loop ID
            </label>
            <input
              type="text"
              value={loopId}
              onChange={(e) => setLoopId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
              disabled={isRunning}
            />
          </div>

          <NumberField
            label="Max Candidates"
            value={maxCandidates}
            min={1}
            max={100000}
            onChange={setMaxCandidates}
            disabled={isRunning}
          />
          <NumberField
            label="Time Limit (seconds)"
            value={timeLimitSeconds}
            min={1}
            max={86400}
            onChange={setTimeLimitSeconds}
            disabled={isRunning}
          />
          <NumberField
            label="No-Improvement Cap"
            value={noImprovementCap}
            min={1}
            max={10000}
            onChange={setNoImprovementCap}
            disabled={isRunning}
          />

          <div className="grid grid-cols-2 gap-2 mt-2">
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
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-1">
              Loop stopped. Click <strong>Start</strong> to begin a new run with the
              configuration above.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-base font-extrabold text-slate-800 mt-1 font-mono">{value}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(isNaN(v) ? min : Math.max(min, Math.min(max, v)));
        }}
        className="w-full px-3 py-2 rounded-xl border text-xs font-semibold text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors disabled:opacity-50"
      />
    </div>
  );
}
