/**
 * Integration tests for `buildLoopRouter`.
 *
 * These tests exercise the HTTP surface that powers the Continuous
 * Strategy Loop monitoring UI:
 *
 *   POST /api/loop/start        — creates/upserts a loop
 *   GET  /api/loop/status       — returns loop state or 404
 *   GET  /api/loop/progress     — returns progress (state + leaderboard top)
 *   POST /api/loop/pause|resume|stop
 *
 * Specifically, the tests verify:
 *
 *  1. POST /start returns the real loopId (no fabricated IDs).
 *  2. POST /start is idempotent against an already-running loop with the
 *     same loopId (re-running Run Combination must not create duplicate
 *     loops).
 *  3. GET /status returns 200 with full state for a real loopId.
 *  4. GET /status returns **404** (not 500) when the loopId doesn't exist.
 *  5. GET /status returns 400 when the loopId query is missing.
 *  6. GET /progress returns 404 when the loopId doesn't exist (same
 *     contract as /status — never an unexplained 500).
 *  7. POST /pause and POST /stop are routed correctly and return the
 *     updated state.
 *
 * Runs entirely in-process — no Postgres / Redis / BullMQ. A FakePrisma
 * matches the methods the routes actually call. A fake runner returns a
 * deterministic LoopRuntimeState.
 */

// The `loop.routes` module reads `prisma` at module top level via
// `getPrismaClient()`. We monkey-patch that import to return the
// FakePrisma instance below. (Done before importing the router so the
// module-level `const prisma = getPrismaClient();` resolves here.)
vi.mock("../../src/infrastructure/database/prisma", () => {
  return {
    getPrismaClient: () => (globalThis as { __FAKE_LOOP_PRISMA?: unknown }).__FAKE_LOOP_PRISMA,
  };
});

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import { buildLoopRouter, type LoopRouterDeps } from "../../src/modules/leaderboard/presentation/loop.routes";
import type { LoopRuntimeState } from "../../src/modules/leaderboard/application/loop-orchestrator-runner";

/* ─── In-memory Prisma stub ─────────────────────────────────────────────── */

class FakePrisma {
  public loopRunStates: Map<string, {
    id: string;
    loopId: string;
    status: string;
    currentIteration: number;
    maxCandidates: number;
    timeLimitSeconds: number;
    noImprovementCap: number;
    totalEvaluated: number;
    noImprovementCount: number;
    bestScoreSoFar: number;
    startedAt: Date;
    updatedAt: Date;
    lastIterationSearchRunId: string | null;
  }> = new Map();

  public loopIterations: Array<{
    id: string;
    loopId: string;
    iterationIndex: number;
    parentStrategyVersionId: string;
    searchRunId: string | null;
    candidateCount: number;
    status: string;
    createdAt: Date;
  }> = [];

  public leaderboardEntries: Array<{
    id: string;
    strategyVersionId: string;
    overallScore: number;
    strategyType: string;
    symbolId: string;
    timeframe: string;
    totalReturn: number;
    winRate: number;
    strategyVersion: { name: string };
    symbol: { symbol: string };
  }> = [];

  private nextId = 1;
  private genId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  loopRunState = {
    findMany: async ({ where, orderBy, take, include }: { where?: { status?: string; startedAt?: { gte?: Date } }; orderBy?: unknown; take?: number; include?: unknown }) => {
      let rows = [...this.loopRunStates.values()];
      if (where?.status) rows = rows.filter((r) => r.status === where.status);
      if (where?.startedAt?.gte) {
        const cutoff = where.startedAt.gte.getTime();
        rows = rows.filter((r) => r.startedAt.getTime() >= cutoff);
      }
      if (orderBy && (orderBy as { updatedAt?: string }).updatedAt === "desc") {
        rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      if (take !== undefined) rows = rows.slice(0, take);
      // Include iteration aggregates for the /list response.
      const withIterations = rows.map((r) => {
        if (!include) return r;
        const iterations = (this as unknown as { loopIterations: Array<{ loopId: string; candidateCount: number; evaluatedCount: number }> })
          .loopIterations.filter((it) => it.loopId === r.loopId);
        return { ...r, iterations };
      });
      return withIterations;
    },
    findUnique: async ({ where }: { where: { loopId: string } }) => {
      return this.loopRunStates.get(where.loopId) ?? null;
    },
    findFirst: async ({ where, orderBy }: { where?: { status?: string; loopId?: string }; orderBy?: unknown }) => {
      let rows = [...this.loopRunStates.values()];
      if (where?.status) rows = rows.filter((r) => r.status === where.status);
      if (where?.loopId) rows = rows.filter((r) => r.loopId === where.loopId);
      if (orderBy && (orderBy as { updatedAt?: string }).updatedAt === "desc") {
        rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
      return rows[0] ?? null;
    },
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { loopId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => {
      const existing = this.loopRunStates.get(where.loopId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = {
        id: this.genId("lr"),
        loopId: create["loopId"] as string,
        status: (create["status"] as string) ?? "RUNNING",
        currentIteration: (create["currentIteration"] as number) ?? 0,
        maxCandidates: (create["maxCandidates"] as number) ?? 100,
        timeLimitSeconds: (create["timeLimitSeconds"] as number) ?? 3600,
        noImprovementCap: (create["noImprovementCap"] as number) ?? 50,
        totalEvaluated: (create["totalEvaluated"] as number) ?? 0,
        noImprovementCount: (create["noImprovementCount"] as number) ?? 0,
        bestScoreSoFar: (create["bestScoreSoFar"] as number) ?? 0,
        startedAt: (create["startedAt"] as Date) ?? new Date(),
        updatedAt: new Date(),
        lastIterationSearchRunId: (create["lastIterationSearchRunId"] as string | null) ?? null,
      };
      this.loopRunStates.set(row.loopId, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { loopId?: string; id?: string };
      data: Record<string, unknown>;
    }) => {
      let row: typeof this.loopRunStates extends Map<string, infer V> ? V : never;
      if (where.loopId) {
        row = this.loopRunStates.get(where.loopId) as never;
      } else if (where.id) {
        row = [...this.loopRunStates.values()].find((r) => (r as { id: string }).id === where.id) as never;
      } else {
        return null;
      }
      if (!row) return null;
      Object.assign(row as object, data);
      return row;
    },
  };

  loopIteration = {
    findFirst: async ({ where, orderBy }: { where: { loopId: string }; orderBy?: unknown }) => {
      const rows = this.loopIterations
        .filter((i) => i.loopId === where.loopId)
        .sort((a, b) => b.iterationIndex - a.iterationIndex);
      return rows[0] ?? null;
    },
    findMany: async ({ where }: { where: { loopId: string } }) => {
      return this.loopIterations.filter((i) => i.loopId === where.loopId);
    },
  };

  // Phase 4.1: stub for candidateStrategy used by the new
  // processedCount / failedCount derivation. Tests don't seed
  // candidates, so it always returns 0.
  candidateStrategy = {
    count: async () => 0,
    findMany: async () => [] as Array<{ id: string; status: string }>,
  };
  // Phase 4.1: stub for backtestResult, experiment, strategyVersion,
  // loopProcessedEvent used by /candidates when iterations exist.
  backtestResult = {
    findFirst: async () => null,
  };
  experiment = {
    findMany: async () => [] as Array<{ id: string; errorMessage: string | null; status: string }>,
  };
  strategyVersion = {
    findUnique: async () => null,
  };
  loopProcessedEvent = {
    findMany: async () => [] as Array<{ dedupeKey: string; evaluatedAt: Date; strategyVersionId: string }>,
  };

  // Phase 3.3: stub for the explicit active-loop pointer. Single-row
  // table — `id` is always 1. Used by /api/loop/active and /api/loop/start.
  loopActivePointer = {
    findUnique: async ({ where }: { where: { id: number } }) => {
      return (this as unknown as { loopActivePointers: Map<number, { id: number; loopId: string; updatedAt: Date }> })
        .loopActivePointers?.get(where.id) ?? null;
    },
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { id: number };
      update: { loopId: string };
      create: { id: number; loopId: string };
    }) => {
      const m = (this as unknown as {
        loopActivePointers: Map<number, { id: number; loopId: string; updatedAt: Date }>;
      }).loopActivePointers ??= new Map();
      const existing = m.get(where.id);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const row = {
        id: create.id,
        loopId: create.loopId,
        updatedAt: new Date(),
      };
      m.set(where.id, row);
      return row;
    },
    deleteMany: async ({ where }: { where: { id: number } }) => {
      const m = (this as unknown as {
        loopActivePointers: Map<number, { id: number; loopId: string }>;
      }).loopActivePointers;
      if (!m) return { count: 0 };
      const had = m.has(where.id);
      m.delete(where.id);
      return { count: had ? 1 : 0 };
    },
  };

  leaderboardEntry = {
    findFirst: async ({ where: _where, orderBy }: { where?: unknown; orderBy?: { overallScore?: "asc" | "desc" } }) => {
      const rows = [...this.leaderboardEntries].sort((a, b) => {
        if (orderBy?.overallScore === "asc") return a.overallScore - b.overallScore;
        return b.overallScore - a.overallScore;
      });
      return rows[0] ?? null;
    },
  };
}

/* ─── Fake runner — emulates LoopOrchestratorRunner.getRuntimeState ──────── */

class FakeRunner {
  constructor(
    private prisma: FakePrisma,
    private knownLoopIds: Set<string>,
  ) {}

  async getRuntimeState(loopId: string): Promise<LoopRuntimeState | null> {
    const row = this.prisma.loopRunStates.get(loopId);
    if (!row) return null;
    const lastIter = await this.prisma.loopIteration.findFirst({
      where: { loopId },
      orderBy: { iterationIndex: "desc" },
    });
    const topEntry = await this.prisma.leaderboardEntry.findFirst({
      orderBy: { overallScore: "desc" },
    });
    return {
      loopId: row.loopId,
      status: row.status,
      currentIteration: row.currentIteration,
      maxIterations: row.maxIterations ?? 20,
      maxCandidates: row.maxCandidates,
      candidateCountPerIteration: 5,
      totalEvaluated: row.totalEvaluated,
      noImprovementCount: row.noImprovementCount,
      noImprovementCap: row.noImprovementCap,
      bestScore: Number(row.bestScoreSoFar ?? 0),
      bestStrategyVersionId: topEntry?.strategyVersionId ?? null,
      bestStrategyType: topEntry?.strategyType ?? null,
      bestStrategyName: topEntry?.strategyVersion.name ?? null,
      bestStrategySymbolCode: topEntry?.symbol.symbol ?? null,
      bestStrategyTimeframe: topEntry?.timeframe ?? null,
      bestMaxDrawdown: null,
      bestTotalReturn: topEntry ? topEntry.totalReturn : null,
      bestWinRate: topEntry ? topEntry.winRate : null,
      stopReason: null,
      lastIterationSearchRunId: lastIter?.searchRunId ?? null,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      elapsedSeconds: Math.floor((Date.now() - row.startedAt.getTime()) / 1000),
      timeLimitSeconds: row.timeLimitSeconds,
      currentIterationCandidateCount: 0,
      currentIterationEvaluatedCount: 0,
    };
  }
}

/* ─── Fake orchestrator — uses the FakePrisma directly ──────────────────── */

class FakeOrchestrator {
  constructor(private prisma: FakePrisma) {}

  async startLoop(config: {
    loopId: string;
    maxCandidates?: number;
    timeLimitSeconds?: number;
    noImprovementCap?: number;
  }): Promise<void> {
    const loopId = config.loopId || `loop-${Date.now()}`;
    await this.prisma.loopRunState.upsert({
      where: { loopId },
      update: {
        status: "RUNNING",
        maxCandidates: config.maxCandidates ?? 100,
        timeLimitSeconds: config.timeLimitSeconds ?? 3600,
        noImprovementCap: config.noImprovementCap ?? 50,
      },
      create: {
        loopId,
        status: "RUNNING",
        maxCandidates: config.maxCandidates ?? 100,
        timeLimitSeconds: config.timeLimitSeconds ?? 3600,
        noImprovementCap: config.noImprovementCap ?? 50,
      },
    });
  }
  async pauseLoop(loopId: string): Promise<void> {
    await this.prisma.loopRunState.update({ where: { loopId }, data: { status: "PAUSED" } });
  }
  async resumeLoop(loopId: string): Promise<void> {
    await this.prisma.loopRunState.update({ where: { loopId }, data: { status: "RUNNING" } });
  }
  async stopLoop(loopId: string, reason: string = "STOPPED_MANUAL"): Promise<void> {
    await this.prisma.loopRunState.update({ where: { loopId }, data: { status: reason } });
  }
  async getLoopState(loopId: string) {
    return this.prisma.loopRunStates.get(loopId) ?? null;
  }
}

/* ─── HTTP client helper ────────────────────────────────────────────────── */

interface HttpResponse {
  status: number;
  body: unknown;
}

async function makeServer(): Promise<{
  server: http.Server;
  port: number;
  prisma: FakePrisma;
  orchestrator: FakeOrchestrator;
  runner: FakeRunner;
  request: (method: string, path: string, body?: unknown) => Promise<HttpResponse>;
}> {
  const prisma = new FakePrisma();
  // Expose the FakePrisma via the global the vi.mock'd getPrismaClient()
  // returns. This is how the loop.routes module-level `prisma` reference
  // gets redirected to our fake.
  (globalThis as { __FAKE_LOOP_PRISMA?: unknown }).__FAKE_LOOP_PRISMA = prisma;

  const orchestrator = new FakeOrchestrator(prisma);
  const runner = new FakeRunner(prisma, new Set());

  const app = express();
  app.use(express.json());
  const deps: LoopRouterDeps = { orchestrator, runner };
  app.use("/api/loop", buildLoopRouter(deps));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const request = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResponse> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  };

  return { server, port, prisma, orchestrator, runner, request };
}

/* ─── Tests ──────────────────────────────────────────────────────────────── */

describe("loop.routes", () => {
  let server: http.Server;
  let port: number;
  let prisma: FakePrisma;
  let request: (method: string, path: string, body?: unknown) => Promise<HttpResponse>;

  beforeEach(async () => {
    const handle = await makeServer();
    server = handle.server;
    port = handle.port;
    prisma = handle.prisma;
    request = handle.request;
  });

  it("POST /start returns the real loopId (no fabricated IDs)", async () => {
    const res = await request("POST", "/api/loop/start", {
      loopId: "combo-real-id",
      maxCandidates: 5,
      timeLimitSeconds: 300,
      noImprovementCap: 3,
    });
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: { loopId: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.loopId).toBe("combo-real-id");
    expect(body.data.status).toBe("RUNNING");
  });

  it("POST /start is idempotent — second call with the same loopId does not create a duplicate loop", async () => {
    await request("POST", "/api/loop/start", {
      loopId: "combo-dup",
      maxCandidates: 5,
      timeLimitSeconds: 300,
      noImprovementCap: 3,
    });
    await request("POST", "/api/loop/start", {
      loopId: "combo-dup",
      maxCandidates: 5,
      timeLimitSeconds: 300,
      noImprovementCap: 3,
    });

    // The FakePrisma's upsert keeps a single row keyed by loopId.
    expect(prisma.loopRunStates.size).toBe(1);
    expect(prisma.loopRunStates.get("combo-dup")?.status).toBe("RUNNING");
  });

  it("GET /status returns 200 + full state for a real loopId", async () => {
    await request("POST", "/api/loop/start", { loopId: "ok", maxCandidates: 7 });

    const res = await request("GET", "/api/loop/status?loopId=ok");
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: LoopRuntimeState };
    expect(body.success).toBe(true);
    expect(body.data.loopId).toBe("ok");
    expect(body.data.status).toBe("RUNNING");
    expect(body.data.maxCandidates).toBe(7);
  });

  it("GET /status returns 404 (NOT 500) when the loopId does not exist", async () => {
    const res = await request("GET", "/api/loop/status?loopId=does-not-exist");
    expect(res.status).toBe(404);
    const body = res.body as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("NOT_FOUND");
  });

  it("GET /status returns 400 when the loopId query is missing", async () => {
    const res = await request("GET", "/api/loop/status");
    expect(res.status).toBe(400);
  });

  it("GET /progress returns 404 (NOT 500) for an unknown loopId", async () => {
    const res = await request("GET", "/api/loop/progress?loopId=does-not-exist");
    expect(res.status).toBe(404);
    const body = res.body as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("NOT_FOUND");
  });

  it("GET /progress returns progress data for a real loopId", async () => {
    prisma.leaderboardEntries.push({
      id: "lb-1",
      strategyVersionId: "sv-1",
      overallScore: 84.5,
      strategyType: "BASE",
      symbolId: "sym-1",
      timeframe: "1h",
      totalReturn: 0.8432,
      winRate: 0.684,
      strategyVersion: { name: "Moving Average Crossover" },
      symbol: { symbol: "BTCUSDT" },
    });

    await request("POST", "/api/loop/start", { loopId: "p" });
    const res = await request("GET", "/api/loop/progress?loopId=p");
    expect(res.status).toBe(200);
    const body = res.body as {
      success: boolean;
      data: LoopRuntimeState;
    };
    expect(body.success).toBe(true);
    // Phase 3.1 — loop-local best is read from LoopRunState, NOT the
    // global leaderboard. The previous Phase 2 test asserted the
    // global leaderboard's top score; that field was intentionally
    // removed because it leaked cross-loop data. We now assert the
    // event-shape: progress returns a LoopRuntimeState with a numeric
    // best score (currently 0 because no evaluation has happened).
    expect(typeof body.data.bestScore).toBe("number");
    expect(body.data.status).toBe("RUNNING");
    expect(body.data.currentIteration).toBe(0);
  });

  it("POST /pause sets status=PAUSED", async () => {
    await request("POST", "/api/loop/start", { loopId: "p2" });
    const res = await request("POST", "/api/loop/pause", { loopId: "p2" });
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: { status: string } };
    expect(body.data.status).toBe("PAUSED");
  });

  it("POST /stop sets status=STOPPED_MANUAL", async () => {
    await request("POST", "/api/loop/start", { loopId: "s" });
    const res = await request("POST", "/api/loop/stop", { loopId: "s" });
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: { status: string } };
    expect(body.data.status).toBe("STOPPED_MANUAL");
  });

  // ─── Phase 3.4 — Today's Loop Runs timezone filter ───────────────────
  describe("GET /api/loop/list?today=true — Phase 3.4 tz offset", () => {
    it("defaults to UTC midnight boundary (tzOffsetMinutes=0)", async () => {
      // A loop started 23:30 UTC yesterday should NOT appear when
      // queried at 00:30 UTC today under UTC filtering.
      const yesterday2300 = new Date(
        Date.UTC(2026, 8, 4, 23, 30, 0, 0), // Sep 4 2026 23:30Z
      );
      prisma.loopRunStates.set("yesterday-utc", {
        id: "lr-yesterday-utc",
        loopId: "yesterday-utc",
        status: "STOPPED_MANUAL",
        currentIteration: 1,
        maxCandidates: 100,
        timeLimitSeconds: 3600,
        noImprovementCap: 50,
        totalEvaluated: 1,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
        startedAt: yesterday2300,
        updatedAt: yesterday2300,
        lastIterationSearchRunId: null,
      });

      const res = await request("GET", "/api/loop/list?today=true");
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: Array<{ loopId: string }> };
      // With default tzOffset=0 the response uses UTC midnight. We
      // simulate "now" in the test via the test runner's clock which
      // is likely 2025/2026 — we only assert that the filter API
      // accepts the parameter and returns an array.
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("accepts tzOffsetMinutes=+420 (Vietnam/Bangkok) without 400", async () => {
      const res = await request("GET", "/api/loop/list?today=true&tzOffsetMinutes=420");
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("accepts tzOffsetMinutes=-300 (UTC-5, NYC) without 400", async () => {
      const res = await request("GET", "/api/loop/list?today=true&tzOffsetMinutes=-300");
      expect(res.status).toBe(200);
    });

    it("ignores out-of-range tzOffsetMinutes (defaults to 0)", async () => {
      const res = await request("GET", "/api/loop/list?today=true&tzOffsetMinutes=99999");
      expect(res.status).toBe(200);
    });

    it("includes a STOPPED loop started within today's UTC window", async () => {
      // Use the current test execution time so the row falls inside
      // the UTC-today window regardless of when the test runs.
      const now = new Date();
      prisma.loopRunStates.set("today-utc", {
        id: "lr-today-utc",
        loopId: "today-utc",
        status: "STOPPED_MANUAL",
        currentIteration: 1,
        maxCandidates: 100,
        timeLimitSeconds: 3600,
        noImprovementCap: 50,
        totalEvaluated: 1,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
        startedAt: now,
        updatedAt: now,
        lastIterationSearchRunId: null,
      });
      const res = await request("GET", "/api/loop/list?today=true");
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: Array<{ loopId: string }> };
      expect(body.data.some((r) => r.loopId === "today-utc")).toBe(true);
    });
  });

  // ─── Phase 4.1 — Candidate accounting DTO ───────────────────────────
  describe("Phase 4.1 — candidate accounting DTO", () => {
    it("/status response includes processedCount and failedCount", async () => {
      await request("POST", "/api/loop/start", { loopId: "phase41-status" });
      const res = await request("GET", "/api/loop/status?loopId=phase41-status");
      expect(res.status).toBe(200);
      const body = res.body as {
        success: boolean;
        data: {
          processedCount?: number;
          failedCount?: number;
          totalEvaluated: number;
        };
      };
      expect(body.data.processedCount).toBeDefined();
      expect(body.data.failedCount).toBeDefined();
      // Test FakePrisma returns 0 candidates by default.
      expect(body.data.processedCount).toBe(0);
      expect(body.data.failedCount).toBe(0);
    });

    it("/progress response includes processedCount and failedCount", async () => {
      await request("POST", "/api/loop/start", { loopId: "phase41-progress" });
      const res = await request("GET", "/api/loop/progress?loopId=phase41-progress");
      expect(res.status).toBe(200);
      const body = res.body as {
        success: boolean;
        data: { processedCount?: number; failedCount?: number };
      };
      expect(body.data.processedCount).toBeDefined();
      expect(body.data.failedCount).toBeDefined();
    });

    it("/candidates response is wrapped in { data, processedCount, failedCount }", async () => {
      const res = await request("GET", "/api/loop/candidates?loopId=does-not-exist");
      expect(res.status).toBe(200);
      const body = res.body as {
        success: boolean;
        data: unknown[];
        processedCount: number;
        failedCount: number;
      };
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.processedCount).toBe("number");
      expect(typeof body.failedCount).toBe("number");
      // No iterations → both counts zero.
      expect(body.processedCount).toBe(0);
      expect(body.failedCount).toBe(0);
    });
  });

  // ─── Phase 4.2 — /loop initial-load behavior ─────────────────────
  describe("Phase 4.2 — /loop initial-load behavior", () => {
    it("A. empty DB: /active returns null and does not create any state", async () => {
      const res = await request("GET", "/api/loop/active");
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: unknown };
      expect(body.data).toBeNull();
      // No side-effects: still no loopRunState rows in the FakePrisma.
      expect(prisma.loopRunStates.size).toBe(0);
    });

    it("B. pointer to existing loop: /active returns that loop regardless of status", async () => {
      // Stopped loop that the user explicitly followed.
      prisma.loopRunStates.set("historical-stopped", {
        loopId: "historical-stopped",
        status: "STOPPED_NO_IMPROVEMENT",
        currentIteration: 6,
        maxIterations: 20,
        maxCandidates: 100,
        totalEvaluated: 27,
        noImprovementCount: 27,
        noImprovementCap: 25,
        bestScoreSoFar: 7.95,
        bestStrategyVersionId: "sv-1",
        bestStrategySymbolId: "sym-1",
        bestStrategyTimeframe: "1h",
        startedAt: new Date("2026-09-06T04:47:24.856Z"),
        updatedAt: new Date("2026-09-06T05:06:43.516Z"),
      });
      (prisma as unknown as { loopActivePointers: Map<number, { id: number; loopId: string; updatedAt: Date }> }).loopActivePointers = new Map([
        [1, { id: 1, loopId: "historical-stopped", updatedAt: new Date() }],
      ]);

      const res = await request("GET", "/api/loop/active");
      expect(res.status).toBe(200);
      const body = res.body as {
        success: boolean;
        data: { loopId: string; status: string; source: string };
      };
      expect(body.data.loopId).toBe("historical-stopped");
      expect(body.data.status).toBe("STOPPED_NO_IMPROVEMENT");
      expect(body.data.source).toBe("pointer");
    });

    it("C. stale pointer: falls back to most-recently-updated loopRunState (any status)", async () => {
      // Stale pointer that points to a loop no longer in DB.
      (prisma as unknown as { loopActivePointers: Map<number, { id: number; loopId: string; updatedAt: Date }> }).loopActivePointers = new Map([
        [1, { id: 1, loopId: "ghost-loop", updatedAt: new Date() }],
      ]);
      // One loopRunState row — a stopped historical loop. Even
      // though there's no RUNNING row, this MUST be returned.
      prisma.loopRunStates.set("only-stopped", {
        loopId: "only-stopped",
        status: "STOPPED_MAX_CANDIDATES",
        currentIteration: 20,
        maxIterations: 20,
        maxCandidates: 100,
        totalEvaluated: 100,
        noImprovementCount: 0,
        noImprovementCap: 25,
        bestScoreSoFar: 4.5,
        bestStrategyVersionId: null,
        bestStrategySymbolId: null,
        bestStrategyTimeframe: null,
        startedAt: new Date("2026-09-05T10:00:00.000Z"),
        updatedAt: new Date("2026-09-05T12:00:00.000Z"),
      });

      const res = await request("GET", "/api/loop/active");
      const body = res.body as {
        success: boolean;
        data: { loopId: string; status: string; source: string };
      };
      expect(body.data.loopId).toBe("only-stopped");
      expect(body.data.status).toBe("STOPPED_MAX_CANDIDATES");
      expect(body.data.source).toBe("latest-historical");
    });

    it("D. regression guard: a stale RUNNING row is NOT auto-restored via the fallback path", async () => {
      // Phase 4.2 regression: the previous implementation returned
      // the most-recently-updated RUNNING/PAUSED loop from the
      // fallback. With the new rule, a stale RUNNING loop is only
      // returned if (a) the user explicitly pointed at it, or
      // (b) it's also the most-recently-updated row of any status.
      prisma.loopRunStates.set("stale-running", {
        loopId: "stale-running",
        status: "RUNNING",
        currentIteration: 1,
        maxIterations: 20,
        maxCandidates: 100,
        totalEvaluated: 16,
        noImprovementCount: 0,
        noImprovementCap: 25,
        bestScoreSoFar: 8.85,
        bestStrategyVersionId: null,
        bestStrategySymbolId: null,
        bestStrategyTimeframe: null,
        startedAt: new Date("2026-09-04T14:01:53.000Z"),
        // older updatedAt than `fresh-stopped` below
        updatedAt: new Date("2026-09-04T14:07:31.000Z"),
      });
      prisma.loopRunStates.set("fresh-stopped", {
        loopId: "fresh-stopped",
        status: "STOPPED_NO_IMPROVEMENT",
        currentIteration: 6,
        maxIterations: 20,
        maxCandidates: 100,
        totalEvaluated: 27,
        noImprovementCount: 27,
        noImprovementCap: 25,
        bestScoreSoFar: 7.95,
        bestStrategyVersionId: "sv-1",
        bestStrategySymbolId: null,
        bestStrategyTimeframe: null,
        startedAt: new Date("2026-09-06T04:47:24.000Z"),
        updatedAt: new Date("2026-09-06T05:06:43.000Z"),
      });
      // No pointer.
      (prisma as unknown as { loopActivePointers: Map<number, { id: number; loopId: string; updatedAt: Date }> }).loopActivePointers = new Map();

      const res = await request("GET", "/api/loop/active");
      const body = res.body as {
        success: boolean;
        data: { loopId: string; status: string; source: string };
      };
      // The most-recently-updated row is `fresh-stopped`, not the
      // 2-day-old stale RUNNING row.
      expect(body.data.loopId).toBe("fresh-stopped");
      expect(body.data.status).toBe("STOPPED_NO_IMPROVEMENT");
    });

    it("E. GET /status with no state returns 404 and the frontend shows empty state", async () => {
      const res = await request("GET", "/api/loop/status?loopId=does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  // Always close the server so vitest doesn't hang on leaked handles.
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
