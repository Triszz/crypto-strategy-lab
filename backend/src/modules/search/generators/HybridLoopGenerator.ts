/**
 * search · generators · HybridLoopGenerator
 *
 * Produces candidates for a single iteration of the Continuous
 * Strategy Loop. Replaces the previous mutation-only `LoopMutationGenerator`
 * with three generation modes configurable per-loop:
 *
 *   - Mutation      — perturb the parent's parameters / weights
 *   - Crossover     — combine parameter sets from the parent and an
 *                     elite mate
 *   - Exploration   — pick a fresh family from the StrategyRegistry
 *                     and seed parameters at random
 *
 * The split is configured by `mutationRatio`, `crossoverRatio` and
 * `explorationRatio` (default 0.4 / 0.2 / 0.4). The generator always
 * produces EXACTLY `candidateCount` candidates per iteration (the
 * caller is responsible for that count, the generator will fill any
 * remainder by redistributing the largest bucket).
 *
 * Total candidates per iteration:
 *
 *   mutation = round(candidateCount * mutationRatio)
 *   crossover = round(candidateCount * crossoverRatio)
 *   exploration = candidateCount - mutation - crossover
 *
 * Invariants:
 *
 *   - The parent itself is NEVER re-emitted. It is the SEED only.
 *   - All candidates are validated against the existing
 *     CombinationConfig validator (composites) or the strategy's
 *     parameter spec (BASE).
 *   - No strategy business logic is duplicated — all parameter
 *     mutations look up the live `StrategyRegistry` parameter spec.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ,
 * no Socket.IO. Pure math + Strategy parameter specs.
 */
import type {
  StrategyGenerator,
  GeneratorRunResult,
  OnCandidate,
} from "../domain/StrategyGenerator";
import { resolveOnCandidate } from "../domain/StrategyGenerator";
import type { ParameterSpace, ParameterSpaceField } from "../domain/ParameterSpace";
import type { StopCondition, SearchState } from "../domain/StopCondition";
import type {
  SearchCandidate,
} from "../domain/SearchCandidate";
import { formatCandidateId } from "../domain/SearchCandidate";
import {
  validateCombinationConfig,
  CombinationOperator,
  type CombinationConfig,
  type CombinationComponent,
} from "../../strategy/combination/CombinationConfig";
import type { StrategyRegistry } from "../../strategy/domain/StrategyRegistry";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";

/** Mirrors `LoopMutationGenerator`'s parent shape for backward compat. */
export type ParentStrategy =
  | {
      readonly type: "BASE";
      readonly strategyId: string;
      readonly parameters: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "COMPOSITE";
      readonly config: CombinationConfig;
    };

/** Elite mate shape used for crossover. Optional. */
export type EliteMate =
  | ParentStrategy
  | undefined;

/** Runtime config supplied by the orchestrator runner. */
export interface HybridLoopConfig {
  readonly parent: ParentStrategy;
  /** Total number of candidates to produce. Required. */
  readonly candidateCount: number;
  /** Mutation share (default 0.4). */
  readonly mutationRatio?: number;
  /** Crossover share (default 0.2). May be 0 when no elite is supplied. */
  readonly crossoverRatio?: number;
  /** Exploration share (default 0.4). */
  readonly explorationRatio?: number;
  /** Optional mate for crossover candidates. */
  readonly eliteMate?: EliteMate;
  /** Optional pool of all available elite strategies (for exploration). */
  readonly elitePool?: ReadonlyArray<ParentStrategy>;
  /** Maximum fractional change for weight perturbation (default 0.1). */
  readonly weightPerturbationRatio?: number;
  /** Deterministic seed. */
  readonly randomSeed?: number;
}

export const HYBRID_LOOP_GENERATOR_ID = "loop_hybrid";

/* ─── Tiny seeded RNG (mulberry32) ────────────────────────────────────── */

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToInt(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/* ─── Parameter helpers (shared with LoopMutationGenerator semantics) ── */

function buildSpaceFromRegistry(
  registry: StrategyRegistry,
  strategyId: string,
): ParameterSpace | null {
  const strategy = registry.resolve(strategyId);
  if (!strategy) return null;
  const spec = strategy.parameterSpec;
  const fields: ParameterSpaceField[] = [];
  let totalGridPoints = 1;
  for (const f of spec.fields) {    if (f.kind === "integer") {
      if (f.min === undefined || f.max === undefined) continue;
      const cnt = Math.floor(f.max) - Math.ceil(f.min) + 1;
      if (cnt <= 0) continue;
      totalGridPoints *= cnt;
      fields.push({
        key: f.key,
        kind: "integer",
        min: f.min,
        max: f.max,
        defaultValue: f.default,
      });
    } else if (f.kind === "decimal") {
      if (f.min === undefined || f.max === undefined) continue;
      totalGridPoints = Infinity;
      fields.push({
        key: f.key,
        kind: "decimal",
        min: f.min,
        max: f.max,
        defaultValue: f.default,
      });
    } else if (f.kind === "enum") {
      const vals = (f as unknown as { enumValues?: ReadonlyArray<string> }).enumValues ?? [];
      if (vals.length === 0) continue;
      totalGridPoints *= vals.length;
      fields.push({
        key: f.key,
        kind: "enum",
        values: vals,
        defaultValue: f.default as string,
      });
    }
  }
  if (fields.length === 0) return null;
  return { strategyId, fields, totalGridPoints };
}

function mutateField(
  field: ParameterSpaceField,
  currentValue: number | string,
  rng: () => number,
): number | string {
  switch (field.kind) {
    case "integer": {
      const lo = field.min!;
      const hi = field.max!;
      const cur =
        typeof currentValue === "number" && Number.isInteger(currentValue)
          ? currentValue
          : Math.round((lo + hi) / 2);
      const span = Math.max(1, hi - lo);
      const step = Math.max(1, Math.round(span * 0.3));
      const offset = Math.round((rng() * 2 - 1) * step);
      return clamp(cur + offset, lo, hi);
    }
    case "decimal": {
      const lo = field.min!;
      const hi = field.max!;
      const cur =
        typeof currentValue === "number" && Number.isFinite(currentValue)
          ? currentValue
          : (lo + hi) / 2;
      const span = hi - lo;
      const off = (rng() * 2 - 1) * span * 0.3;
      return clamp(cur + off, lo, hi);
    }
    case "enum": {
      const values = field.values!;
      if (values.length <= 1) return values[0]!;
      let idx = values.indexOf(currentValue as string);
      if (idx < 0) idx = 0;
      const direction = rng() < 0.5 ? -1 : 1;
      return values[(idx + direction + values.length) % values.length]!;
    }
  }
}

function randomFieldValue(
  field: ParameterSpaceField,
  rng: () => number,
): number | string {
  switch (field.kind) {
    case "integer": {
      const lo = field.min!;
      const hi = field.max!;
      return clamp(Math.floor(lo + rng() * (hi - lo + 1)), lo, hi);
    }
    case "decimal": {
      const lo = field.min!;
      const hi = field.max!;
      return lo + rng() * (hi - lo);
    }
    case "enum": {
      const values = field.values!;
      if (values.length === 0) return "";
      return values[Math.floor(rng() * values.length)]!;
    }
  }
}

function mutateParameters(
  space: ParameterSpace,
  currentParams: Readonly<Record<string, unknown>>,
  rng: () => number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of space.fields) {
    const cur = currentParams[field.key];
    out[field.key] =
      cur === undefined || cur === null
        ? field.defaultValue
        : mutateField(field, cur as number | string, rng);
  }
  return out;
}

/** Crossover: take field-by-field one half from each parent (uniform). */
function crossoverParameters(
  space: ParameterSpace,
  parentA: Readonly<Record<string, unknown>>,
  parentB: Readonly<Record<string, unknown>>,
  rng: () => number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of space.fields) {
    const fromA = rng() < 0.5;
    const chosen = fromA ? parentA[field.key] : parentB[field.key];
    if (chosen === undefined || chosen === null) {
      out[field.key] = randomFieldValue(field, rng);
    } else {
      // Clamp chosen to space bounds to avoid drift.
      out[field.key] = mutateField(field, chosen as number | string, rng);
    }
  }
  return out;
}

function randomParameters(
  space: ParameterSpace,
  rng: () => number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of space.fields) {
    out[field.key] = randomFieldValue(field, rng);
  }
  return out;
}

/* ─── Candidate builders ─────────────────────────────────────────────── */

function mutateBaseCandidate(
  parent: { type: "BASE"; strategyId: string; parameters: Readonly<Record<string, unknown>> },
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate {
  const space = buildSpaceFromRegistry(registry, parent.strategyId);
  const params = space ? mutateParameters(space, parent.parameters, rng) : { ...parent.parameters };
  return {
    candidateType: "BASE",
    candidateId,
    strategyId: parent.strategyId,
    parameters: params,
  };
}

function mutateCompositeCandidate(
  parentConfig: CombinationConfig,
  candidateId: string,
  weightRatio: number,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  const rawWeights = parentConfig.components.map((c) =>
    clamp(c.weight * (1 + (rng() * 2 - 1) * weightRatio), 0, 1),
  );
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const normWeights = rawWeights.map((w) => w / weightSum);

  const components: CombinationComponent[] = parentConfig.components.map((c, idx) => {
    const space = buildSpaceFromRegistry(registry, c.strategyId);
    const newParams = space
      ? mutateParameters(space, c.parameters ?? {}, rng)
      : c.parameters
        ? { ...c.parameters }
        : {};
    return {
      strategyId: c.strategyId,
      weight: normWeights[idx]!,
      position: c.position,
      ...(Object.keys(newParams).length > 0 ? { parameters: newParams } : {}),
    };
  });

  // Phase 3.3: derive a meaningful name from the actual components so
  // the Candidate History UI doesn't show "Loop explore 0_3" style
  // generic labels. We keep the parent's semantic prefix so the user
  // sees this is a mutation of e.g. their "combo-bollinger-ma-rsi".
  // Use the strategy registry's `name` field when available, falling
  // back to a stripped implementationRef (e.g. "strategy.ma" → "ma").
  const componentNames = components.map((c) =>
    registry.resolve(c.strategyId)?.name ?? c.strategyId.replace(/^strategy\./, ""),
  );
  const newConfig: CombinationConfig = {
    id: `strategy.composite.loop.${candidateId}`,
    name: `${parentConfig.name} → ${componentNames.join(" + ")}`,
    components,
    operator: parentConfig.operator ?? CombinationOperator.WEIGHTED,
  };

  if (!validateCombinationConfig(newConfig).ok) return null;
  return {
    candidateType: "COMPOSITE",
    candidateId,
    config: newConfig,
  };
}

/**
 * Crossover for two BASE parents. Returns null if either is COMPOSITE.
 */
function crossoverBaseCandidates(
  parentA: ParentStrategy,
  parentB: ParentStrategy,
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  if (parentA.type !== "BASE" || parentB.type !== "BASE") return null;
  if (parentA.strategyId !== parentB.strategyId) {
    // Cross-strategy BASE crossover: keep strategyId from A and use a
    // uniform crossover of parameters sampled in A's space.
    const space = buildSpaceFromRegistry(registry, parentA.strategyId);
    const params = space
      ? crossoverParameters(space, parentA.parameters, parentB.parameters, rng)
      : { ...parentA.parameters };
    return {
      candidateType: "BASE",
      candidateId,
      strategyId: parentA.strategyId,
      parameters: params,
    };
  }
  const space = buildSpaceFromRegistry(registry, parentA.strategyId);
  const params = space
    ? crossoverParameters(space, parentA.parameters, parentB.parameters, rng)
    : { ...parentA.parameters };
  return {
    candidateType: "BASE",
    candidateId,
    strategyId: parentA.strategyId,
    parameters: params,
  };
}

/**
 * Crossover for two COMPOSITE parents: combine components from each,
 * preserving operator, dedupe by strategyId, re-normalise weights.
 */
function crossoverCompositeCandidates(
  parentA: ParentStrategy,
  parentB: ParentStrategy,
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  if (parentA.type !== "COMPOSITE" || parentB.type !== "COMPOSITE") return null;
  const aComponents = parentA.config.components;
  const bComponents = parentB.config.components;
  const seen = new Map<string, CombinationComponent>();
  // Take a random subset from A (≥1) and from B (≥1) so the result has
  // at least 1 component. When A or B only has one component, include it.
  const aPick = Math.max(1, Math.ceil(aComponents.length * rng()));
  const bPick = Math.max(1, Math.ceil(bComponents.length * rng()));
  for (let i = 0; i < aPick; i += 1) {
    const c = aComponents[i % aComponents.length]!;
    seen.set(c.strategyId, c);
  }
  for (let i = 0; i < bPick; i += 1) {
    const c = bComponents[i % bComponents.length]!;
    if (!seen.has(c.strategyId)) {
      seen.set(c.strategyId, c);
    }
  }

  const merged: Array<CombinationComponent & { weight: number }> = [];
  let pos = 0;
  for (const c of Array.from(seen.values())) {
    const space = buildSpaceFromRegistry(registry, c.strategyId);
    // Pick params from whichever parent contributed this strategyId.
    const contributedFrom = aComponents.find((x) => x.strategyId === c.strategyId);
    const newParams = space
      ? mutateParameters(space, contributedFrom?.parameters ?? {}, rng)
      : contributedFrom?.parameters
        ? { ...contributedFrom.parameters }
        : {};
    merged.push({
      strategyId: c.strategyId,
      weight: Number(c.weight), // mutable number for re-normalisation
      position: pos,
      ...(Object.keys(newParams).length > 0 ? { parameters: newParams } : {}),
    });
    pos += 1;
  }

  // Re-normalise weights.
  const sum = merged.reduce((acc, c) => acc + c.weight, 0) || 1;
  const normalised: CombinationComponent[] = merged.map((c) => ({
    strategyId: c.strategyId,
    weight: c.weight / sum,
    position: c.position,
    ...(c.parameters ? { parameters: c.parameters } : {}),
  }));

  const operator = parentA.config.operator ?? parentB.config.operator ?? CombinationOperator.WEIGHTED;
  // Phase 3.3: meaningful crossover name (component-based).
  const componentNames = normalised.map((c) =>
    registry.resolve(c.strategyId)?.name ?? c.strategyId.replace(/^strategy\./, ""),
  );
  const newConfig: CombinationConfig = {
    id: `strategy.composite.crossover.${candidateId}`,
    name: `Crossover (${parentA.config.name} × ${parentB.config.name}) → ${componentNames.join(" + ")}`,
    components: normalised,
    operator,
  };

  if (!validateCombinationConfig(newConfig).ok) return null;
  return { candidateType: "COMPOSITE", candidateId, config: newConfig };
}

function crossoverCandidate(
  parentA: ParentStrategy,
  parentB: ParentStrategy,
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  if (parentA.type === "BASE" && parentB.type === "BASE") {
    return crossoverBaseCandidates(parentA, parentB, candidateId, rng, registry);
  }
  if (parentA.type === "COMPOSITE" && parentB.type === "COMPOSITE") {
    return crossoverCompositeCandidates(parentA, parentB, candidateId, rng, registry);
  }
  // Mixed BASE/COMPOSITE crossover — identify which is BASE and which is COMPOSITE
  // and convert the BASE into a 1-component COMPOSITE wrapper.
  const isABase = parentA.type === "BASE";
  const baseParent: { type: "BASE"; strategyId: string; parameters: Readonly<Record<string, unknown>> } =
    isABase ? (parentA as { type: "BASE"; strategyId: string; parameters: Readonly<Record<string, unknown>> }) : (parentB as { type: "BASE"; strategyId: string; parameters: Readonly<Record<string, unknown>> });
  const compositeParent: { type: "COMPOSITE"; config: CombinationConfig } =
    isABase ? (parentB as { type: "COMPOSITE"; config: CombinationConfig }) : (parentA as { type: "COMPOSITE"; config: CombinationConfig });
  const wrappedBase: ParentStrategy = {
    type: "COMPOSITE",
    config: {
      id: `strategy.composite.wrapped.${candidateId}`,
      name: baseParent.strategyId,
      operator: CombinationOperator.WEIGHTED,
      components: [
        {
          strategyId: baseParent.strategyId,
          weight: 1,
          position: 0,
          ...(Object.keys(baseParent.parameters).length > 0
            ? { parameters: { ...baseParent.parameters } }
            : {}),
        },
      ],
    },
  };
  return crossoverCompositeCandidates(wrappedBase, compositeParent, candidateId, rng, registry);
}

/**
 * Exploration: pick a fresh candidate by sampling an entirely new
 * strategy (BASE) or random subset of components (COMPOSITE) from the
 * StrategyRegistry. We never re-emit the parent itself.
 */
function exploreCandidate(
  parent: ParentStrategy,
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  if (parent.type === "BASE") {
    const all = registry.list();
    if (all.length === 0) return null;
    const others = all.filter((id) => id !== parent.strategyId);
    if (others.length === 0) return mutateBaseCandidate(parent, candidateId, rng, registry);
    const pickId = others[Math.floor(rng() * others.length)]!;
    const space = buildSpaceFromRegistry(registry, pickId);
    const params = space ? randomParameters(space, rng) : {};
    return {
      candidateType: "BASE",
      candidateId,
      strategyId: pickId,
      parameters: params,
    };
  }
  // COMPOSITE exploration: pick a random subset of BASE strategies.
  const all = registry.list();
  if (all.length === 0) return null;
  const baseCount = Math.max(2, Math.min(4, Math.floor(rng() * 3) + 2));
  const picks = new Set<string>();
  while (picks.size < Math.min(baseCount, all.length)) {
    picks.add(all[Math.floor(rng() * all.length)]!);
  }
  const components: CombinationComponent[] = [];
  let pos = 0;
  for (const sid of picks) {
    const space = buildSpaceFromRegistry(registry, sid);
    const params = space ? randomParameters(space, rng) : {};
    components.push({
      strategyId: sid,
      weight: 1 / picks.size,
      position: pos,
      ...(Object.keys(params).length > 0 ? { parameters: params } : {}),
    });
    pos += 1;
  }
  // Phase 3.3: explore name is derived from the actual components so
  // the UI can show "Loop explore: bollinger + ma + rsi" instead of
  // the meaningless "Loop explore 0_3". The registry provides a
  // human-readable name (e.g. "Bollinger Bands"); we fall back to a
  // stripped implementationRef for any strategy not yet registered.
  const componentNames = components.map((c) =>
    registry.resolve(c.strategyId)?.name ?? c.strategyId.replace(/^strategy\./, ""),
  );
  const config: CombinationConfig = {
    id: `strategy.composite.explore.${candidateId}`,
    name: `Loop explore: ${componentNames.join(" + ")}`,
    components,
    operator: CombinationOperator.WEIGHTED,
  };
  if (!validateCombinationConfig(config).ok) return null;
  return { candidateType: "COMPOSITE", candidateId, config };
}

/* ─── Generator ───────────────────────────────────────────────────────── */

export class HybridLoopGenerator implements StrategyGenerator {
  public readonly name = "Hybrid Loop";
  public readonly id = HYBRID_LOOP_GENERATOR_ID;
  public spaces: ReadonlyArray<ParameterSpace> = [];

  private cfg: HybridLoopConfig | null = null;
  private registry: StrategyRegistry = getStrategyRegistry();

  public applyConfig(cfg: HybridLoopConfig | undefined | null): void {
    this.cfg = cfg ?? null;
  }

  public setRegistry(registry: StrategyRegistry): void {
    this.registry = registry;
  }

  /**
   * Compute how many candidates each bucket gets. Always produces
   * exactly `candidateCount` candidates.
   */
  private computeBucketSizes(): {
    mutation: number;
    crossover: number;
    exploration: number;
  } {
    const c = this.cfg;
    if (!c) return { mutation: 0, crossover: 0, exploration: 0 };
    const total = Math.max(1, c.candidateCount);
    const mutationRatio = clamp(c.mutationRatio ?? 0.4, 0, 1);
    const crossoverRatio = clamp(c.crossoverRatio ?? 0.2, 0, 1);
    const explorationRatio = clamp(c.explorationRatio ?? 0.4, 0, 1);
    const sum = mutationRatio + crossoverRatio + explorationRatio || 1;

    let mutation = Math.round((mutationRatio / sum) * total);
    let crossover = Math.round((crossoverRatio / sum) * total);
    let exploration = total - mutation - crossover;
    if (exploration < 0) {
      // Redistribute to keep total = candidateCount.
      const deficit = -exploration;
      crossover = Math.max(0, crossover - deficit);
      exploration = total - mutation - crossover;
    }
    if (!c.eliteMate && crossover > 0) {
      // No elite mate → shuffle crossover slots to mutation.
      mutation += crossover;
      crossover = 0;
      exploration = total - mutation;
    }
    return { mutation, crossover, exploration };
  }

  public async generate(
    onCandidate: OnCandidate,
    shouldStop: StopCondition,
    state: SearchState,
  ): Promise<{ done: true; result: GeneratorRunResult } | { done: false }> {
    if (!this.cfg) {
      return {
        done: true,
        result: {
          totalGenerated: 0,
          totalQueued: 0,
          totalRejected: 0,
          stoppedByCondition: false,
          stoppedByBackPressure: false,
          generationMs: 0,
        },
      };
    }

    const t0 = Date.now();
    const cfg = this.cfg;
    const weightRatio = clamp(cfg.weightPerturbationRatio ?? 0.1, 0, 0.5);
    const seed = cfg.randomSeed ?? hashStringToInt(`${Date.now()}`);
    const rng = createRng(seed);

    const buckets = this.computeBucketSizes();
    const plan: Array<"mutation" | "crossover" | "exploration"> = [
      ...Array(buckets.mutation).fill("mutation" as const),
      ...Array(buckets.crossover).fill("crossover" as const),
      ...Array(buckets.exploration).fill("exploration" as const),
    ];

    let totalGenerated = state.generatedCount;
    let totalQueued = state.queuedCount;
    let totalRejected = state.rejectedCount;
    let candidateIndex = state.generatedCount;

    for (let i = 0; i < plan.length; i += 1) {
      if (shouldStop(state)) {
        return {
          done: true,
          result: {
            totalGenerated,
            totalQueued,
            totalRejected,
            stoppedByCondition: true,
            stoppedByBackPressure: false,
            generationMs: Date.now() - t0,
          },
        };
      }

      const cid = formatCandidateId(0, candidateIndex);
      candidateIndex += 1;
      totalGenerated += 1;

      const mode = plan[i]!;
      let candidate: SearchCandidate | null = null;

      if (mode === "mutation") {
        candidate =
          cfg.parent.type === "BASE"
            ? mutateBaseCandidate(cfg.parent, cid, rng, this.registry)
            : mutateCompositeCandidate(cfg.parent.config, cid, weightRatio, rng, this.registry);
      } else if (mode === "crossover") {
        if (cfg.eliteMate) {
          candidate = crossoverCandidate(cfg.parent, cfg.eliteMate, cid, rng, this.registry);
        }
      } else {
        candidate = exploreCandidate(cfg.parent, cid, rng, this.registry);
      }

      if (!candidate) {
        totalRejected += 1;
        state.rejectedCount += 1;
        // Fall back to a mutation so we still hit the candidate count.
        candidate =
          cfg.parent.type === "BASE"
            ? mutateBaseCandidate(cfg.parent, cid, rng, this.registry)
            : mutateCompositeCandidate(cfg.parent.config, cid, weightRatio, rng, this.registry);
        if (!candidate) {
          // Give up on this slot — counter does NOT advance.
          totalGenerated -= 1;
          candidateIndex -= 1;
          continue;
        }
      }

      const accepted = await resolveOnCandidate(onCandidate, candidate);
      if (!accepted) {
        return {
          done: true,
          result: {
            totalGenerated,
            totalQueued,
            totalRejected,
            stoppedByBackPressure: true,
            stoppedByCondition: false,
            generationMs: Date.now() - t0,
          },
        };
      }

      totalQueued += 1;
      state.queuedCount += 1;
      state.generatedCount += 1;
    }

    return {
      done: true,
      result: {
        totalGenerated,
        totalQueued,
        totalRejected,
        stoppedByCondition: false,
        stoppedByBackPressure: false,
        generationMs: Date.now() - t0,
      },
    };
  }
}

export const __test__ = {
  createRng,
  mutateField,
  buildSpaceFromRegistry,
  mutateParameters,
  mutateBaseCandidate,
  mutateCompositeCandidate,
  crossoverCandidate,
  exploreCandidate,
  clamp,
};
