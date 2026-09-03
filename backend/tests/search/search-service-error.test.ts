/**
 * Error-propagation test for SearchService.
 *
 * Goal: ensure that a candidate resolution / persistence failure is
 * surfaced as a real SearchRun status FAILED with the error message,
 * NOT silently converted to totalQueued=0 with status DONE/STOPPED.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { SearchService } from "../../src/modules/search/application/SearchService";
import {
  bootstrapStrategies,
  resetStrategyRegistry,
} from "../../src/modules/strategy";
import type { SearchRepository, SearchRunRecord } from "../../src/modules/search/application/SearchRepository.port";
import type { StrategyVersionMapper } from "../../src/modules/search/application/StrategyVersionMapper";
import type { EventBus } from "../../src/shared/event-bus/EventBus";

function makeFakeRepo(initialStatus: "PENDING" | "RUNNING" | "DONE" | "STOPPED" | "FAILED" = "PENDING"): {
  repo: SearchRepository;
  status: () => string;
  error: () => string | undefined;
} {
  let status = initialStatus;
  let errorMsg: string | undefined;
  const runs = new Map<string, SearchRunRecord>();
  const repo: SearchRepository = {
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
    async updateSearchRunStatus(_id, next, _startedAt, _finishedAt, errMsg) {
      status = next;
      errorMsg = errMsg;
    },
    async createCandidate() {
      throw new Error("createCandidate should not be reached when resolve throws");
    },
    async getSearchRun(id) {
      return runs.get(id) ?? null;
    },
    async getCandidatesByRun() {
      return [];
    },
  };
  return { repo, status: () => status, error: () => errorMsg };
}

function makeBrokenCompositeMapper(): StrategyVersionMapper {
  return {
    async resolveBaseStrategy() {
      return { strategyVersionId: "x", definitionId: "x", definitionType: "BASE" };
    },
    async resolveCompositeStrategy() {
      throw new Error("no active version found for implementationRef \"strategy.broken\"");
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

describe("SearchService — candidate processing error handling (Step 5 fix)", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
  });

  it("a broken composite resolver causes the SearchRun to fail with FAILED status and the error message", async () => {
    const { repo, status, error } = makeFakeRepo();
    const eventBus = makeFakeEventBus();
    const service = new SearchService(
      repo,
      makeBrokenCompositeMapper(),
      undefined,
      eventBus,
    );

    const { searchRun } = await service.createSearchRun({
      algorithm: "domain_guided",
      algorithmId: "algo-001",
      symbolId: "sym-001",
      timeframe: "1h",
      maxCandidates: 5,
      generatorConfig: {
        familyGroups: [
          { name: "trend", families: ["TREND"] },
          { name: "momentum", families: ["MOMENTUM"] },
        ],
        mode: "EXHAUSTIVE",
      },
    });

    await expect(
      service.start({ searchRunId: searchRun.id, algorithm: "domain_guided" }),
    ).rejects.toThrow(/resolveCandidate\[0_0\]: COMPOSITE "strategy\.composite\.domain_guided\.0_0"/);

    expect(status()).toBe("FAILED");
    expect(error()).toMatch(/no active version found for implementationRef "strategy\.broken"/);

    // SearchFailed event was emitted.
    const calls = (eventBus.publish as ReturnType<typeof vi.fn>).mock.calls;
    const failed = calls.find((c: unknown[]) => c[0] === "SearchFailed");
    expect(failed).toBeDefined();
    expect(failed![1]).toMatchObject({ searchRunId: searchRun.id });
    expect((failed![1] as { error: string }).error).toMatch(/resolveCandidate/);
  });
});
