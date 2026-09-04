/**
 * Loop API client. Calls `/api/loop/*` on the backend (Vite proxies
 * `/api` to the backend at `http://localhost:3000`).
 *
 * The Loop UI subscribes to these endpoints for:
 *   - start / pause / resume / stop
 *   - status (current state)
 *   - progress (iteration counter, best score, elapsed time)
 *
 * No metric is hardcoded; every value comes from the backend.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface LoopStatusResponse {
  loopId: string;
  status: string;
  currentIteration: number;
  maxIterations: number;
  maxCandidates: number;
  totalEvaluated: number;
  noImprovementCount: number;
  noImprovementCap: number;
  bestScoreSoFar: number;
  bestStrategyVersionId: string | null;
  bestStrategyType: string | null;
  bestStrategyName: string | null;
  bestStrategySymbolCode: string | null;
  bestStrategyTimeframe: string | null;
  bestTotalReturn: number | null;
  bestWinRate: number | null;
  lastIterationSearchRunId: string | null;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  timeLimitSeconds: number;
}

export interface LoopProgressResponse extends LoopStatusResponse {
  leaderboardTopScore: number | null;
  lastIterationParentStrategyVersionId: string | null;
}

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
}

export interface StartLoopInput {
  loopId?: string;
  maxCandidates?: number;
  timeLimitSeconds?: number;
  noImprovementCap?: number;
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

/** Start (or restart) the loop. */
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

/** List all loops (most recent first). */
export async function listLoops(): Promise<LoopListItem[]> {
  return get<LoopListItem[]>("/api/loop/list");
}
