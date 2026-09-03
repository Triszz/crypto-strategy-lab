/**
 * search · application · SearchService
 *
 * Orchestrates the full Search workflow.
 *
 * NOT responsible for:
 *   - Running backtests (future Backtest module)
 *   - HTTP handling (delegates to SearchController)
 *   - Prisma access (delegates to SearchRepository)
 */
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";
import type { EventBus } from "../../../shared/event-bus/EventBus";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import type { SearchRepository, ListSearchRunsFilter } from "./SearchRepository.port";
import type { StrategyVersionMapper } from "./StrategyVersionMapper";
import type {
  StrategyGenerator,
  OnCandidate,
  GeneratorRunResult,
} from "../domain/StrategyGenerator";
import type { ParameterSpace } from "../domain/ParameterSpace";
import { buildParameterSpace } from "../domain/ParameterSpace";
import type {
  SearchCandidate,
  BaseCandidate,
  CompositeCandidate,
} from "../domain/SearchCandidate";
import type { SearchState } from "../domain/StopCondition";
import { anyStopCondition } from "../domain/StopCondition";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";
import type { SearchRunRecord } from "./SearchRepository.port";
import { RandomGenerator } from "../generators/RandomGenerator";
import { DomainGuidedGenerator } from "../generators/DomainGuidedGenerator";

// ─── Events ───────────────────────────────────────────────────────────────────

export interface SearchStartedEvent {
  readonly searchRunId: string;
  readonly maxCandidates: number;
  readonly algorithm: string;
  readonly symbol: string;
  readonly timeframe: string;
}

export interface CandidateGeneratedEvent {
  readonly searchRunId: string;
  readonly candidateId: string;
  readonly candidateType: "BASE" | "COMPOSITE";
  readonly strategyId: string;
}

export interface SearchCompletedEvent {
  readonly searchRunId: string;
  readonly totalGenerated: number;
  readonly totalQueued: number;
  readonly totalRejected: number;
  readonly generationMs: number;
}

export interface SearchStoppedEvent {
  readonly searchRunId: string;
  readonly totalGenerated: number;
  readonly totalQueued: number;
  readonly reason: string;
}

export interface SearchFailedEvent {
  readonly searchRunId: string;
  readonly error: string;
}

// ─── Input / Output types ──────────────────────────────────────────────────────

export interface CreateSearchInput {
  readonly algorithm: string;
  readonly algorithmId: string;
  readonly symbolId: string;
  readonly timeframe: string;
  readonly maxCandidates: number;
  readonly fromTime?: bigint;
  readonly toTime?: bigint;
  readonly createdBy?: string;
  readonly generatorConfig?: Readonly<Record<string, unknown>>;
}

export interface CreateSearchResult {
  readonly searchRun: SearchRunRecord;
}

export interface StartSearchResult {
  readonly searchRunId: string;
  readonly generatorResult: GeneratorRunResult;
  readonly stopReason: string;
}

// ─── SearchService ────────────────────────────────────────────────────────────

export class SearchService {
  public constructor(
    private readonly repository: SearchRepository,
    private readonly strategyVersionMapper: StrategyVersionMapper,
    private readonly log: Logger = rootLogger,
    private readonly eventBus: EventBus = getEventBus(),
  ) {}

  public async createSearchRun(input: CreateSearchInput): Promise<CreateSearchResult> {
    this.log.info(
      {
        algorithm: input.algorithm,
        symbolId: input.symbolId,
        timeframe: input.timeframe,
        maxCandidates: input.maxCandidates,
      },
      "search.service.create-run",
    );

    const searchRun = await this.repository.createSearchRun({
      algorithmId: input.algorithmId,
      symbolId: input.symbolId,
      timeframe: input.timeframe,
      maxCandidates: input.maxCandidates,
      fromTime: input.fromTime,
      toTime: input.toTime,
      createdBy: input.createdBy,
      config: input.generatorConfig ?? {},
    });

    this.eventBus.publish<SearchStartedEvent>("SearchStarted", {
      searchRunId: searchRun.id,
      maxCandidates: input.maxCandidates,
      algorithm: input.algorithm,
      symbol: input.symbolId,
      timeframe: input.timeframe,
    });

    return { searchRun };
  }

  /** Fetch a SearchRun by id. Returns null if not found. */
  public async getSearchRun(id: string): Promise<SearchRunRecord | null> {
    return this.repository.getSearchRun(id);
  }

  /**
   * Fetch all CandidateStrategy rows produced by a given SearchRun.
   * Returns the persisted candidates with their strategyVersionId and
   * raw parameters JSON. Used by the Search → Backtest integration UI.
   */
  public async getCandidatesByRun(
    searchRunId: string,
  ): Promise<ReadonlyArray<import("./SearchRepository.port").CandidateRecord>> {
    return this.repository.getCandidatesByRun(searchRunId);
  }

  /**
   * List recent SearchRuns. Returns rows ordered by `createdAt DESC`.
   * Used by the Discovery history UI.
   */
  public async listSearchRuns(
    filter?: ListSearchRunsFilter,
  ): Promise<ReadonlyArray<SearchRunRecord>> {
    return this.repository.listSearchRuns(filter);
  }

  /**
   * Count CandidateStrategy rows produced by a SearchRun. Cheap aggregate
   * used to summarise runs in list responses.
   */
  public async countCandidatesByRun(searchRunId: string): Promise<number> {
    return this.repository.countCandidatesByRun(searchRunId);
  }

  /**
   * Resolve the SearchAlgorithm row for a SearchRun. Returns a minimal
   * summary suitable for the Discovery history UI.
   */
  public async getAlgorithmSummary(algorithmId: string): Promise<{
    id: string;
    code: string;
    name: string;
  }> {
    return this.repository.getAlgorithmSummary(algorithmId);
  }

  /**
   * Resolve the Symbol row for a SearchRun. Returns a minimal summary
   * suitable for the Discovery history UI.
   */
  public async getSymbolSummary(symbolId: string): Promise<{
    id: string;
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
  }> {
    return this.repository.getSymbolSummary(symbolId);
  }

  /**
   * Start a search run: build parameter spaces, configure generator, run it,
   * persist candidates, update status, emit events.
   *
   * @throws Error if SearchRun doesn't exist or generation fails unexpectedly.
   */
  public async start(input: { searchRunId: string; algorithm: string }): Promise<StartSearchResult> {
    const { searchRunId, algorithm } = input;

    const searchRun = await this.repository.getSearchRun(searchRunId);
    if (!searchRun) {
      throw new Error(`SearchRun ${searchRunId} not found`);
    }

    await this.repository.updateSearchRunStatus(searchRunId, "RUNNING", new Date());
    const t0 = Date.now();

    try {
      const registry = getStrategyRegistry();
      const strategyIds = registry.list();
      const spaces: ParameterSpace[] = [];

      for (const id of strategyIds) {
        const strategy = registry.resolve(id);
        if (!strategy) continue;
        const space = buildParameterSpace(strategy.id, strategy.parameterSpec);
        if (space !== null) {
          spaces.push(space);
        }
      }

      if (spaces.length === 0) {
        const msg = "No valid parameter spaces could be built from registered strategies";
        this.log.warn({ searchRunId }, msg);
        await this.repository.updateSearchRunStatus(searchRunId, "FAILED", undefined, new Date());
        this.eventBus.publish<SearchFailedEvent>("SearchFailed", { searchRunId, error: msg });
        return {
          searchRunId,
          generatorResult: {
            totalGenerated: 0,
            totalQueued: 0,
            totalRejected: 0,
            stoppedByCondition: false,
            stoppedByBackPressure: false,
            generationMs: 0,
          },
          stopReason: "NO_VALID_STRATEGIES",
        };
      }

      const generator = this.buildGenerator(algorithm, spaces);
      const onCandidate = this.buildOnCandidate(searchRunId);

      const state: SearchState = {
        generatedCount: 0,
        queuedCount: 0,
        rejectedCount: 0,
        elapsedMs: 0,
      };

      const shouldStop = anyStopCondition([
        (s: SearchState) => s.generatedCount >= searchRun.maxCandidates,
      ]);

      const result = await generator.generate(onCandidate, shouldStop, state);

      let stopReason: string;
      if (result.done) {
        if (result.result.stoppedByCondition) {
          stopReason = "MAX_CANDIDATES";
        } else if (result.result.stoppedByBackPressure) {
          stopReason = "BACK_PRESSURE";
        } else {
          stopReason = "COMPLETED";
        }
      } else {
        stopReason = "PARTIAL";
      }

      const elapsed = Date.now() - t0;
      const finalStatus: "DONE" | "STOPPED" =
        stopReason === "MAX_CANDIDATES" ||
        stopReason === "COMPLETED" ||
        stopReason === "PARTIAL"
          ? "DONE"
          : "STOPPED";

      await this.repository.updateSearchRunStatus(searchRunId, finalStatus, undefined, new Date());

      this.eventBus.publish<SearchCompletedEvent>("SearchCompleted", {
        searchRunId,
        totalGenerated: result.done ? result.result.totalGenerated : 0,
        totalQueued: result.done ? result.result.totalQueued : 0,
        totalRejected: result.done ? result.result.totalRejected : 0,
        generationMs: result.done ? result.result.generationMs : elapsed,
      });

      if (finalStatus === "STOPPED") {
        this.eventBus.publish<SearchStoppedEvent>("SearchStopped", {
          searchRunId,
          totalGenerated: result.done ? result.result.totalGenerated : 0,
          totalQueued: result.done ? result.result.totalQueued : 0,
          reason: stopReason,
        });
      }

      this.log.info(
        {
          searchRunId,
          reason: stopReason,
          totalGenerated: result.done ? result.result.totalGenerated : 0,
          totalQueued: result.done ? result.result.totalQueued : 0,
          elapsedMs: result.done ? result.result.generationMs : elapsed,
        },
        "search.service.completed",
      );

      return {
        searchRunId,
        generatorResult: result.done
          ? result.result
          : {
              totalGenerated: 0,
              totalQueued: 0,
              totalRejected: 0,
              stoppedByCondition: false,
              stoppedByBackPressure: false,
              generationMs: elapsed,
            },
        stopReason,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ err, searchRunId }, "search.service.start.error");
      await this.repository.updateSearchRunStatus(searchRunId, "FAILED", undefined, new Date(), error);
      this.eventBus.publish<SearchFailedEvent>("SearchFailed", { searchRunId, error });
      throw err;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────────

  /**
   * Build the appropriate generator for the given algorithm.
   *
   * We use top-level `import` to avoid module-resolution issues in tests.
   * Generator classes are always loaded regardless of algorithm choice — this
   * is acceptable since there are only 2 generators and they're tiny.
   */
  private buildGenerator(algorithm: string, spaces: ParameterSpace[]): StrategyGenerator {
    if (algorithm === "random") {
      const gen = new RandomGenerator();
      gen.spaces = spaces;
      return gen;
    }
    if (algorithm === "domain_guided") {
      const gen = new DomainGuidedGenerator();
      gen.spaces = spaces;
      return gen;
    }
    throw new Error(`Unknown algorithm: ${algorithm}`);
  }

  private buildOnCandidate(searchRunId: string): OnCandidate {
    return async (candidate: SearchCandidate): Promise<boolean> => {
      try {
        const versionInfo = await this.resolveCandidate(candidate);
        await this.repository.createCandidate({
          searchRunId,
          strategyVersionId: versionInfo.strategyVersionId,
          parameters: this.candidateParameters(candidate),
        });

        this.eventBus.publish<CandidateGeneratedEvent>("StrategyGenerated", {
          searchRunId,
          candidateId: candidate.candidateId,
          candidateType: candidate.candidateType,
          strategyId:
            candidate.candidateType === "BASE"
              ? (candidate as BaseCandidate).strategyId
              : (candidate as CompositeCandidate).config.id,
        });

        return true;
      } catch (err) {
        this.log.error(
          { err, searchRunId, candidateId: candidate.candidateId },
          "search.service.on-candidate.error",
        );
        return false;
      }
    };
  }

  private async resolveCandidate(
    candidate: SearchCandidate,
  ): Promise<{ strategyVersionId: string }> {
    if (candidate.candidateType === "BASE") {
      const base = candidate as BaseCandidate;
      const registry = getStrategyRegistry();
      const strategy = registry.resolve(base.strategyId);
      if (!strategy) {
        throw new Error(`Strategy ${base.strategyId} not found in registry`);
      }
      const info = await this.strategyVersionMapper.resolveBaseStrategy(
        strategy.id,
        strategy.name,
      );
      return { strategyVersionId: info.strategyVersionId };
    }
    const composite = candidate as CompositeCandidate;
    const info = await this.strategyVersionMapper.resolveCompositeStrategy(
      composite.config,
      composite.config.name,
    );
    return { strategyVersionId: info.strategyVersionId };
  }

  private candidateParameters(candidate: SearchCandidate): Record<string, unknown> {
    if (candidate.candidateType === "BASE") {
      return { ...(candidate as BaseCandidate).parameters };
    }
    // COMPOSITE: store the CombinationConfig as JSON parameters.
    // CombinationEngine reads `_config` at backtest time.
    const composite = candidate as CompositeCandidate;
    return {
      _candidateType: "COMPOSITE",
      _config: {
        id: composite.config.id,
        name: composite.config.name,
        components: composite.config.components.map((c) => ({
          strategyId: c.strategyId,
          weight: c.weight,
          position: c.position,
        })),
      },
    };
  }
}
