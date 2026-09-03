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
  };
  compositeComponent: {
    rows: CompositeComponentRow[];
    deleteMany: (args: any) => Promise<{ count: number }>;
    create: (args: any) => Promise<CompositeComponentRow>;
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
