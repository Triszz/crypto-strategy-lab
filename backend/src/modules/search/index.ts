/**
 * search · module barrel
 *
 * Public surface of the Search module.
 *
 * Dependency rules (from README):
 * - Search may depend on strategy + backtest abstractions but only
 *   through the EventBus and injected ports — not on their internal
 *   implementation.
 * - Domain layer MUST NOT import Prisma, Express, BullMQ, Socket.IO, Redis.
 * - Application/Infrastructure layers may import Prisma and other infra
 *   but must not appear in the domain layer.
 */

// ── Domain ────────────────────────────────────────────────────────────────────

export type { ParameterSpace, ParameterSpaceField, ParameterSpaceKind } from "./domain/ParameterSpace";
export { buildParameterSpace } from "./domain/ParameterSpace";

export type { SearchCandidate, BaseCandidate, CompositeCandidate, CandidateType } from "./domain/SearchCandidate";
export { formatCandidateId } from "./domain/SearchCandidate";

export type {
  StopCondition,
  SearchState,
  StopReason,
} from "./domain/StopCondition";
export {
  maxCandidatesStopCondition,
  timeBudgetStopCondition,
  anyStopCondition,
} from "./domain/StopCondition";

export type {
  StrategyGenerator,
  GeneratorConfig,
  GeneratorRunResult,
  OnCandidate,
  GenerateResult,
} from "./domain/StrategyGenerator";
export { resolveOnCandidate } from "./domain/StrategyGenerator";

export type { FamilyGroup, DomainGuidedConfig } from "./generators/DomainGuidedGenerator";

// ── Generators ────────────────────────────────────────────────────────────────

export { RandomGenerator, RANDOM_GENERATOR_ID } from "./generators/RandomGenerator";
export { DomainGuidedGenerator, DOMAIN_GUIDED_GENERATOR_ID } from "./generators/DomainGuidedGenerator";

// ── Application ────────────────────────────────────────────────────────────────

// Repository port and domain types (infrastructure-free)
export type {
  SearchRepository,
  SearchRunStatus,
  CandidateStatus,
  SearchRunRecord,
  CandidateRecord,
  CreateSearchRunInput,
  CreateCandidateInput,
} from "./application/SearchRepository.port";

// Service types and service itself
export { SearchService } from "./application/SearchService";
export type {
  SearchStartedEvent,
  CandidateGeneratedEvent,
  SearchCompletedEvent,
  SearchStoppedEvent,
  SearchFailedEvent,
  CreateSearchInput,
  CreateSearchResult,
  StartSearchResult,
} from "./application/SearchService";

// StrategyVersion mapper
export { StrategyVersionMapper } from "./application/StrategyVersionMapper";
export type { StrategyVersionInfo } from "./application/StrategyVersionMapper";

// Prisma repository (infrastructure — use in composition, not in domain)
export { PrismaSearchRepository } from "./application/PrismaSearchRepository";

// Container (composition root — used in server.ts)
export { buildSearchContainer } from "./application/container";
export type { SearchContainer } from "./application/container";

// ── Presentation ────────────────────────────────────────────────────────────────

export { buildSearchRouter } from "./presentation/search.routes";
