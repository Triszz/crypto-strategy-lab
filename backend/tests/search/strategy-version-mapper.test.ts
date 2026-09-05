/**
 * Unit tests for StrategyVersionMapper — particularly the COMPOSITE path which
 * was previously broken by mixing runtime implementationRefs with UUID DB keys.
 *
 * Uses an in-memory mock Prisma client (no DB connection required).
 */
import { beforeEach, describe, it, expect } from "vitest";
import { StrategyVersionMapper } from "../../src/modules/search/application/StrategyVersionMapper";
import { CombinationOperator } from "../../src/modules/strategy/combination/CombinationConfig";
import type { CombinationConfig } from "../../src/modules/strategy/combination/CombinationConfig";

// ─── Minimal in-memory mock of PrismaClient ─────────────────────────────────

interface StrategyVersionRow {
  id: string;
  definitionId: string;
  implementationRef: string;
  name: string;
  isActive: boolean;
}
interface StrategyDefinitionRow {
  id: string;
  type: "BASE" | "COMPOSITE";
  family: string;
}
interface CompositeComponentRow {
  compositeVersionId: string;
  componentVersionId: string;
  weight: number;
  position: number;
}

interface FakePrisma {
  strategyDefinition: {
    rows: StrategyDefinitionRow[];
    findFirst: (args: any) => Promise<StrategyDefinitionRow | null>;
    findUnique: (args: any) => Promise<StrategyDefinitionRow | null>;
    create: (args: any) => Promise<StrategyDefinitionRow>;
  };
  strategyVersion: {
    rows: StrategyVersionRow[];
    findFirst: (args: any) => Promise<StrategyVersionRow | null>;
    findMany: (args: any) => Promise<StrategyVersionRow[]>;
    create: (args: any) => Promise<StrategyVersionRow>;
    update: (args: any) => Promise<StrategyVersionRow>;
  };
  compositeComponent: {
    rows: CompositeComponentRow[];
    deleteMany: (args: any) => Promise<{ count: number }>;
    create: (args: any) => Promise<CompositeComponentRow>;
    upsert: (args: any) => Promise<CompositeComponentRow>;
  };
  systemLog: {
    rows: Array<{ id: number; level: string; sourceModule: string; eventCode: string | null; message: string; context: unknown; createdAt: Date }>;
    nextId: number;
    create: (args: any) => Promise<{ id: number }>;
  };
  $transaction: <T>(fn: (tx: FakePrisma) => Promise<T>) => Promise<T>;
}

function uuid(i: number): string {
  // Deterministic 36-char UUID-shaped string for test assertions.
  const hex = (i + 0x100000000).toString(16).slice(1);
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(0, 3)}-a${hex.slice(0, 3)}-${hex.slice(0, 12).padEnd(12, "0")}`;
}

function makeFakePrisma(): FakePrisma {
  const defs: StrategyDefinitionRow[] = [];
  const versions: StrategyVersionRow[] = [];
  const comps: CompositeComponentRow[] = [];

  // Seed a BASE strategy version for `strategy.ma` so that COMPOSITE
  // resolution succeeds in finding its components.
  const baseDef: StrategyDefinitionRow = {
    id: uuid(1),
    type: "BASE",
    family: "TREND",
  };
  defs.push(baseDef);
  versions.push({
    id: uuid(2),
    definitionId: baseDef.id,
    implementationRef: "strategy.ma",
    name: "Moving Average Crossover",
    isActive: true,
  });

  // Seed another BASE strategy version for `strategy.rsi`.
  const baseDef2: StrategyDefinitionRow = {
    id: uuid(3),
    type: "BASE",
    family: "MOMENTUM",
  };
  defs.push(baseDef2);
  versions.push({
    id: uuid(4),
    definitionId: baseDef2.id,
    implementationRef: "strategy.rsi",
    name: "RSI",
    isActive: true,
  });

  const prisma: FakePrisma = {
    strategyDefinition: {
      rows: defs,
      async findFirst(args) {
        const where = args?.where ?? {};
        return defs.find((d) => {
          if (where.type && d.type !== where.type) return false;
          if (where.id && d.id !== where.id) return false;
          return true;
        }) ?? null;
      },
      async findUnique(args) {
        return defs.find((d) => d.id === args.where.id) ?? null;
      },
      async create(args) {
        const row: StrategyDefinitionRow = {
          id: uuid(defs.length + 100),
          type: args.data.type,
          family: args.data.family,
        };
        defs.push(row);
        return row;
      },
    },
    strategyVersion: {
      rows: versions,
      async findFirst(args) {
        const where = args?.where ?? {};
        const result = versions.find((v) => {
          if (where.implementationRef && v.implementationRef !== where.implementationRef) return false;
          if (where.isActive !== undefined && v.isActive !== where.isActive) return false;
          return true;
        }) ?? null;
        if (!result) return null;
        if (args?.include?.definition) {
          const def = defs.find((d) => d.id === result.definitionId);
          return { ...result, definition: def } as any;
        }
        return result;
      },
      async findMany(args) {
        const where = args?.where ?? {};
        return versions.filter((v) => {
          if (where.implementationRef && v.implementationRef !== where.implementationRef) return false;
          if (where.isActive !== undefined && v.isActive !== where.isActive) return false;
          if (where.definitionId && v.definitionId !== where.definitionId) return false;
          return true;
        });
      },
      async create(args) {
        const row: StrategyVersionRow = {
          id: uuid(versions.length + 200),
          definitionId: args.data.definitionId,
          implementationRef: args.data.implementationRef,
          name: args.data.name,
          isActive: args.data.isActive ?? true,
        };
        versions.push(row);
        return row;
      },
      async update(args) {
        const row = versions.find((v) => v.id === args.where.id);
        if (!row) throw new Error(`strategyVersion.update: not found ${args.where.id}`);
        if (args.data.name !== undefined) row.name = args.data.name;
        if (args.data.isActive !== undefined) row.isActive = args.data.isActive;
        return row;
      },
    },
    compositeComponent: {
      rows: comps,
      async deleteMany(args) {
        const where = args?.where ?? {};
        const before = comps.length;
        for (let i = comps.length - 1; i >= 0; i--) {
          const c = comps[i]!;
          if (where.compositeVersionId && c.compositeVersionId !== where.compositeVersionId) continue;
          comps.splice(i, 1);
        }
        return { count: before - comps.length };
      },
      async create(args) {
        const row: CompositeComponentRow = {
          compositeVersionId: args.data.compositeVersionId,
          componentVersionId: args.data.componentVersionId,
          weight: args.data.weight,
          position: args.data.position,
        };
        comps.push(row);
        return row;
      },
      async upsert(args) {
        const w = args.where;
        const existing = comps.find(
          (c) =>
            c.compositeVersionId === w.compositeVersionId_componentVersionId.compositeVersionId &&
            c.componentVersionId === w.compositeVersionId_componentVersionId.componentVersionId,
        );
        if (existing) {
          if (args.update.weight !== undefined) existing.weight = args.update.weight;
          if (args.update.position !== undefined) existing.position = args.update.position;
          return existing;
        }
        return this.create({ data: args.create });
      },
    },
    systemLog: {
      rows: [],
      nextId: 1,
      async create(args) {
        const row = {
          id: this.nextId++,
          level: args.data.level,
          sourceModule: args.data.sourceModule,
          eventCode: args.data.eventCode ?? null,
          message: args.data.message,
          context: args.data.context,
          createdAt: new Date(),
        };
        this.rows.push(row);
        return { id: row.id };
      },
    },
    async $transaction(fn) {
      return fn(prisma);
    },
  };

  return prisma;
}

describe("StrategyVersionMapper — COMPOSITE resolution (Step 3 fix)", () => {
  let prisma: FakePrisma;
  let mapper: StrategyVersionMapper;

  beforeEach(() => {
    prisma = makeFakePrisma();
    mapper = new StrategyVersionMapper(prisma as any);
  });

  it("creates a COMPOSITE definition + version + component rows from a stable non-UUID implementationRef", async () => {
    const config: CombinationConfig = {
      id: "strategy.composite.domain_guided.0_0",
      name: "Domain-guided TREND + MOMENTUM",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };

    const info = await mapper.resolveCompositeStrategy(config, "Domain-guided");

    expect(info.definitionType).toBe("COMPOSITE");
    expect(info.strategyVersionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(info.definitionId).toMatch(/^[0-9a-f-]{36}$/i);

    // Two CompositeComponent rows must have been created.
    const linked = prisma.compositeComponent.rows.filter(
      (r) => r.compositeVersionId === info.strategyVersionId,
    );
    expect(linked.length).toBe(2);
    expect(linked.find((r) => r.position === 0)).toBeDefined();
    expect(linked.find((r) => r.position === 1)).toBeDefined();
  });

  it("is idempotent: second call with the same config.id returns the existing version", async () => {
    const config: CombinationConfig = {
      id: "strategy.composite.domain_guided.0_1",
      name: "Idempotent Test",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };

    const first = await mapper.resolveCompositeStrategy(config, "Idempotent Test");
    const second = await mapper.resolveCompositeStrategy(config, "Idempotent Test");

    expect(second.strategyVersionId).toBe(first.strategyVersionId);
    expect(second.definitionId).toBe(first.definitionId);
  });

  it("does NOT use config.id as a UUID primary key (regression for the original bug)", async () => {
    const config: CombinationConfig = {
      id: "strategy.composite.domain_guided.99_99",
      name: "Key-mismatch regression",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };

    const info = await mapper.resolveCompositeStrategy(config, "Regression");

    // The returned versionId MUST be a UUID (auto-generated by Prisma),
    // NOT the runtime implementationRef from config.id.
    expect(info.strategyVersionId).not.toBe(config.id);
    expect(info.strategyVersionId).toMatch(/^[0-9a-f-]{36}$/i);

    // The implementationRef stored on the row must be the stable runtime ref.
    const stored = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    expect(stored).toBeDefined();
    expect(stored!.implementationRef).toBe(config.id);
  });

  it("throws a clear error when a component strategyId is not registered", async () => {
    const config: CombinationConfig = {
      id: "strategy.composite.bad.0_0",
      name: "Bad composite",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.does_not_exist", weight: 0.5, position: 0 },
      ],
    };

    await expect(mapper.resolveCompositeStrategy(config, "Bad")).rejects.toThrow(
      /no active version found for implementationRef "strategy\.does_not_exist"/,
    );
  });
});

describe("StrategyVersionMapper — BASE resolution", () => {
  it("creates a fresh StrategyDefinition + StrategyVersion for an unknown implementationRef", async () => {
    const prisma = makeFakePrisma();
    const mapper = new StrategyVersionMapper(prisma as any);
    const info = await mapper.resolveBaseStrategy("strategy.brand_new", "Brand New");
    expect(info.definitionType).toBe("BASE");
    expect(info.strategyVersionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(info.definitionId).toMatch(/^[0-9a-f-]{36}$/i);
    const stored = prisma.strategyVersion.rows.find((v) => v.id === info.strategyVersionId);
    expect(stored!.implementationRef).toBe("strategy.brand_new");
  });

  it("returns the existing version when implementationRef is already active", async () => {
    const prisma = makeFakePrisma();
    const mapper = new StrategyVersionMapper(prisma as any);
    const info = await mapper.resolveBaseStrategy("strategy.ma", "MA");
    // pre-seeded in makeFakePrisma
    expect(info.definitionType).toBe("BASE");
    expect(info.strategyVersionId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

// ─── Phase 3.4 — canonical-name regression suite ──────────────────────────
// These tests exercise the recursive-name bug reported in audit and prove
// that the new contract derives a stable, non-recursive display name from
// the actual composite components, regardless of how the caller labels the
// config.
describe("StrategyVersionMapper — Phase 3.4 canonical composite name", () => {
  let prisma: FakePrisma;
  let mapper: StrategyVersionMapper;

  beforeEach(() => {
    prisma = makeFakePrisma();
    mapper = new StrategyVersionMapper(prisma as any);
  });

  it("does NOT use a recursive prefix when bootstrapping a composite", async () => {
    // The generator in HybridLoopGenerator would pass a name like
    //   "Domain-guided bollinger + rsi → Bollinger Bands + RSI"
    // We expect the persisted name to be derived from the canonical
    // components instead (here: ma + rsi), NOT include any recursive
    // prefix the caller supplied.
    const config: CombinationConfig = {
      id: "strategy.composite.loop.0_0",
      name: "Domain-guided bollinger + rsi → Bollinger Bands + RSI",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };
    const info = await mapper.resolveCompositeStrategy(config, config.name);
    const stored = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    expect(stored).toBeDefined();
    expect(stored!.name).not.toContain("Domain-guided bollinger + rsi");
    // The persisted name should NOT contain any recursive prefix.
    expect(stored!.name).not.toMatch(/→/);
  });

  it("does NOT grow the persisted name across re-resolutions", async () => {
    // Iteration 1 bootstrap with a non-recursive caller name.
    const config: CombinationConfig = {
      id: "strategy.composite.loop.0_1",
      name: "Loop explore: ma + rsi",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };
    const info = await mapper.resolveCompositeStrategy(config, config.name);
    const stored = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    const nameAfterFirst = stored!.name;

    // Iteration 2: caller pretends to pass a recursive name where the
    // prefix is the previously-persisted name (the bug pattern).
    const recursiveName = `${nameAfterFirst} → Bollinger + RSI`;
    await mapper.resolveCompositeStrategy(config, recursiveName);

    const stored2 = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    expect(stored2!.name).toBe(nameAfterFirst);
    // Crucially, the persisted name must not contain `recursiveName`.
    expect(stored2!.name).not.toContain(recursiveName);
    expect(stored2!.name).not.toMatch(/→/);
  });

  it("preserves the executable composite definition across re-resolutions", async () => {
    const config: CombinationConfig = {
      id: "strategy.composite.loop.0_2",
      name: "Initial name",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.4, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.6, position: 1 },
      ],
    };
    const info = await mapper.resolveCompositeStrategy(config, config.name);

    const componentsAfterFirst = prisma.compositeComponent.rows
      .filter((r) => r.compositeVersionId === info.strategyVersionId)
      .map((r) => ({
        weight: r.weight,
        position: r.position,
      }));
    const stored1 = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    const implRefBefore = stored1!.implementationRef;

    // Iteration 2 with a mutated weight on component 0.
    await mapper.resolveCompositeStrategy(
      { ...config, components: [
        { strategyId: "strategy.ma", weight: 0.55, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.45, position: 1 },
      ] },
      "Recursive prefix → recursive suffix",
    );

    const componentsAfterSecond = prisma.compositeComponent.rows
      .filter((r) => r.compositeVersionId === info.strategyVersionId)
      .map((r) => ({
        weight: r.weight,
        position: r.position,
      }));

    // implementationRef MUST be unchanged — it is the lookup key.
    const stored2 = prisma.strategyVersion.rows.find(
      (v) => v.id === info.strategyVersionId,
    );
    expect(stored2!.implementationRef).toBe(implRefBefore);

    // Component rows are replaced (deleteMany + create) by
    // syncCompositeComponents. We assert the FINAL weights match the
    // second config exactly.
    expect(componentsAfterSecond.find((c) => c.position === 0)!.weight).toBeCloseTo(0.55, 5);
    expect(componentsAfterSecond.find((c) => c.position === 1)!.weight).toBeCloseTo(0.45, 5);

    // And the FIRST component snapshot must NOT equal the SECOND's
    // (otherwise the re-resolution did nothing).
    expect(componentsAfterFirst.find((c) => c.position === 0)!.weight).toBeCloseTo(0.4, 5);
    expect(componentsAfterFirst.find((c) => c.position === 1)!.weight).toBeCloseTo(0.6, 5);
  });
});

// ─── Phase 3.4 — getCanonicalCompositeDisplayName direct suite ────────────
import { getCanonicalCompositeDisplayName } from "../../src/modules/strategy/combination/CombinationConfig";
describe("getCanonicalCompositeDisplayName", () => {
  it("returns the same name for identical components regardless of caller name", () => {
    const a: CombinationConfig = {
      id: "strategy.composite.loop.A",
      name: "Long recursive caller name → suffix",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
      ],
    };
    const b: CombinationConfig = {
      ...a,
      id: "strategy.composite.loop.B",
      name: "Different caller name",
    };
    expect(getCanonicalCompositeDisplayName(a)).toBe(
      getCanonicalCompositeDisplayName(b),
    );
  });

  it("orders components by position", () => {
    const cfg: CombinationConfig = {
      id: "strategy.composite.loop.order",
      name: "x",
      operator: CombinationOperator.WEIGHTED,
      components: [
        { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
        { strategyId: "strategy.ma", weight: 0.5, position: 0 },
      ],
    };
    expect(getCanonicalCompositeDisplayName(cfg)).toMatch(/Moving Average.*RSI|ma.*rsi/);
  });
});
