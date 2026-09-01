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
} from "lucide-react";
import {
  getSearchRun,
  type SearchRunSummary,
  type SearchStatus,
  type StartSearchResponse,
} from "../services/searchApi";

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

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SearchPage() {
  const params = useParams<{ searchRunId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const searchRunId = params.searchRunId;

  // startResponse is passed via React Router state when the user just
  // came from "Run Discovery". Falls back to null on direct navigation.
  const startResponse = (location.state as { startResponse?: StartSearchResponse } | null)?.startResponse ?? null;

  // ── State ──
  const [run, setRun] = useState<SearchRunSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

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

  // Load on mount / id change
  useEffect(() => {
    if (!searchRunId) {
      setError("Missing searchRunId in URL.");
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadOnce(searchRunId).finally(() => setLoading(false));
  }, [searchRunId, loadOnce]);

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
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }, 2000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [run?.status, searchRunId, loadOnce]);

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

      {/* Footnote explaining the candidate-fetching gap */}
      <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-[11px] text-slate-500 font-medium flex items-start gap-2">
        <Clock className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Individual candidates are owned by the Backtest module and are not exposed via
          <span className="font-mono text-slate-600"> GET /api/search/:id</span>. The
          counts above (Total Generated / Queued / Rejected) reflect what was persisted by
          the Search service. Candidates will appear in the Backtest queue for evaluation
          once that downstream integration is enabled.
        </span>
      </div>
    </div>
  );
}