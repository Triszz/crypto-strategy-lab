/**
 * Unit tests for SearchRepository.port types and SearchRunStatus types.
 *
 * These test the domain/application-level types without requiring a database.
 * Integration tests with the actual Prisma repository would require a test DB.
 */
import { describe, it, expect } from "vitest";
import type {
  SearchRepository,
  SearchRunRecord,
  CandidateRecord,
  CreateSearchRunInput,
  CreateCandidateInput,
  SearchRunStatus,
  CandidateStatus,
} from "../../src/modules/search/application/SearchRepository.port";

describe("SearchRepository.port types", () => {
  it("SearchRunStatus includes all expected values", () => {
    const statuses: SearchRunStatus[] = ["PENDING", "RUNNING", "DONE", "STOPPED", "FAILED"];
    for (const s of statuses) {
      expect(s).toBeTruthy();
    }
  });

  it("CandidateStatus includes all expected values", () => {
    const statuses: CandidateStatus[] = [
      "PENDING",
      "QUEUED",
      "RUNNING",
      "DONE",
      "FAILED",
      "SKIPPED",
    ];
    for (const s of statuses) {
      expect(s).toBeTruthy();
    }
  });

  it("CreateSearchRunInput fields are optional as specified", () => {
    const input: CreateSearchRunInput = {
      algorithmId: "algo-001",
      symbolId: "sym-001",
      timeframe: "1h",
      maxCandidates: 100,
    };
    expect(input.algorithmId).toBe("algo-001");
    expect(input.fromTime).toBeUndefined();
    expect(input.toTime).toBeUndefined();
    expect(input.createdBy).toBeUndefined();
  });

  it("SearchRunRecord has correct readonly fields", () => {
    const record: SearchRunRecord = {
      id: "run-001",
      algorithmId: "algo-001",
      symbolId: "sym-001",
      timeframe: "4h",
      maxCandidates: 50,
      status: "RUNNING",
      config: {},
      createdAt: new Date(),
      startedAt: new Date(),
    };
    expect(record.id).toBe("run-001");
    expect(record.status).toBe("RUNNING");
  });

  it("CandidateRecord has correct readonly fields", () => {
    const record: CandidateRecord = {
      id: "cand-001",
      searchRunId: "run-001",
      strategyVersionId: "ver-001",
      parameters: { period: 14 },
      status: "PENDING",
      createdAt: new Date(),
    };
    expect(record.parameters).toEqual({ period: 14 });
    expect(record.status).toBe("PENDING");
  });
});

describe("SearchRepository interface", () => {
  it("is structurally compatible with a mock implementation", () => {
    // Verify the interface methods exist on a mock object
    const mock: SearchRepository = {
      async createSearchRun(input: CreateSearchRunInput): Promise<SearchRunRecord> {
        return {
          id: "r1",
          algorithmId: input.algorithmId,
          symbolId: input.symbolId,
          timeframe: input.timeframe,
          maxCandidates: input.maxCandidates,
          status: "PENDING",
          config: {},
          createdAt: new Date(),
        };
      },
      async updateSearchRunStatus() {},
      async createCandidate(input: CreateCandidateInput): Promise<CandidateRecord> {
        return {
          id: "c1",
          searchRunId: input.searchRunId,
          strategyVersionId: input.strategyVersionId,
          parameters: input.parameters,
          status: "PENDING",
          createdAt: new Date(),
        };
      },
      async getSearchRun() { return null; },
      async getCandidatesByRun() { return []; },
    };
    expect(typeof mock.createSearchRun).toBe("function");
    expect(typeof mock.updateSearchRunStatus).toBe("function");
    expect(typeof mock.createCandidate).toBe("function");
    expect(typeof mock.getSearchRun).toBe("function");
    expect(typeof mock.getCandidatesByRun).toBe("function");
  });
});
