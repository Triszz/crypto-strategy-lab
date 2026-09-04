/**
 * Tests for builtInStrategies.ts — the startup synchronization / dedup
 * logic for BASE StrategyVersions.
 *
 * These tests use an in-memory mock Prisma client to exercise every
 * branch of `syncBuiltInStrategies()` without touching the real database.
 *
 * What we are locking down here:
 *   1. BASE legacy StrategyVersions are detected and deduplicated.
 *   2. COMPOSITE StrategyVersions are NEVER touched by the DEDUP step.
 *   3. Legacy LeaderboardEntry rows with NO canonical duplicate are
 *      migrated to the canonical strategyVersionId.
 *   4. Legacy LeaderboardEntry rows WITH a canonical duplicate are
 *      deleted (the canonical row is preserved).
 *   5. Canonical LeaderboardEntry rows are NEVER deleted.
 *   6. Running the sync twice is idempotent (no P2002 on second run,
 *      no spurious migrations or deletions).
 *   7. CandidateStrategy / RankingHistory / CompositeComponent FK
 *      retargeting still works exactly as before.
 *   8. All four canonical built-in strategies (strategy.ma,
 *      strategy.rsi, strategy.bollinger, strategy.support_resistance)
 *      are upserted by the canonical step.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncBuiltInStrategies } from "../../src/modules/strategy/persistence/builtInStrategies";
import {
  bootstrapStrategies,
  BUILT_IN_STRATEGIES,
} from "../../src/modules/strategy/strategies/bootstrap";
import {
  resetStrategyRegistry,
} from "../../src/modules/strategy/domain/StrategyRegistry";

// ─── Mock Prisma ────────────────────────────────────────────────────────────

/** Minimal type for the bits of PrismaClient we exercise here. */
type MockPrisma = Parameters<typeof syncBuiltInStrategies>[0];

/** UUID-ish strings, deterministic for assertions. */
const u = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A row in our in-memory DB. */
interface DefinitionRow {
  id: string;
  type: "BASE" | "COMPOSITE";
  family: string;
  description: string | null;
}
interface VersionRow {
  id: string;
  definitionId: string;
  implementationRef: string;
  name: string;
  version: string;
  isActive: boolean;
}
interface LeaderboardRow {
  id: string;
  strategyVersionId: string;
  symbolId: string;
  timeframe: string;
  rank: number;
}
interface CandidateRow {
  id: string;
  strategyVersionId: string;
  status: string;
}
interface RankingHistoryRow {
  id: string;
  strategyVersionId: string;
}
interface CompositeComponentRow {
  id: string;
  compositeVersionId: string;
  componentVersionId: string;
  position: number;
}
interface RegistryRow {
  id: string;
  definitionId: string;
  isEnabled: boolean;
}

interface MockState {
  definitions: DefinitionRow[];
  versions: VersionRow[];
  leaderboard: LeaderboardRow[];
  candidates: CandidateRow[];
  ranking: RankingHistoryRow[];
  components: CompositeComponentRow[];
  registries: RegistryRow[];
}

function freshState(): MockState {
  return {
    definitions: [],
    versions: [],
    leaderboard: [],
    candidates: [],
    ranking: [],
    components: [],
    registries: [],
  };
}

function makeMockPrisma(state: MockState): MockPrisma {
  const matchesWhere = <T extends Record<string, unknown>>(
    row: T,
    where: Record<string, unknown> | undefined,
  ): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      const rowValue = (row as Record<string, unknown>)[k];

      // Operator filters first: { in: [...] }, { notIn: [...] }, { not: ... }
      if (
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v) &&
        ("in" in v || "notIn" in v || "not" in v)
      ) {
        const vObj = v as Record<string, unknown>;
        if ("not" in vObj) {
          if (matchesWhere({ _: rowValue } as Record<string, unknown>, { _: vObj["not"] } as Record<string, unknown>)) {
            return false;
          }
          continue;
        }
        if ("in" in vObj || "notIn" in vObj) {
          const arr = (vObj["in"] ?? vObj["notIn"]) as unknown[];
          const contains = arr.includes(rowValue);
          if ("notIn" in vObj && contains) return false;
          if ("in" in vObj && !contains) return false;
          continue;
        }
      }

      // Direct array filter — `{ field: [a, b] }` shorthand for `{ in: [...] }`
      if (Array.isArray(v)) {
        if (!v.includes(rowValue)) return false;
        continue;
      }

      // Nested object filter — recursive (e.g. { AND: [...], OR: [...] } are
      // handled separately in applyWhereToArray)
      if (typeof v === "object" && v !== null) {
        if (!matchesWhere(rowValue as Record<string, unknown>, v as Record<string, unknown>))
          return false;
        continue;
      }

      if (v === null && rowValue !== null) return false;
      if (v !== null && rowValue !== v) return false;
    }
    return true;
  };

  const applyWhereToArray = <T extends Record<string, unknown>>(
    rows: T[],
    where: Record<string, unknown> | undefined,
  ): T[] => {
    if (!where) return [...rows];
    const orClauses = (where as { OR?: unknown[] }).OR as unknown[] | undefined;
    if (Array.isArray(orClauses)) {
      // Apply non-OR conditions first, then intersect with OR match.
      const { OR: _ignore, ...restWhere } = where;
      const nonOrFiltered = applyWhereToArray(rows, restWhere);
      return nonOrFiltered.filter((row) =>
        orClauses.some((clause) => {
          if (typeof clause === "object" && clause !== null) {
            return matchesWhere(row, clause as Record<string, unknown>);
          }
          return false;
        }),
      );
    }
    return rows.filter((row) => matchesWhere(row, where));
  };

  return {
    strategyDefinition: {
      findMany: async () => [...state.definitions],
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        state.definitions.find((d) => d.id === id) ?? null,
      create: async ({ data }: { data: Partial<DefinitionRow> }) => {
        const row: DefinitionRow = {
          id: data.id ?? u(state.definitions.length + 1000),
          type: data.type ?? "BASE",
          family: data.family ?? "TREND",
          description: data.description ?? null,
        };
        state.definitions.push(row);
        return row;
      },
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<DefinitionRow>;
      }) => {
        const idx = state.definitions.findIndex((d) => d.id === id);
        if (idx === -1) throw new Error("not found");
        const cur = state.definitions[idx]!;
        const next: DefinitionRow = {
          ...cur,
          type: (data.type ?? cur.type) as DefinitionRow["type"],
          family: (data.family ?? cur.family) as string,
          description: data.description ?? cur.description,
        };
        state.definitions[idx] = next;
        return next;
      },
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        const idx = state.definitions.findIndex((d) => d.id === id);
        if (idx === -1) {
          const err = new Error("not found") as Error & { code?: string };
          err.code = "P2025";
          throw err;
        }
        state.definitions.splice(idx, 1);
        return state.definitions[idx];
      },
    },
    strategyVersion: {
      findMany: async ({ where, include }: { where?: Record<string, unknown>; include?: unknown }) => {
        let rows = [...state.versions];
        if (where) {
          // Handle relation filter `definition: { ... }` by pre-resolving
          // the matched definition ids and intersecting with the version set.
          const defFilter = where["definition"] as Record<string, unknown> | undefined;
          if (defFilter && typeof defFilter === "object") {
            const matchedDefs = state.definitions.filter((d) =>
              matchesWhere(d, defFilter),
            );
            const matchedDefIds = new Set(matchedDefs.map((d) => d.id));
            rows = rows.filter((v) => matchedDefIds.has(v.definitionId));
          }
          const { definition: _ignore, ...restWhere } = where;
          rows = applyWhereToArray(rows, restWhere);
        }
        if (include && typeof include === "object" && (include as { definition?: unknown }).definition) {
          return rows.map((v) => ({
            ...v,
            definition: state.definitions.find((d) => d.id === v.definitionId),
          }));
        }
        return rows;
      },
      findFirst: async ({ where, include }: { where?: Record<string, unknown>; include?: unknown }) => {
        let rows = [...state.versions];
        if (where) {
          const defFilter = where["definition"] as Record<string, unknown> | undefined;
          if (defFilter && typeof defFilter === "object") {
            const matchedDefs = state.definitions.filter((d) =>
              matchesWhere(d, defFilter),
            );
            const matchedDefIds = new Set(matchedDefs.map((d) => d.id));
            rows = rows.filter((v) => matchedDefIds.has(v.definitionId));
          }
          const { definition: _ignore2, ...restWhere } = where;
          rows = applyWhereToArray(rows, restWhere);
        }
        const first = rows[0];
        if (!first) return null;
        if (include && typeof include === "object" && (include as { definition?: unknown }).definition) {
          return {
            ...first,
            definition: state.definitions.find((d) => d.id === first.definitionId),
          };
        }
        return first;
      },
      create: async ({ data }: { data: Partial<VersionRow> }) => {
        const row: VersionRow = {
          id: data.id ?? u(state.versions.length + 2000),
          definitionId: data.definitionId ?? "",
          implementationRef: data.implementationRef ?? "",
          name: data.name ?? "",
          version: data.version ?? "1.0.0",
          isActive: data.isActive ?? true,
        };
        state.versions.push(row);
        return row;
      },
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<VersionRow>;
      }) => {
        const idx = state.versions.findIndex((v) => v.id === id);
        if (idx === -1) throw new Error("not found");
        const cur = state.versions[idx]!;
        const next: VersionRow = { ...cur, ...data };
        state.versions[idx] = next;
        return next;
      },
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        const idx = state.versions.findIndex((v) => v.id === id);
        if (idx === -1) {
          const err = new Error("not found") as Error & { code?: string };
          err.code = "P2025";
          throw err;
        }
        state.versions.splice(idx, 1);
        return state.versions[idx];
      },
    },
    strategyRegistry: {
      findUnique: async ({ where: { definitionId } }: { where: { definitionId: string } }) =>
        state.registries.find((r) => r.definitionId === definitionId) ?? null,
      create: async ({ data }: { data: Partial<RegistryRow> }) => {
        const row: RegistryRow = {
          id: data.id ?? u(state.registries.length + 3000),
          definitionId: data.definitionId ?? "",
          isEnabled: data.isEnabled ?? true,
        };
        state.registries.push(row);
        return row;
      },
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<RegistryRow>;
      }) => {
        const idx = state.registries.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        const cur = state.registries[idx]!;
        const next: RegistryRow = { ...cur, ...data };
        state.registries[idx] = next;
        return next;
      },
    },
    leaderboardEntry: {
      findMany: async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const rows = applyWhereToArray(state.leaderboard, where);
        if (select) {
          return rows.map((r) => {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(select)) {
              (out as Record<string, unknown>)[k] = (r as unknown as Record<string, unknown>)[k];
            }
            return out;
          });
        }
        return rows;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { strategyVersionId: string };
      }) => {
        const matches = applyWhereToArray(state.leaderboard, where);
        // Simulate P2002: if any matching row would produce a duplicate
        // (canonicalVersion already has entry on same symbol/timeframe),
        // throw P2002.
        for (const r of matches) {
          if (r.strategyVersionId === data.strategyVersionId) continue;
          const dup = state.leaderboard.find(
            (x) =>
              x.id !== r.id &&
              x.strategyVersionId === data.strategyVersionId &&
              x.symbolId === r.symbolId &&
              x.timeframe === r.timeframe,
          );
          if (dup) {
            const err = new Error("Unique constraint failed") as Error & { code?: string };
            err.code = "P2002";
            throw err;
          }
        }
        let count = 0;
        for (const r of matches) {
          r.strategyVersionId = data.strategyVersionId;
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const matches = applyWhereToArray(state.leaderboard, where);
        const idsToDelete = new Set(matches.map((r) => r.id));
        state.leaderboard = state.leaderboard.filter((r) => !idsToDelete.has(r.id));
        return { count: matches.length };
      },
    },
    candidateStrategy: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { strategyVersionId: string };
      }) => {
        const matches = applyWhereToArray(state.candidates, where);
        let count = 0;
        for (const r of matches) {
          r.strategyVersionId = data.strategyVersionId;
          count++;
        }
        return { count };
      },
    },
    rankingHistory: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { strategyVersionId: string };
      }) => {
        const matches = applyWhereToArray(state.ranking, where);
        let count = 0;
        for (const r of matches) {
          r.strategyVersionId = data.strategyVersionId;
          count++;
        }
        return { count };
      },
    },
    compositeComponent: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { componentVersionId?: string; compositeVersionId?: string };
      }) => {
        const matches = applyWhereToArray(state.components, where);
        let count = 0;
        for (const r of matches) {
          if (data.componentVersionId !== undefined) r.componentVersionId = data.componentVersionId;
          if (data.compositeVersionId !== undefined) r.compositeVersionId = data.compositeVersionId;
          count++;
        }
        return { count };
      },
    },
  } as unknown as MockPrisma;
}

// ─── Helpers to seed a fresh DB state for each scenario ─────────────────────

function seedBaseDefinitions(state: MockState): {
  maDefId: string;
  rsiDefId: string;
  bollDefId: string;
  srDefId: string;
  maVersionId: string;
  rsiVersionId: string;
  bollVersionId: string;
  srVersionId: string;
} {
  const maDefId = u(100);
  const rsiDefId = u(101);
  const bollDefId = u(102);
  const srDefId = u(103);
  const sentimentDefId = u(104);
  state.definitions.push(
    { id: maDefId, type: "BASE", family: "TREND", description: null },
    { id: rsiDefId, type: "BASE", family: "MOMENTUM", description: null },
    { id: bollDefId, type: "BASE", family: "VOLATILITY", description: null },
    { id: srDefId, type: "BASE", family: "STRUCTURE", description: null },
    { id: sentimentDefId, type: "BASE", family: "SENTIMENT", description: null },
  );
  const maVersionId = u(200);
  const rsiVersionId = u(201);
  const bollVersionId = u(202);
  const srVersionId = u(203);
  const sentimentVersionId = u(204);
  state.versions.push(
    {
      id: maVersionId,
      definitionId: maDefId,
      implementationRef: "strategy.ma",
      name: "Moving Average Crossover",
      version: "1.0.0",
      isActive: true,
    },
    {
      id: rsiVersionId,
      definitionId: rsiDefId,
      implementationRef: "strategy.rsi",
      name: "Relative Strength Index (Wilder)",
      version: "1.0.0",
      isActive: true,
    },
    {
      id: bollVersionId,
      definitionId: bollDefId,
      implementationRef: "strategy.bollinger",
      name: "Bollinger Bands",
      version: "1.0.0",
      isActive: true,
    },
    {
      id: srVersionId,
      definitionId: srDefId,
      implementationRef: "strategy.support_resistance",
      name: "Support / Resistance (MVP)",
      version: "1.0.0",
      isActive: true,
    },
    {
      id: sentimentVersionId,
      definitionId: sentimentDefId,
      implementationRef: "strategy.sentiment.news",
      name: "News Sentiment Strategy",
      version: "1.0.0",
      isActive: true,
    },
  );
  return { maDefId, rsiDefId, bollDefId, srDefId, sentimentDefId, maVersionId, rsiVersionId, bollVersionId, srVersionId, sentimentVersionId };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("syncBuiltInStrategies — DEDUP scope", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    // Suppress console noise from the sync
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("DETECTS a legacy BASE StrategyVersion and folds it onto its canonical target", async () => {
    const state = freshState();
    seedBaseDefinitions(state);
    // Legacy BASE version
    const legacyDefId = u(300);
    const legacyVersionId = u(400);
    state.definitions.push({
      id: legacyDefId,
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: legacyDefId,
      implementationRef: "Strategy.MACrossover",
      name: "MA Crossover",
      version: "1.0.0",
      isActive: true,
    });
    const prisma = makeMockPrisma(state);

    const report = await syncBuiltInStrategies(prisma);

    expect(report.dedupedRefs).toContain("Strategy.MACrossover");
    expect(state.versions.find((v) => v.id === legacyVersionId)).toBeUndefined();
    expect(state.definitions.find((d) => d.id === legacyDefId)).toBeUndefined();
  });

  it("DOES NOT detect COMPOSITE StrategyVersions as legacy (Fix A)", async () => {
    const state = freshState();
    seedBaseDefinitions(state);
    // COMPOSITE StrategyVersion + Definition — must be left untouched.
    const compositeDefId = u(500);
    const compositeVersionId = u(600);
    state.definitions.push({
      id: compositeDefId,
      type: "COMPOSITE",
      family: "TREND",
      description: "Domain-guided",
    });
    state.versions.push({
      id: compositeVersionId,
      definitionId: compositeDefId,
      implementationRef: "strategy.composite.domain_guided.0_0",
      name: "Domain-guided blend",
      version: "1.0.0",
      isActive: true,
    });
    const prisma = makeMockPrisma(state);

    const report = await syncBuiltInStrategies(prisma);

    expect(report.dedupedRefs).not.toContain("strategy.composite.domain_guided.0_0");
    // The COMPOSITE row must still exist verbatim.
    expect(state.versions.find((v) => v.id === compositeVersionId)).toBeDefined();
    expect(state.definitions.find((d) => d.id === compositeDefId)).toBeDefined();
    // No WARN must have fired for the COMPOSITE.
    const warnSpy = vi.spyOn(console, "warn");
    warnSpy.mockClear();
    await syncBuiltInStrategies(prisma);
    const compositeWarns = (warnSpy.mock.calls as unknown[][]).filter(
      (args) => typeof args[0] === "string" && args[0].includes("strategy.composite"),
    );
    expect(compositeWarns.length).toBe(0);
  });

  it("is generic: a future COMPOSITE with a custom implRef is also protected", async () => {
    const state = freshState();
    seedBaseDefinitions(state);
    // Hypothetical future COMPOSITE.
    state.definitions.push({
      id: u(700),
      type: "COMPOSITE",
      family: "MOMENTUM",
      description: null,
    });
    state.versions.push({
      id: u(800),
      definitionId: u(700),
      implementationRef: "strategy.composite.never.before.seen",
      name: "Future composite",
      version: "1.0.0",
      isActive: true,
    });
    const prisma = makeMockPrisma(state);

    const report = await syncBuiltInStrategies(prisma);

    expect(report.dedupedRefs).not.toContain("strategy.composite.never.before.seen");
    expect(state.versions.find((v) => v.id === u(800))).toBeDefined();
  });
});

describe("syncBuiltInStrategies — LeaderboardEntry collision handling (Fix B)", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("MIGRATES a legacy LeaderboardEntry when no canonical duplicate exists", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    // Legacy BASE MA — same TREND family as strategy.ma
    const legacyVersionId = u(900);
    state.definitions.push({
      id: u(901),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(901),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    // Legacy entry on a (symbol, timeframe) where canonical does NOT exist.
    state.leaderboard.push({
      id: u(950),
      strategyVersionId: legacyVersionId,
      symbolId: u(9500),
      timeframe: "5m",
      rank: 1,
    });
    const prisma = makeMockPrisma(state);

    await syncBuiltInStrategies(prisma);

    // The legacy entry must have been migrated to the canonical version.
    const migrated = state.leaderboard.find((e) => e.id === u(950));
    expect(migrated).toBeDefined();
    expect(migrated!.strategyVersionId).toBe(seed.maVersionId);
  });

  it("DELETES a legacy LeaderboardEntry when canonical duplicate exists (no P2002)", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(1000);
    state.definitions.push({
      id: u(1001),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(1001),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    const symbol = u(1100);
    // Canonical entry on BTCUSDT/5m
    state.leaderboard.push({
      id: u(1101),
      strategyVersionId: seed.maVersionId,
      symbolId: symbol,
      timeframe: "5m",
      rank: 1,
    });
    // Legacy entry ALSO on the same (symbol, timeframe) — would cause P2002
    state.leaderboard.push({
      id: u(1102),
      strategyVersionId: legacyVersionId,
      symbolId: symbol,
      timeframe: "5m",
      rank: 4,
    });
    // Legacy entry on a different (symbol, timeframe) — should be migrated
    state.leaderboard.push({
      id: u(1103),
      strategyVersionId: legacyVersionId,
      symbolId: u(1104),
      timeframe: "1h",
      rank: 2,
    });
    const prisma = makeMockPrisma(state);

    // This must NOT throw.
    await expect(syncBuiltInStrategies(prisma)).resolves.toBeDefined();

    // Canonical row preserved
    const canonical = state.leaderboard.find((e) => e.id === u(1101));
    expect(canonical).toBeDefined();
    expect(canonical!.strategyVersionId).toBe(seed.maVersionId);
    // Colliding legacy deleted
    expect(state.leaderboard.find((e) => e.id === u(1102))).toBeUndefined();
    // Non-colliding legacy migrated
    const migrated = state.leaderboard.find((e) => e.id === u(1103));
    expect(migrated).toBeDefined();
    expect(migrated!.strategyVersionId).toBe(seed.maVersionId);
  });

  it("NEVER deletes canonical LeaderboardEntry rows (canonical is always preserved)", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(1200);
    state.definitions.push({
      id: u(1201),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(1201),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    // Canonical rows across multiple (symbol, timeframe) pairs
    const canonicalRows = [
      { id: u(1210), symbol: u(1211), tf: "1h", rank: 1 },
      { id: u(1220), symbol: u(1221), tf: "5m", rank: 2 },
      { id: u(1230), symbol: u(1231), tf: "1d", rank: 3 },
      { id: u(1240), symbol: u(1241), tf: "4h", rank: 4 },
    ];
    for (const c of canonicalRows) {
      state.leaderboard.push({
        id: c.id,
        strategyVersionId: seed.maVersionId,
        symbolId: c.symbol,
        timeframe: c.tf,
        rank: c.rank,
      });
      // Each canonical row is mirrored by a legacy row at the same pair
      state.leaderboard.push({
        id: c.id.replace(/^0/, "9"),
        strategyVersionId: legacyVersionId,
        symbolId: c.symbol,
        timeframe: c.tf,
        rank: c.rank + 100,
      });
    }
    const prisma = makeMockPrisma(state);

    await syncBuiltInStrategies(prisma);

    // All four canonical rows must still exist.
    for (const c of canonicalRows) {
      const row = state.leaderboard.find((e) => e.id === c.id);
      expect(row, `canonical ${c.id} (${c.tf}) must survive`).toBeDefined();
      expect(row!.strategyVersionId).toBe(seed.maVersionId);
      expect(row!.rank).toBe(c.rank);
    }
  });
});

describe("syncBuiltInStrategies — idempotency", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("running twice is safe and produces a no-op report on the second run", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(2000);
    state.definitions.push({
      id: u(2001),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(2001),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    // Mixed leaderboard: collision + non-collision
    state.leaderboard.push(
      { id: u(2010), strategyVersionId: seed.maVersionId, symbolId: u(2011), timeframe: "5m", rank: 1 },
      { id: u(2012), strategyVersionId: legacyVersionId, symbolId: u(2011), timeframe: "5m", rank: 4 },
      { id: u(2013), strategyVersionId: legacyVersionId, symbolId: u(2014), timeframe: "1h", rank: 2 },
      { id: u(2015), strategyVersionId: legacyVersionId, symbolId: u(2016), timeframe: "4h", rank: 3 },
    );
    // Candidate + ranking rows tied to the legacy version
    state.candidates.push({ id: u(2020), strategyVersionId: legacyVersionId, status: "DONE" });
    state.ranking.push({ id: u(2021), strategyVersionId: legacyVersionId });
    const prisma = makeMockPrisma(state);

    const first = await syncBuiltInStrategies(prisma);
    expect(first.dedupedRefs).toContain("Strategy.MACrossover");

    // Snapshot state
    const leaderboardAfterFirst = JSON.parse(JSON.stringify(state.leaderboard));
    const candidateAfterFirst = JSON.parse(JSON.stringify(state.candidates));
    const rankingAfterFirst = JSON.parse(JSON.stringify(state.ranking));

    const second = await syncBuiltInStrategies(prisma);
    expect(second.dedupedRefs).toEqual([]);
    expect(second.upsertedRefs).toEqual([]);
    expect(second.removedLegacyDefinitions).toBe(0);

    expect(state.leaderboard).toEqual(leaderboardAfterFirst);
    expect(state.candidates).toEqual(candidateAfterFirst);
    expect(state.ranking).toEqual(rankingAfterFirst);
  });
});

describe("syncBuiltInStrategies — preserved dedup behaviour", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("REDIRECTS CandidateStrategy rows from legacy to canonical", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(3000);
    state.definitions.push({
      id: u(3001),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(3001),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    state.candidates.push({ id: u(3010), strategyVersionId: legacyVersionId, status: "DONE" });
    state.candidates.push({ id: u(3011), strategyVersionId: legacyVersionId, status: "PENDING" });
    const prisma = makeMockPrisma(state);

    await syncBuiltInStrategies(prisma);

    expect(state.candidates.find((c) => c.id === u(3010))!.strategyVersionId).toBe(seed.maVersionId);
    expect(state.candidates.find((c) => c.id === u(3011))!.strategyVersionId).toBe(seed.maVersionId);
  });

  it("REDIRECTS RankingHistory rows from legacy to canonical", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(3100);
    state.definitions.push({
      id: u(3101),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(3101),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    state.ranking.push({ id: u(3110), strategyVersionId: legacyVersionId });
    state.ranking.push({ id: u(3111), strategyVersionId: legacyVersionId });
    const prisma = makeMockPrisma(state);

    await syncBuiltInStrategies(prisma);

    expect(state.ranking.find((r) => r.id === u(3110))!.strategyVersionId).toBe(seed.maVersionId);
    expect(state.ranking.find((r) => r.id === u(3111))!.strategyVersionId).toBe(seed.maVersionId);
  });

  it("REDIRECTS CompositeComponent rows from legacy to canonical (component & composite sides)", async () => {
    const state = freshState();
    const seed = seedBaseDefinitions(state);
    const legacyVersionId = u(3200);
    state.definitions.push({
      id: u(3201),
      type: "BASE",
      family: "TREND",
      description: "Legacy",
    });
    state.versions.push({
      id: legacyVersionId,
      definitionId: u(3201),
      implementationRef: "Strategy.MACrossover",
      name: "Legacy MA",
      version: "1.0.0",
      isActive: true,
    });
    // Component side: legacy is the child of some composite
    state.components.push({
      id: u(3210),
      compositeVersionId: u(3211),
      componentVersionId: legacyVersionId,
      position: 0,
    });
    // Composite parent side: legacy is the composite itself — but legacy is
    // BASE so this is just an FK retarget exercise.
    state.components.push({
      id: u(3220),
      compositeVersionId: legacyVersionId,
      componentVersionId: seed.maVersionId,
      position: 1,
    });
    const prisma = makeMockPrisma(state);

    await syncBuiltInStrategies(prisma);

    expect(state.components.find((c) => c.id === u(3210))!.componentVersionId).toBe(seed.maVersionId);
    expect(state.components.find((c) => c.id === u(3220))!.compositeVersionId).toBe(seed.maVersionId);
  });
});

describe("syncBuiltInStrategies — canonical upsert", () => {
  beforeEach(() => {
    resetStrategyRegistry();
    bootstrapStrategies();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("UPSERTS all four canonical BASE strategies", async () => {
    const state = freshState();
    // Empty DB: nothing seeded.
    const prisma = makeMockPrisma(state);

    const report = await syncBuiltInStrategies(prisma);

    const upserted = new Set(report.upsertedRefs);
    expect(upserted.has("strategy.ma")).toBe(true);
    expect(upserted.has("strategy.rsi")).toBe(true);
    expect(upserted.has("strategy.bollinger")).toBe(true);
    expect(upserted.has("strategy.support_resistance")).toBe(true);
    expect(upserted.has("strategy.sentiment.news")).toBe(true);

    const allImplRefs = new Set(state.versions.map((v) => v.implementationRef));
    expect(allImplRefs.has("strategy.ma")).toBe(true);
    expect(allImplRefs.has("strategy.rsi")).toBe(true);
    expect(allImplRefs.has("strategy.bollinger")).toBe(true);
    expect(allImplRefs.has("strategy.support_resistance")).toBe(true);
    expect(allImplRefs.has("strategy.sentiment.news")).toBe(true);

    // Each canonical version must have type=BASE on its definition.
    for (const v of state.versions) {
      const def = state.definitions.find((d) => d.id === v.definitionId);
      expect(def?.type).toBe("BASE");
    }
  });

  it("does NOT re-upsert canonical versions that already exist", async () => {
    const state = freshState();
    seedBaseDefinitions(state);
    const prisma = makeMockPrisma(state);

    const report = await syncBuiltInStrategies(prisma);

    // No canonical version was newly created on this run.
    expect(report.upsertedRefs).toEqual([]);
    // Still exactly four canonical versions, all unique.
    const canonicalRefs = state.versions
      .map((v) => v.implementationRef)
      .filter((r) => BUILT_IN_STRATEGIES.some((b) => b.id === r));
    expect(canonicalRefs.length).toBe(BUILT_IN_STRATEGIES.length);
  });
});
