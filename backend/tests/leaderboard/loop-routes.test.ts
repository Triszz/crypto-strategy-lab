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
    findMany: async ({ where, orderBy, take }: { where?: { status?: string }; orderBy?: unknown; take?: number }) => {
      let rows = [...this.loopRunStates.values()];
      if (where?.status) rows = rows.filter((r) => r.status === where.status);
      if (take !== undefined) rows = rows.slice(0, take);
      return rows;
    },
    findUnique: async ({ where }: { where: { loopId: string } }) => {
      return this.loopRunStates.get(where.loopId) ?? null;
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
      maxIterations: row.maxCandidates,
      maxCandidates: row.maxCandidates,
      totalEvaluated: row.totalEvaluated,
      noImprovementCount: row.noImprovementCount,
      noImprovementCap: row.noImprovementCap,
      bestScoreSoFar: Number(row.bestScoreSoFar),
      bestStrategyVersionId: topEntry?.strategyVersionId ?? null,
      bestStrategyType: topEntry?.strategyType ?? null,
      bestStrategyName: topEntry?.strategyVersion.name ?? null,
      bestStrategySymbolCode: topEntry?.symbol.symbol ?? null,
      bestStrategyTimeframe: topEntry?.timeframe ?? null,
      bestTotalReturn: topEntry ? topEntry.totalReturn : null,
      bestWinRate: topEntry ? topEntry.winRate : null,
      lastIterationSearchRunId: lastIter?.searchRunId ?? null,
      startedAt: row.startedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      elapsedSeconds: Math.floor((Date.now() - row.startedAt.getTime()) / 1000),
      timeLimitSeconds: row.timeLimitSeconds,
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
      data: LoopRuntimeState & {
        leaderboardTopScore: number | null;
        bestStrategyName: string | null;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.leaderboardTopScore).toBe(84.5);
    expect(body.data.bestStrategyName).toBe("Moving Average Crossover");
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

  // Always close the server so vitest doesn't hang on leaked handles.
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
