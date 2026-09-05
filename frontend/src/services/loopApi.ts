/**
 * Loop API client. Calls `/api/loop/*` on the backend (Vite proxies
 * `/api` to the backend at `http://localhost:3000`).
 *
 * Phase 3 — Continuous Strategy Loop:
 *   - Loop-specific best metrics (not global leaderboard Top-1)
 *   - Separate cumulative (totalEvaluated) vs current-iteration counters
 *   - Candidate history per iteration
 *   - Initial SearchRun binding for Iteration #1
 */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** Loop status as returned by GET /api/loop/status */
export interface LoopStatusResponse {
  loopId: string;
  status: string;
  currentIteration: number;
  maxIterations: number;
  /** Cumulative candidates evaluated across all iterations. */
  totalEvaluated: number;
  /** Max cumulative candidates allowed. */
  maxCandidates: number;
  /** How many NEW candidates this iteration should generate. */
  candidateCountPerIteration: number;
  noImprovementCount: number;
  noImprovementCap: number;
  bestScore: number;
  bestStrategyVersionId: string | null;
  bestStrategyName: string | null;
  bestStrategyType: string | null;
  bestStrategySymbolCode: string | null;
  bestStrategyTimeframe: string | null;
  bestTotalReturn: number | null;
  bestWinRate: number | null;
  bestMaxDrawdown: number | null;
  stopReason: string | null;
  lastIterationSearchRunId: string | null;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  timeLimitSeconds: number;
  /** Live count of candidates in the current (in-flight) iteration. */
  currentIterationCandidateCount: number;
  /** Live count of evaluated candidates in the current iteration. */
  currentIterationEvaluatedCount: number;
}

/** Loop progress — augments status with parent strategy id. */
export interface LoopProgressResponse extends LoopStatusResponse {
  lastIterationParentStrategyVersionId: string | null;
}

/** Single candidate within an iteration. */
export interface LoopCandidateItem {
  id: string;
  strategyName: string;
  strategyType: string;
  overallScore: number | null;
  totalReturn: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
}

/** One iteration's data including its candidate list. */
export interface LoopIterationData {
  iterationIndex: number;
  status: string;
  parentStrategyVersionId: string;
  candidateCount: number;
  evaluatedCount: number;
  bestScoreInIteration: number;
  bestStrategyVersionId: string | null;
  completedAt: string | null;
  candidates: LoopCandidateItem[];
}

/** List item for the loop list (sidebar). */
export interface LoopListItem {
  id: string;
  loopId: string;
  status: string;
  maxCandidates: number;
  timeLimitSeconds: number;
  noImprovementCap: number;
  totalEvaluated: number;
  noImprovementCount: number;
  bestScoreSoFar: string;
  currentIteration: number;
  lastIterationSearchRunId: string | null;
  startedAt: string;
  updatedAt: string;
  /** Phase 3.3: stopReason surfaced in today's loop history. */
  stopReason: string | null;
  /** Phase 3.3: total candidates across all iterations (sum of candidateCount). */
  candidateCount: number;
  /** Phase 3.3: total evaluated across all iterations (sum of evaluatedCount). */
  evaluatedCount: number;
}

/** Input to POST /api/loop/start */
export interface StartLoopInput {
  loopId?: string;
  maxCandidates?: number;
  maxIterations?: number;
  timeLimitSeconds?: number;
  noImprovementCap?: number;
  candidateCountPerIteration?: number;
  mutationRatio?: number;
  crossoverRatio?: number;
  explorationRatio?: number;
  elitePoolSize?: number;
  /** Bind an existing SearchRun as iteration #1. */
  initialSearchRunId?: string;
  /** The parent StrategyVersion to use for iteration #1. */
  parentStrategyVersionId?: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: string }
    | null;
  if (!json) throw new Error(`Invalid JSON from server (HTTP ${res.status})`);
  if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
  return (json as { success: true; data: T }).data;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  return unwrap<T>(res);
}

/** Start (or restart) the loop. Pass `initialSearchRunId` + `parentStrategyVersionId`
 * to bind the initial Combination SearchRun as Iteration #1. */
export async function startLoop(input: StartLoopInput = {}): Promise<LoopStatusResponse> {
  return post<LoopStatusResponse>("/api/loop/start", input);
}

/** Pause a RUNNING loop. */
export async function pauseLoop(loopId: string): Promise<LoopStatusResponse> {
  return post<LoopStatusResponse>("/api/loop/pause", { loopId });
}

/** Resume a PAUSED loop. */
export async function resumeLoop(loopId: string): Promise<LoopStatusResponse> {
  return post<LoopStatusResponse>("/api/loop/resume", { loopId });
}

/** Stop the loop. */
export async function stopLoop(loopId: string): Promise<LoopStatusResponse> {
  return post<LoopStatusResponse>("/api/loop/stop", { loopId });
}

/** Read the current state of a loop. Returns null when no loop exists. */
export async function getLoopStatus(loopId: string): Promise<LoopStatusResponse | null> {
  try {
    return await get<LoopStatusResponse>(`/api/loop/status?loopId=${encodeURIComponent(loopId)}`);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("NOT_FOUND")) return null;
    throw err;
  }
}

/** Read iteration + best-score progress for the UI. */
export async function getLoopProgress(loopId: string): Promise<LoopProgressResponse | null> {
  try {
    return await get<LoopProgressResponse>(`/api/loop/progress?loopId=${encodeURIComponent(loopId)}`);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("NOT_FOUND")) return null;
    throw err;
  }
}

/** Read all iterations with their candidate history for a loop. */
export async function getLoopCandidates(loopId: string): Promise<LoopIterationData[]> {
  return get<LoopIterationData[]>(`/api/loop/candidates?loopId=${encodeURIComponent(loopId)}`);
}

/** List all loops (most recent first). */
export async function listLoops(
  opts: {
    today?: boolean;
    limit?: number;
    /**
     * Phase 3.4 — offset of the user's local timezone, in MINUTES
     * EAST of UTC (e.g. UTC+7 → +420, UTC-5 → -300). The backend
     * uses this to compute the "today" calendar-day boundary in the
     * client's local timezone. `Date.getTimezoneOffset()` returns
     * minutes WEST of UTC, so we negate it here.
     */
    tzOffsetMinutes?: number;
  } = {},
): Promise<LoopListItem[]> {
  const params = new URLSearchParams();
  if (opts.today) params.set("today", "true");
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.tzOffsetMinutes !== undefined) {
    params.set("tzOffsetMinutes", String(opts.tzOffsetMinutes));
  }
  const qs = params.toString();
  return get<LoopListItem[]>(`/api/loop/list${qs ? `?${qs}` : ""}`);
}

/** Phase 3.3: active-loop discovery for auto-restore after navigation. */
export interface LoopActiveResponse {
  loopId: string;
  status: string;
  currentIteration: number;
  startedAt: string;
  updatedAt: string;
  source: "pointer" | "most-recent-running";
}

export async function getActiveLoop(): Promise<LoopActiveResponse | null> {
  try {
    return await get<LoopActiveResponse>("/api/loop/active");
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("NOT_FOUND")) return null;
    throw err;
  }
}

/** Phase 3.3: explicitly mark the user's active/followed loop. */
export async function setActiveLoop(loopId: string): Promise<{ loopId: string }> {
  return post<{ loopId: string }>("/api/loop/active", { loopId });
}

/** Phase 3.3: clear the active-loop pointer (used after stopping a loop). */
export async function clearActiveLoop(): Promise<{ cleared: boolean }> {
  const res = await fetch(`${BASE}/api/loop/active`, {
    method: "DELETE",
    credentials: "include",
  });
  const json = (await res.json().catch(() => null)) as
    | { success: true; data: { cleared: boolean } }
    | { success: false; error: string }
    | null;
  if (!json) throw new Error(`Invalid JSON from server (HTTP ${res.status})`);
  if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
  return (json as { success: true; data: { cleared: boolean } }).data;
}
