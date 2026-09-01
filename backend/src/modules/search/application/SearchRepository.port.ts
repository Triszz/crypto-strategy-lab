/**
 * search · application · SearchRepository
 *
 * Application-facing port for Search persistence. The SearchService receives
 * this port so it remains independent of the concrete database technology.
 *
 * SearchService must NOT call Prisma directly. Infrastructure (Prisma) must
 * NOT appear in the application or domain layer.
 *
 * This port defines the minimum operations required by SearchService:
 *   - Create / update SearchRun rows
 *   - Persist CandidateStrategy rows (BASE and COMPOSITE)
 *
 * Caller (SearchService) is responsible for:
 *   - Resolving StrategyVersion ids
 *   - Validating candidate parameters
 *
 * Implementations must handle:
 *   - Prisma transaction wrapping for multi-row operations
 *   - Duplicate handling (ON CONFLICT if applicable)
 *   - Error translation (Prisma errors → domain ApplicationError)
 */
import type { StrategyParameters } from "../../strategy/domain/StrategyContext";

/**
 * The runtime status of a search run. Matches the `SearchStatus` Prisma enum.
 */
export type SearchRunStatus = "PENDING" | "RUNNING" | "DONE" | "STOPPED" | "FAILED";

/**
 * The runtime status of a candidate strategy. Matches `CandidateStatus`.
 */
export type CandidateStatus = "PENDING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

/**
 * Domain representation of a persisted SearchRun. Used as return values
 * from the repository and passed into application services.
 *
 * This is a plain TypeScript type — NOT a Prisma model.
 */
export interface SearchRunRecord {
  readonly id: string;
  readonly algorithmId: string;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly fromTime?: bigint;
  readonly toTime?: bigint;
  readonly status: SearchRunStatus;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
  readonly createdBy?: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * Domain representation of a persisted CandidateStrategy row.
 * Used by SearchService to persist candidates and by callers who need
 * the persisted candidate id.
 *
 * This is a plain TypeScript type — NOT a Prisma model.
 */
export interface CandidateRecord {
  readonly id: string;
  readonly searchRunId: string;
  readonly strategyVersionId: string;
  readonly parameters: StrategyParameters;
  readonly status: CandidateStatus;
  readonly errorMessage?: string;
  readonly createdAt: Date;
}

/** Input for creating a new SearchRun row. */
export interface CreateSearchRunInput {
  readonly algorithmId: string;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly fromTime?: bigint;
  readonly toTime?: bigint;
  readonly createdBy?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Input for creating a new CandidateStrategy row. */
export interface CreateCandidateInput {
  readonly searchRunId: string;
  readonly strategyVersionId: string;
  readonly parameters: StrategyParameters;
  readonly status?: CandidateStatus;
}

/**
 * Repository port for Search persistence.
 *
 * All methods that touch the database are async.
 * All methods translate Prisma errors into domain-level errors.
 */
export interface SearchRepository {
  /**
   * Create a new SearchRun row with status PENDING.
   *
   * @throws Application-level error if FK constraints fail (e.g. invalid algorithmId).
   */
  createSearchRun(input: CreateSearchRunInput): Promise<SearchRunRecord>;

  /**
   * Update a SearchRun's status and timestamps.
   * Used for transitions: PENDING → RUNNING, RUNNING → DONE/STOPPED/FAILED.
   *
   * @param finishedAt  Set when the run has completed/stopped/failed.
   * @param error       Human-readable error message. Set when status is FAILED.
   */
  updateSearchRunStatus(
    id: string,
    status: SearchRunStatus,
    startedAt?: Date,
    finishedAt?: Date,
    error?: string,
  ): Promise<void>;

  /**
   * Persist a BASE or COMPOSITE candidate. The caller provides a resolved
   * `strategyVersionId` — the repository only inserts the row.
   *
   * @param input  Must include a valid `strategyVersionId` and parameters JSON.
   * @returns The created CandidateStrategy row.
   * @throws  Application-level error if FK constraints fail.
   */
  createCandidate(input: CreateCandidateInput): Promise<CandidateRecord>;

  /**
   * Fetch a SearchRun by id.
   *
   * @returns The row, or null if not found.
   */
  getSearchRun(id: string): Promise<SearchRunRecord | null>;

  /**
   * Fetch all CandidateStrategy rows for a SearchRun.
   *
   * @returns Rows ordered by `createdAt ASC`.
   */
  getCandidatesByRun(searchRunId: string): Promise<ReadonlyArray<CandidateRecord>>;
}
