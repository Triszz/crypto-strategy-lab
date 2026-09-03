/**
 * Strategy API client.
 * All calls go to the backend on the same origin (Vite dev server proxies /api).
 *
 * StrategyCatalogue
 *     ↓
 * GET /api/strategies          ← { strategies: StrategyListItem[], total: number }
 * GET /api/strategies/:id      ← { strategy: StrategyDetail }
 */

// ─── API Response Types ────────────────────────────────────────────────────────

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: string;
  details?: unknown[];
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Strategy DTO Types (mirrors backend's StrategyService DTOs) ─────────────────

/**
 * A parameter field definition from the strategy's ParamSpec.
 * Mirrors: backend's ParameterField (from StrategyService.ts).
 */
export interface ParameterField {
  readonly key: string;
  readonly kind: "integer" | "decimal" | "enum";
  /** Human-readable description. Null if not provided. */
  readonly description: string | null;
  /** Default value for this parameter. */
  readonly defaultValue: string | number;
  /** Minimum value (integer/decimal fields only). */
  readonly min?: number | null;
  /** Maximum value (integer/decimal fields only). */
  readonly max?: number | null;
  /** Allowed values (enum fields only). */
  readonly values?: ReadonlyArray<string>;
}

/**
 * A registered strategy returned by GET /api/strategies.
 * Mirrors: backend's StrategyListItem.
 */
export interface StrategyListItem {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly description: string | null;
  readonly type: "BASE"; // MVP: only BASE strategies from registry
  readonly requiredHistory: number;
  readonly supportedTimeframes: ReadonlyArray<string> | null;
  readonly parameterSpec: {
    readonly fields: ReadonlyArray<ParameterField>;
  };
}

/**
 * A strategy detail returned by GET /api/strategies/:id.
 * Mirrors: backend's StrategyDetail.
 */
export interface StrategyDetail extends StrategyListItem {
  /** Default parameter values for auto-populating the config form. */
  readonly defaultParameters: Readonly<Record<string, unknown>>;
  readonly parameterValidation: {
    readonly hasCrossFieldRules: boolean;
  };
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

interface StrategiesResponse {
  readonly strategies: ReadonlyArray<StrategyListItem>;
  readonly total: number;
}

interface StrategyByIdResponse {
  readonly strategy: StrategyDetail;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error((json as ApiError).error ?? `HTTP ${res.status}`);
  }
  return (json as ApiSuccess<T>).data;
}

// ─── Strategy Catalogue API ────────────────────────────────────────────────────

/**
 * Fetch all registered strategies from the backend StrategyRegistry.
 *
 * GET /api/strategies → { strategies: StrategyListItem[], total: number }
 */
export async function fetchStrategies(): Promise<StrategiesResponse> {
  return get<StrategiesResponse>("/api/strategies");
}

/**
 * Fetch a single strategy by its implementationRef id.
 *
 * GET /api/strategies/:id → { strategy: StrategyDetail }
 * Returns 404 if not found.
 */
export async function fetchStrategyById(id: string): Promise<StrategyDetail> {
  const wrapped = await get<StrategyByIdResponse>(
    `/api/strategies/${encodeURIComponent(id)}`,
  );
  return wrapped.strategy;
}

// ─── Saved Combinations API ────────────────────────────────────────────────────

/**
 * Mirrors the backend's SavedCombinationDto.
 */
export interface CombinationComponent {
  readonly strategyId: string;
  readonly weight: number;
  readonly position: number;
}

export type CombinationOperator = "MAJORITY_VOTE" | "WEIGHTED";

export interface SavedCombination {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly operator: CombinationOperator;
  readonly components: ReadonlyArray<CombinationComponent>;
  readonly tags: ReadonlyArray<string>;
  readonly ownerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Request body for POST /api/strategies/combinations */
export interface SaveCombinationRequest {
  readonly name: string;
  readonly description?: string;
  readonly operator?: CombinationOperator;
  readonly components: ReadonlyArray<CombinationComponent>;
  readonly tags?: ReadonlyArray<string>;
  readonly ownerId?: string;
}

async function post<T, B>(path: string, body: B): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    throw new Error((json as ApiError).error ?? `HTTP ${res.status}`);
  }
  return (json as ApiSuccess<T>).data;
}

/**
 * Save a strategy combination to the database.
 * POST /api/strategies/combinations
 */
export async function saveCombination(req: SaveCombinationRequest): Promise<SavedCombination> {
  return post<SavedCombination, SaveCombinationRequest>("/api/strategies/combinations", req);
}

/**
 * Fetch all saved strategy combinations.
 * GET /api/strategies/combinations
 */
export async function fetchCombinations(): Promise<SavedCombination[]> {
  return get<SavedCombination[]>("/api/strategies/combinations");
}

