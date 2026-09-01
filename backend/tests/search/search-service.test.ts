/**
 * Unit tests for SearchService.
 *
 * Uses a mock SearchRepository and StrategyVersionMapper so the service can be
 * tested without a database, but registers real strategies so that buildParameterSpace
 * works correctly in the service.
 */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { SearchRepository } from "../../src/modules/search/application/SearchRepository.port";
import type { StrategyVersionMapper } from "../../src/modules/search/application/StrategyVersionMapper";
import type { EventBus } from "../../src/shared/event-bus/EventBus";
import { SearchService } from "../../src/modules/search/application/SearchService";
import type { SearchRunRecord } from "../../src/modules/search/application/SearchRepository.port";
import { bootstrapStrategies, resetStrategyRegistry } from "../../src/modules/strategy";
import { MovingAverageStrategy } from "../../src/modules/strategy/strategies/MovingAverageStrategy";

// ─── Mock helpers ──────────────────────────────────────────────────────────────

function makeFakeRepo(): SearchRepository {
  const runs = new Map<string, SearchRunRecord>();
  return {
    async createSearchRun(input) {
      const run: SearchRunRecord = {
        id: `run-${Date.now()}`,
        algorithmId: input.algorithmId,
        symbolId: input.symbolId,
        timeframe: input.timeframe,
        maxCandidates: input.maxCandidates,
        status: "PENDING",
        config: input.config ?? {},
        createdAt: new Date(),
      };
      runs.set(run.id, run);
      return run;
    },
    async updateSearchRunStatus(id, status, startedAt, finishedAt) {
      const run = runs.get(id);
      if (run) {
        (run as SearchRunRecord).status = status;
        if (startedAt) (run as SearchRunRecord).startedAt = startedAt;
        if (finishedAt) (run as SearchRunRecord).finishedAt = finishedAt;
      }
    },
    async createCandidate() {
      return {
        id: `cand-${Date.now()}`,
        searchRunId: "run-001",
        strategyVersionId: "ver-001",
        parameters: {},
        status: "PENDING",
        createdAt: new Date(),
      };
    },
    async getSearchRun(id) {
      return runs.get(id) ?? null;
    },
    async getCandidatesByRun() {
      return [];
    },
  };
}

function makeFakeMapper(): StrategyVersionMapper {
  return {
    async resolveBaseStrategy() {
      return { strategyVersionId: "ver-base-001", definitionId: "def-001", definitionType: "BASE" };
    },
    async resolveCompositeStrategy() {
      return { strategyVersionId: "ver-comp-001", definitionId: "def-comp-001", definitionType: "COMPOSITE" };
    },
  };
}

function makeFakeEventBus(): EventBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    dispose: vi.fn(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SearchService", () => {
  let repo: SearchRepository;
  let mapper: StrategyVersionMapper;
  let eventBus: EventBus;
  let service: SearchService;

  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    repo = makeFakeRepo();
    mapper = makeFakeMapper();
    eventBus = makeFakeEventBus();
    service = new SearchService(repo, mapper, undefined, eventBus);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStrategyRegistry();
  });

  describe("createSearchRun", () => {
    it("creates a SearchRun in PENDING status", async () => {
      const result = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 50,
        createdBy: "user-1",
      });
      expect(result.searchRun.status).toBe("PENDING");
      expect(result.searchRun.maxCandidates).toBe(50);
    });

    it("persists the SearchRun via repository", async () => {
      const result = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1d",
        maxCandidates: 20,
      });
      const stored = await repo.getSearchRun(result.searchRun.id);
      expect(stored).not.toBeNull();
    });

    it("emits SearchStarted event", async () => {
      await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 10,
      });
      expect(eventBus.publish).toHaveBeenCalledWith(
        "SearchStarted",
        expect.objectContaining({ algorithm: "random" }),
      );
    });

    it("stores generatorConfig in the config field", async () => {
      const result = await service.createSearchRun({
        algorithm: "domain_guided",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 10,
        generatorConfig: { familyGroups: [{ name: "trend", families: ["TREND"] }] },
      });
      expect(result.searchRun.config).toHaveProperty("familyGroups");
    });
  });

  describe("getSearchRun", () => {
    it("returns null for unknown id", async () => {
      const result = await service.getSearchRun("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the stored search run", async () => {
      const created = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 10,
      });
      const result = await service.getSearchRun(created.searchRun.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.searchRun.id);
    });
  });

  describe("start", () => {
    it("throws when SearchRun does not exist", async () => {
      await expect(
        service.start({ searchRunId: "nonexistent", algorithm: "random" }),
      ).rejects.toThrow("not found");
    });

    it("updates status to RUNNING then DONE on normal completion", async () => {
      const { searchRun } = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 5,
      });
      await service.start({ searchRunId: searchRun.id, algorithm: "random" });
      const updated = await repo.getSearchRun(searchRun.id);
      expect(updated!.status).toBe("DONE");
    });

    it("emits SearchCompleted event on normal completion", async () => {
      const { searchRun } = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 5,
      });
      await service.start({ searchRunId: searchRun.id, algorithm: "random" });
      expect(eventBus.publish).toHaveBeenCalledWith(
        "SearchCompleted",
        expect.objectContaining({ searchRunId: searchRun.id }),
      );
    });

    it("emits StrategyGenerated events for each candidate", async () => {
      const { searchRun } = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 3,
      });
      await service.start({ searchRunId: searchRun.id, algorithm: "random" });
      const generatedCalls = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => call[0] === "StrategyGenerated",
      );
      expect(generatedCalls.length).toBeGreaterThan(0);
    });

    it("returns stopReason MAX_CANDIDATES when generator reaches max", async () => {
      const { searchRun } = await service.createSearchRun({
        algorithm: "random",
        algorithmId: "algo-001",
        symbolId: "sym-001",
        timeframe: "1h",
        maxCandidates: 100,
      });
      const result = await service.start({ searchRunId: searchRun.id, algorithm: "random" });
      expect(result.stopReason).toBe("MAX_CANDIDATES");
    });
  });
});
