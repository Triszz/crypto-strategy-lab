/**
 * Search / Discovery page — shows the status and metadata of a SearchRun.
 *
 * - Loads SearchRun summary via GET /api/search/:id
 * - Polls while status is PENDING or RUNNING
 * - Stops polling on DONE / STOPPED / FAILED
 * - Renders lifecycle states with appropriate visuals
 * - Note: the backend does NOT expose individual candidates via this
 *   endpoint, so the page shows the persisted run summary plus the
 *   counts that POST /api/search/start returned (passed via route state).
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Hash,
  RefreshCw,
  Search as SearchIcon,
  XCircle,
  StopCircle,
  Hourglass,
  PlayCircle,
  FlaskConical,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  getSearchRun,
  fetchSearchRunCandidates,
  type SearchRunSummary,
  type SearchStatus,
  type StartSearchResponse,
  type CandidateItem,
} from "../services/searchApi";
import { backtestApi } from "../services/backtestApi";
import {
  getLoopStatus,
  type LoopStatusResponse,
} from "../services/loopApi";

// ─── Lifecycle UI helpers ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<SearchStatus, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  DONE: "Done",
  STOPPED: "Stopped",
  FAILED: "Failed",
};

function statusBadgeClass(status: SearchStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "RUNNING":
      return "bg-blue-50 text-blue-600 border-blue-200";
    case "DONE":
      return "bg-emerald-50 text-emerald-600 border-emerald-200";
    case "STOPPED":
      return "bg-amber-50 text-amber-600 border-amber-200";
    case "FAILED":
      return "bg-red-50 text-red-600 border-red-200";
  }
}

function statusIcon(status: SearchStatus): React.ReactNode {
  switch (status) {
    case "PENDING":
      return <Hourglass className="w-4 h-4" />;
    case "RUNNING":
      return <PlayCircle className="w-4 h-4" />;
    case "DONE":
      return <CheckCircle2 className="w-4 h-4" />;
    case "STOPPED":
      return <StopCircle className="w-4 h-4" />;
    case "FAILED":
      return <XCircle className="w-4 h-4" />;
  }
}

// ─── Lifecycle Section ────────────────────────────────────────────────────────

interface LifecycleProps {
  status: SearchStatus;
  run: SearchRunSummary;
}

function LifecycleSection({ status, run }: LifecycleProps) {
  // Linear steps: PENDING → RUNNING → DONE/STOPPED/FAILED
  const steps: SearchStatus[] = ["PENDING", "RUNNING", "DONE"];
  const terminal: SearchStatus[] = ["DONE", "STOPPED", "FAILED"];
  const currentIndex = terminal.includes(status)
    ? 2
    : status === "RUNNING"
      ? 1
      : 0;

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-blue-500" />
        Search Lifecycle
      </h3>

      {/* Status pill */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-extrabold border ${statusBadgeClass(status)}`}>
          {statusIcon(status)}
          {STATUS_LABELS[status]}
        </span>
        {run.startedAt && (
          <span className="text-[10px] font-bold text-slate-400">
            Started {new Date(run.startedAt).toLocaleString()}
          </span>
        )}
        {run.finishedAt && (
          <span className="text-[10px] font-bold text-slate-400">
            Finished {new Date(run.finishedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-3">
        {steps.map((s, i) => {
          const reached = i <= currentIndex;
          const isCurrent = i === currentIndex;
          const failed = status === "FAILED" && i === 2;
          const stopped = status === "STOPPED" && i === 2;

          return (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold border ${
                  failed
                    ? "bg-red-50 text-red-600 border-red-200"
                    : stopped
                      ? "bg-amber-50 text-amber-600 border-amber-200"
                      : reached
                        ? isCurrent && status === "RUNNING"
                          ? "bg-blue-50 text-blue-600 border-blue-200 animate-pulse"
                          : "bg-emerald-50 text-emerald-600 border-emerald-200"
                        : "bg-slate-50 text-slate-400 border-slate-200"
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-[11px] font-bold ${reached ? "text-slate-700" : "text-slate-400"}`}>
                {STATUS_LABELS[s]}
              </span>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 ${reached && (i < currentIndex || currentIndex === steps.length - 1) ? "bg-emerald-200" : "bg-slate-100"}`} />
              )}
            </div>
          );
        })}
      </div>

      {status === "FAILED" && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-[11px] text-red-700 font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Generation failed. Check the backend logs for the error details.
        </div>
      )}
      {status === "STOPPED" && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-[11px] text-amber-700 font-semibold flex items-center gap-2">
          <StopCircle className="w-4 h-4" />
          Generation stopped before reaching maxCandidates. Inspect the run summary below.
        </div>
      )}
    </div>
  );
}

// ─── Run Summary Card ──────────────────────────────────────────────────────────

interface RunSummaryProps {
  run: SearchRunSummary;
  startResponse: StartSearchResponse | null;
}

function RunSummaryCard({ run, startResponse }: RunSummaryProps) {
  const durationMs = (() => {
    if (!run.startedAt) return null;
    const start = new Date(run.startedAt).getTime();
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
    return end - start;
  })();

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
        <SearchIcon className="w-4 h-4 text-blue-500" />
        Search Run Summary
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <DetailField label="Run ID" value={<span className="font-mono text-[10px]">{run.id}</span>} />
        <DetailField label="Timeframe" value={run.timeframe} />
        <DetailField label="Max Candidates" value={String(run.maxCandidates)} />

        {startResponse && (
          <>
            <DetailField label="Total Generated" value={String(startResponse.totalGenerated)} />
            <DetailField label="Total Queued" value={String(startResponse.totalQueued)} />
            <DetailField label="Total Rejected" value={String(startResponse.totalRejected)} />
            <DetailField label="Generator" value={startResponse.algorithm} />
            <DetailField label="Stop Reason" value={String(startResponse.stopReason)} />
            <DetailField
              label="Generation ms"
              value={String(startResponse.generationMs)}
            />
          </>
        )}

        {durationMs !== null && (
          <DetailField
            label="Wall-clock Duration"
            value={`${durationMs} ms`}
          />
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-xs font-extrabold text-slate-800 break-all">{value}</span>
    </div>
  );
}

// ─── Candidates Section ─────────────────────────────────────────────────────

interface CandidatesSectionProps {
  candidates: CandidateItem[];
  isTerminal: boolean;
  error: string | null;
  backtestState: Record<
    string,
    { experimentId?: string; loading: boolean; error?: string }
  >;
  onRunBacktest: (candidate: CandidateItem) => void;
}

function CandidatesSection({
  candidates,
  isTerminal,
  error,
  backtestState,
  onRunBacktest,
}: CandidatesSectionProps) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <PlayCircle className="w-4 h-4 text-blue-500" />
          Candidates ({candidates.length})
        </h3>
        {!isTerminal && (
          <span className="text-[10px] font-bold text-slate-400">
            Waiting for SearchRun to finish…
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-[11px] text-red-700 font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {isTerminal && candidates.length === 0 && !error && (
        <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-6 text-[12px] text-slate-500 font-semibold text-center">
          No candidates were generated by this SearchRun.
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-3">
          {candidates.map((c, idx) => {
            const state = backtestState[c.id];
            const isLoading = state?.loading ?? false;
            const experimentId = state?.experimentId;
            const errorMsg = state?.error;

            const paramsPreview = Object.entries(c.parameters || {})
              .filter(([k]) => !k.startsWith("_"))
              .map(([k, v]) => `${k}=${String(v)}`)
              .slice(0, 4)
              .join(", ");

            return (
              <div
                key={c.id}
                className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-extrabold text-slate-800 truncate">
                        {c.strategyVersion?.name ?? "(unknown strategy)"}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wide ${
                          c.strategyVersion?.definitionType === "COMPOSITE"
                            ? "bg-purple-50 text-purple-600"
                            : "bg-blue-50 text-blue-600"
                        }`}
                      >
                        {c.strategyVersion?.definitionType ?? "?"}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {c.id.slice(0, 8)}…
                      </span>
                    </div>
                    {paramsPreview && (
                      <span className="text-[10px] text-slate-500 font-semibold break-all">
                        {paramsPreview}
                        {Object.keys(c.parameters || {}).filter((k) => !k.startsWith("_"))
                          .length > 4
                          ? ", …"
                          : ""}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {experimentId && (
                      <span
                        className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg font-mono"
                        title={experimentId}
                      >
                        exp {experimentId.slice(0, 8)}…
                      </span>
                    )}
                    <button
                      onClick={() => onRunBacktest(c)}
                      disabled={isLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3 h-3" />
                          Run Backtest
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-[10px] text-red-700 font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {errorMsg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Empty / Error states ─────────────────────────────────────────────────────

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
      <RefreshCw className="w-8 h-8 animate-spin" />
      <span className="text-xs font-semibold">{message}</span>
    </div>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-red-400">
      <AlertCircle className="w-10 h-10" />
      <p className="text-sm font-semibold text-center max-w-md">{message}</p>
      <button
        onClick={onBack}
        className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700 transition-colors"
      >
        Back to Strategy catalogue
      </button>
    </div>
  );
}

// ─── Continuous Strategy Loop Status Card ───────────────────────────────────

interface LoopStatusCardProps {
  loopId: string | null;
  status: LoopStatusResponse | null;
  loading: boolean;
  error: string | null;
  startError: string | null;
  onView: () => void;
}

const LOOP_STATUS_LABELS: Record<string, string> = {
  RUNNING: "Running",
  PAUSED: "Paused",
  STOPPED_MAX_CANDIDATES: "Stopped (max candidates)",
  STOPPED_TIMEOUT: "Stopped (timeout)",
  STOPPED_NO_IMPROVEMENT: "Stopped (no improvement)",
  STOPPED_MANUAL: "Stopped (manual)",
  STOPPED: "Stopped",
};

function loopBadgeClass(status: string): string {
  if (status === "RUNNING") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "PAUSED") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status && status.startsWith("STOPPED")) return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

function LoopStatusCard({
  loopId,
  status,
  loading,
  error,
  startError,
  onView,
}: LoopStatusCardProps) {
  // Hide entirely if no loopId was forwarded (the Search page can be
  // opened directly from the catalogue without a Loop attached).
  if (!loopId) return null;

  const statusText = status ? (LOOP_STATUS_LABELS[status.status] ?? status.status) : "—";
  const iteration = status
    ? `${status.currentIteration} / ${status.maxIterations}`
    : "—";
  const candidates = status
    ? `${status.totalEvaluated} / ${status.maxCandidates}`
    : "—";
  const bestScore = status ? status.bestScoreSoFar.toFixed(2) : "—";

  return (
    <article
      data-testid="continuous-loop-status-card"
      className="bg-gradient-to-br from-blue-50/60 to-indigo-50/40 border border-blue-100/60 rounded-2xl shadow-sm p-5 flex flex-col gap-4"
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-blue-500" />
            Continuous Strategy Loop
          </h3>
          <p className="text-[11px] text-slate-500 font-semibold">
            Auto-started by Run Combination. Backend Loop Orchestrator
            consumes <span className="font-mono">NewTopStrategyFound</span>
            {" "}events to generate the next candidate.
          </p>
        </div>
        <span
          data-testid="continuous-loop-status"
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-extrabold border ${loopBadgeClass(status?.status ?? "")}`}
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {statusText}
        </span>
      </div>

      {startError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Auto-start reported: <span className="font-mono">{startError}</span>.
            The Loop can still be started manually from the monitoring page.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-[11px] text-red-700 font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Loop status fetch failed: {error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <LoopStat label="Iteration" value={iteration} />
        <LoopStat label="Candidates Checked" value={candidates} />
        <LoopStat label="Best Score" value={bestScore} />
        <LoopStat
          label="Loop ID"
          value={<span className="font-mono text-[10px]">{loopId.slice(0, 12)}…</span>}
        />
      </div>

      <button
        onClick={onView}
        data-testid="view-continuous-loop-btn"
        className="self-end flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-colors"
      >
        View Continuous Loop
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </article>
  );
}

function LoopStat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 bg-white/80 border border-blue-100 rounded-xl px-3 py-2.5">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
        {label}
      </span>
      <span className="text-xs font-extrabold text-slate-800 font-mono break-all">
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SearchPage() {
  const params = useParams<{ searchRunId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const searchRunId = params.searchRunId;

  // startResponse is passed via React Router state when the user just
  // came from "Run Discovery". Falls back to null on direct navigation.
  const startResponse = (location.state as { startResponse?: StartSearchResponse } | null)?.startResponse ?? null;

  // loopId is forwarded by Combination.handleSubmit() so the Search page
  // can show the Continuous Strategy Loop status card and the "View
  // Continuous Loop" button. We never invent a loopId here — we only
  // use what the backend gave us (or the deterministic combo-<id> the
  // Combination page fell back to).
  const loopIdFromState = (location.state as { loopId?: string } | null)?.loopId ?? null;
  const loopStartErrorFromState =
    (location.state as { loopStartError?: string } | null)?.loopStartError ?? null;

  // ── State ──
  const [run, setRun] = useState<SearchRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Candidates produced by this SearchRun. Fetched once on mount (and on
  // polling stop so the list refreshes after a fresh DONE).
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // Continuous Strategy Loop status (compact card on the Search page).
  const [loopStatus, setLoopStatus] = useState<LoopStatusResponse | null>(null);
  const [loopLoading, setLoopLoading] = useState<boolean>(false);
  const [loopError, setLoopError] = useState<string | null>(null);

  // Per-candidate backtest state: experimentId returned by /api/backtests/run
  // and any error message. Keyed by candidateId.
  const [backtestByCandidate, setBacktestByCandidate] = useState<
    Record<string, { experimentId?: string; loading: boolean; error?: string }>
  >({});

  // Track timer in ref so cleanup is reliable across re-renders.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load + poll ──
  const loadOnce = useCallback(async (id: string) => {
    try {
      const data = await getSearchRun(id);
      setRun(data);
      setError(null);
      return data;
    } catch (err) {
      const msg = (err as Error).message ?? "Failed to load search run.";
      // 404 → "Search run not found"
      if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
        setError("Search run not found. It may have been deleted or never existed.");
      } else {
        setError(msg);
      }
      return null;
    }
  }, []);

  // Fetch persisted candidates for this run. Idempotent — safe to call
  // multiple times (e.g. on every poll completion).
  const loadCandidates = useCallback(async (id: string) => {
    try {
      const rows = await fetchSearchRunCandidates(id);
      setCandidates(rows);
      setCandidatesError(null);
    } catch (err) {
      const msg = (err as Error).message ?? "Failed to load candidates.";
      setCandidatesError(msg);
    }
  }, []);

  // ── Run Backtest for one candidate ──────────────────────────────────────
  const runBacktestForCandidate = useCallback(
    async (candidate: CandidateItem) => {
      const id = candidate.id;
      setBacktestByCandidate((prev) => ({
        ...prev,
        [id]: { loading: true },
      }));
      try {
        const response = await backtestApi.runBacktest({
          candidateId: id,
          sync: true,
        });
        const experimentId =
          response.result && "experimentId" in response.result
            ? (response.result as { experimentId: string }).experimentId
            : undefined;
        setBacktestByCandidate((prev) => ({
          ...prev,
          [id]: { loading: false, experimentId },
        }));
      } catch (err) {
        const msg = (err as Error).message ?? "Backtest request failed.";
        setBacktestByCandidate((prev) => ({
          ...prev,
          [id]: { loading: false, error: msg },
        }));
      }
    },
    [],
  );

  // Load on mount / id change
  useEffect(() => {
    if (!searchRunId) {
      setError("Missing searchRunId in URL.");
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadOnce(searchRunId)
      .then((data) => {
        // If the run is already in a terminal state, also load candidates.
        if (
          data &&
          (data.status === "DONE" ||
            data.status === "STOPPED" ||
            data.status === "FAILED")
        ) {
          void loadCandidates(searchRunId);
        }
      })
      .finally(() => setLoading(false));
  }, [searchRunId, loadOnce, loadCandidates]);

  // Polling: poll while PENDING or RUNNING, stop on terminal states
  useEffect(() => {
    if (!run) return;
    if (!searchRunId) return;
    const isPolling = run.status === "PENDING" || run.status === "RUNNING";
    if (!isPolling) {
      // Cleanup any leftover timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Start a single polling loop
    timerRef.current = setInterval(async () => {
      setPollCount((c) => c + 1);
      const data = await loadOnce(searchRunId);
      if (data && (data.status === "DONE" || data.status === "STOPPED" || data.status === "FAILED")) {
        // Terminal — stop polling and pull the candidate list once.
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        void loadCandidates(searchRunId);
      }
    }, 2000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [run?.status, searchRunId, loadOnce, loadCandidates]);

  // ── Continuous Strategy Loop polling ─────────────────────────────────
  // The Loop started automatically from Run Combination. We poll its
  // status every 4s so the compact status card on this page stays in
  // sync with /loop without duplicating the detailed monitoring UI.
  // Cleanup is reliable via the ref pattern.
  const loopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLoopStatus = useCallback(
    async (id: string) => {
      setLoopLoading(true);
      try {
        const status = await getLoopStatus(id);
        setLoopStatus(status);
        setLoopError(null);
        return status;
      } catch (err) {
        const msg = (err as Error).message ?? "Failed to load loop status.";
        setLoopError(msg);
        return null;
      } finally {
        setLoopLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!loopIdFromState) return;

    // Initial fetch + clear any previous timer (StrictMode double-mount
    // safety + react-router state changes).
    void loadLoopStatus(loopIdFromState);
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    loopTimerRef.current = setInterval(() => {
      void loadLoopStatus(loopIdFromState);
    }, 4000);

    return () => {
      if (loopTimerRef.current) {
        clearInterval(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };
  }, [loopIdFromState, loadLoopStatus]);

  // ── Render ──

  if (loading) return <LoadingState message="Loading search run…" />;
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <ErrorState
          message={error}
          onBack={() => navigate("/strategy")}
        />
      </div>
    );
  }
  if (!run) return null;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/strategy")}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Search / Discovery Run</h2>
            <p className="text-xs text-slate-400 font-semibold mt-1">
              Inspect the persisted SearchRun lifecycle and counts.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1.5">
            <Hash className="w-3 h-3" />
            <span className="font-mono">{run.id.slice(0, 8)}…</span>
          </span>
          {(run.status === "PENDING" || run.status === "RUNNING") && (
            <span className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Polling #{pollCount}
            </span>
          )}
        </div>
      </header>

      {/* Lifecycle */}
      <LifecycleSection status={run.status} run={run} />

      {/* Summary */}
      <RunSummaryCard run={run} startResponse={startResponse} />

      {/* Continuous Strategy Loop status (auto-started by Run Combination) */}
      <LoopStatusCard
        loopId={loopIdFromState}
        status={loopStatus}
        loading={loopLoading}
        error={loopError}
        startError={loopStartErrorFromState}
        onView={() => {
          if (!loopIdFromState) return;
          navigate(
            `/loop?loopId=${encodeURIComponent(loopIdFromState)}`,
          );
        }}
      />

      {/* Candidates — Search → Backtest integration */}
      <CandidatesSection
        candidates={candidates}
        isTerminal={
          run.status === "DONE" ||
          run.status === "STOPPED" ||
          run.status === "FAILED"
        }
        error={candidatesError}
        backtestState={backtestByCandidate}
        onRunBacktest={runBacktestForCandidate}
      />

      {/* Footnote */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-[11px] text-slate-500 font-medium flex items-start gap-2">
        <Clock className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Each candidate above can be sent to the Backtest engine by clicking
          <span className="font-bold text-slate-700"> Run Backtest</span>. The
          Backtest resolves the candidate from Supabase, runs the real
          <span className="font-mono text-slate-600"> Strategy</span> implementation
          with the candidate's stored parameters, and persists a new
          <span className="font-mono text-slate-600"> Experiment</span> linked back to
          this CandidateStrategy.
        </span>
      </div>
    </div>
  );
}