/**
 * Strategy Engine API client.
 *
 * Endpoints consumed:
 *   POST  /api/strategies/prompt      – generate Strategy JSON from natural language (LLM)
 *   POST  /api/strategies/import-url  – generate Strategy JSON from a public URL (LLM)
 *   POST  /api/strategies/validate    – validate a StrategyEngineJson
 *   POST  /api/strategies/saved       – persist a validated strategy
 *   GET   /api/strategies/saved       – list recent saved strategies
 *   GET   /api/strategies/saved/:id   – get one saved strategy
 *
 * The DTO shape matches the backend's `StrategyEngineJson` defined at
 * `backend/src/modules/strategy/domain/StrategyEngineJson.ts`.
 */

// ─── API Response Wrappers ────────────────────────────────────────────────────

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: string;
  message?: string;
  details?: unknown;
  validation?: ValidationResponse;
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResponse {
  readonly ok: boolean;
  readonly errors?: ReadonlyArray<string>;
  readonly warnings?: ReadonlyArray<string>;
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export type StrategyFamily =
  | "TREND"
  | "MOMENTUM"
  | "STRUCTURE"
  | "VOLATILITY"
  | "SENTIMENT";

export type StrategyTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type StrategySource = "USER_PROMPT" | "WEB_IMPORT";
export type ParamKind = "integer" | "decimal" | "enum";

export interface ParameterField {
  readonly key: string;
  readonly kind: ParamKind;
  readonly min?: number;
  readonly max?: number;
  readonly enumValues?: ReadonlyArray<string>;
  readonly default: number | string;
  readonly description?: string;
}

export interface StrategyEngineJson {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly family: StrategyFamily;
  readonly implementationRef: string;
  readonly parameterSpec: { readonly fields: ReadonlyArray<ParameterField> };
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requiredHistory: number;
  readonly supportedTimeframes?: ReadonlyArray<StrategyTimeframe>;
  readonly timeframe?: StrategyTimeframe;
  readonly source?: StrategySource;
  readonly tags?: ReadonlyArray<string>;
}

export interface SavedStrategyDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly jsonDef: Readonly<Record<string, unknown>>;
  readonly source: StrategySource;
  readonly tags: ReadonlyArray<string>;
  readonly ownerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedStrategiesResponse {
  readonly strategies: ReadonlyArray<SavedStrategyDto>;
  readonly total: number;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error(
      (json as ApiError).message ??
        (json as ApiError).error ??
        `HTTP ${res.status}`,
    );
  }
  return (json as ApiSuccess<T>).data;
}

async function post<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    const apiError = json as ApiError;
    const err = new Error(apiError.message ?? apiError.error ?? `HTTP ${res.status}`);
    (err as Error & { validation?: ValidationResponse }).validation =
      apiError.validation;
    (err as Error & { code?: string }).code = apiError.error;
    throw err;
  }
  return (json as ApiSuccess<T>).data;
}

// ─── API Methods ──────────────────────────────────────────────────────────────

/**
 * POST /api/strategies/prompt
 * Translate a natural language description into a structured strategy JSON
 * via the configured LLM provider (Gemini). Returns 503 if no LLM is configured.
 */
export async function generateStrategyFromPrompt(params: {
  prompt: string;
  source?: StrategySource;
  tags?: ReadonlyArray<string>;
}): Promise<StrategyEngineJson> {
  return post<StrategyEngineJson, typeof params>(
    "/api/strategies/prompt",
    params,
  );
}

/**
 * POST /api/strategies/import-url
 * Fetch a public strategy URL and convert its content into a structured
 * strategy JSON via the configured LLM provider.
 */
export async function importStrategyFromUrl(params: {
  url: string;
  tags?: ReadonlyArray<string>;
}): Promise<StrategyEngineJson> {
  return post<StrategyEngineJson, typeof params>(
    "/api/strategies/import-url",
    params,
  );
}

/**
 * POST /api/strategies/validate
 * Validate a StrategyEngineJson against the domain schema. Backend is
 * authoritative — the frontend should defer to the response.
 */
export async function validateStrategyJson(
  json: unknown,
): Promise<ValidationResponse> {
  return post<ValidationResponse, { json: unknown }>(
    "/api/strategies/validate",
    { json },
  );
}

/**
 * POST /api/strategies/saved
 * Persist a validated strategy JSON to the database.
 */
export async function saveStrategy(params: {
  json: StrategyEngineJson;
  ownerId?: string;
}): Promise<SavedStrategyDto> {
  return post<SavedStrategyDto, typeof params>(
    "/api/strategies/saved",
    params,
  );
}

/**
 * GET /api/strategies/saved
 * List recently saved strategies.
 */
export async function fetchSavedStrategies(): Promise<SavedStrategiesResponse> {
  return get<SavedStrategiesResponse>("/api/strategies/saved");
}

/**
 * GET /api/strategies/saved/:id
 * Fetch one saved strategy.
 */
export async function fetchSavedStrategyById(id: string): Promise<SavedStrategyDto> {
  return get<SavedStrategyDto>(`/api/strategies/saved/${encodeURIComponent(id)}`);
}
