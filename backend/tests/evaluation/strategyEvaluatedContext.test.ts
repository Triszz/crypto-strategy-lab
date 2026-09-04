/**
 * Phase 3 — `resolveStrategyEvaluatedContext` unit tests.
 *
 * Uses an in-memory mock PrismaClient to verify the
 * experiment → candidate → searchRun → loopIteration lookup chain
 * returns the correct loop ownership.
 */
import { describe, it, expect } from "vitest";
import { resolveStrategyEvaluatedContext } from "../../src/modules/evaluation/infrastructure/strategyEvaluatedContext";

type Row = {
  id: string;
  candidateId: string | null;
  searchRunId: string | null;
  loopId: string | null;
  iterationIndex: number | null;
};

class FakePrisma {
  private experiments = new Map<string, Row>();
  private candidates = new Map<string, Row>();
  private iterations: Row[] = [];

  public addExperiment(id: string, candidateId: string | null) {
    this.experiments.set(id, { id, candidateId, searchRunId: null, loopId: null, iterationIndex: null });
  }
  public addCandidate(id: string, searchRunId: string | null) {
    this.candidates.set(id, { id, candidateId: null, searchRunId, loopId: null, iterationIndex: null });
  }
  public addIteration(searchRunId: string, loopId: string, idx: number) {
    this.iterations.push({ id: `iter-${this.iterations.length}`, candidateId: null, searchRunId, loopId, iterationIndex: idx });
  }

  // Prisma method shapes
  public experiment = {
    findUnique: async ({ where }: { where: { id: string } }) => this.experiments.get(where.id) ?? null,
  };
  public candidateStrategy = {
    findUnique: async ({ where }: { where: { id: string } }) => this.candidates.get(where.id) ?? null,
  };
  public loopIteration = {
    findFirst: async ({ where }: { where: { searchRunId: string }; orderBy: unknown }) => {
      return this.iterations.find((r) => r.searchRunId === where.searchRunId) ?? null;
    },
  };
}

describe("resolveStrategyEvaluatedContext (Phase 3)", () => {
  it("returns null ownership when experiment is missing", async () => {
    const p = new FakePrisma();
    const ctx = await resolveStrategyEvaluatedContext(p as never, "missing-exp");
    expect(ctx).toEqual({
      experimentId: "missing-exp",
      candidateId: null,
      searchRunId: null,
      loopId: null,
      iterationIndex: null,
    });
  });

  it("returns null ownership when candidate is missing", async () => {
    const p = new FakePrisma();
    p.addExperiment("exp-1", null);
    const ctx = await resolveStrategyEvaluatedContext(p as never, "exp-1");
    expect(ctx.experimentId).toBe("exp-1");
    expect(ctx.candidateId).toBeNull();
    expect(ctx.loopId).toBeNull();
  });

  it("returns searchRunId when candidate exists but no loop iteration", async () => {
    const p = new FakePrisma();
    p.addExperiment("exp-1", "cand-1");
    p.addCandidate("cand-1", "search-1");
    const ctx = await resolveStrategyEvaluatedContext(p as never, "exp-1");
    expect(ctx.candidateId).toBe("cand-1");
    expect(ctx.searchRunId).toBe("search-1");
    expect(ctx.loopId).toBeNull();
  });

  it("returns full ownership when loop iteration matches searchRunId", async () => {
    const p = new FakePrisma();
    p.addExperiment("exp-1", "cand-1");
    p.addCandidate("cand-1", "search-1");
    p.addIteration("search-1", "loop-A", 1);
    const ctx = await resolveStrategyEvaluatedContext(p as never, "exp-1");
    expect(ctx.candidateId).toBe("cand-1");
    expect(ctx.searchRunId).toBe("search-1");
    expect(ctx.loopId).toBe("loop-A");
    expect(ctx.iterationIndex).toBe(1);
  });

  it("returns null loopId when iteration lookup fails (orphan SearchRun)", async () => {
    const p = new FakePrisma();
    p.addExperiment("exp-1", "cand-1");
    p.addCandidate("cand-1", "search-orphan");
    const ctx = await resolveStrategyEvaluatedContext(p as never, "exp-1");
    expect(ctx.searchRunId).toBe("search-orphan");
    expect(ctx.loopId).toBeNull();
    expect(ctx.iterationIndex).toBeNull();
  });
});
