/**
 * search · generators · LoopMutationGenerator
 *
 * Produces a small batch of "mutated" candidate variants derived from a
 * parent strategy. This is the Continuous Strategy Loop feedback generator:
 *
 *   NewTopStrategyFound(parent) → LoopOrchestratorRunner → LoopMutationGenerator
 *
 * Behaviour
 * ---------
 * Takes the parent's `CombinationConfig` (COMPOSITE) or `BaseCandidate` (BASE)
 * and produces N candidates whose parameters are slightly perturbed. The
 * perturbation rules mirror the parameter rules declared on the project's
 * built-in `Strategy` instances (`MovingAverageStrategy`, `RsiStrategy`, etc.)
 * via the `Strategy.parameterSpec` contract — no strategy-specific code
 * lives here.
 *
 * For BASE parents:
 *   - Sample new integer / decimal / enum values for each parameter,
 *     centred on the parent's values and clamped to `[min, max]`.
 *   - Emit `BaseCandidate` rows.
 *
 * For COMPOSITE parents:
 *   - Reuse the parent's `CombinationConfig` shape (components, operator,
 *     weights, position).
 *   - For each component, sample new parameters using the component's
 *     resolved `Strategy.parameterSpec`.
 *   - Optionally perturb each weight by ±10 % then re-normalise to sum 1.0.
 *   - Emit one `CompositeCandidate` per mutation.
 *
 * Operator semantics are preserved: a WEIGHTED parent stays WEIGHTED;
 * a MAJORITY_VOTE parent stays MAJORITY_VOTE. We do NOT change the
 * official Majority Vote / Weighted combination semantics.
 *
 * Determinism
 * -----------
 * The generator is deterministic given a fixed `randomSeed`. The
 * orchestrator passes `loopId + iterationIndex` as the seed so two
 * orchestrator instances on the same parent will produce the same
 * variants — important for reproducibility + debugging.
 *
 * Idempotency
 * -----------
 * The orchestrator is responsible for not calling `generate()` twice
 * with the same parent. The generator itself does not dedupe across
 * invocations because it is intentionally one-shot per iteration.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ,
 * no Socket.IO, no Binance SDK. Pure math + Strategy parameter specs.
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
  BaseCandidate,
  CompositeCandidate,
  SearchCandidate,
} from "../domain/SearchCandidate";
import { formatCandidateId } from "../domain/SearchCandidate";
import {
  validateCombinationConfig,
  type CombinationConfig,
  type CombinationComponent,
} from "../../strategy/combination/CombinationConfig";
import { CombinationOperator } from "../../strategy/combination/CombinationConfig";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";
import type { StrategyRegistry } from "../../strategy/domain/StrategyRegistry";

export const LOOP_MUTATION_GENERATOR_ID = "loop_mutation";

/**
 * Configuration for LoopMutationGenerator.
 *
 * `parent` is the only required field. `candidateCount` defaults to 5,
 * `weightPerturbationRatio` defaults to 0.1 (±10 %), and `randomSeed`
 * defaults to a combination of `loopId` and `iterationIndex` if those
 * are set.
 */
export interface LoopMutationConfig {
  /**
   * The parent's exact strategy. COMPOSITE parents must carry the
   * full `CombinationConfig`; BASE parents carry `parameters` keyed
   * by the strategy's parameter keys.
   */
  readonly parent: ParentStrategy;
  /** Number of mutated variants to generate. Defaults to 5. */
  readonly candidateCount?: number;
  /**
   * Maximum fractional change applied to a parent's component weight
   * (COMPOSITE only). The new weight is sampled from
   * `[weight × (1 - ratio), weight × (1 + ratio)]` and then the set
   * is re-normalised. Defaults to 0.1.
   */
  readonly weightPerturbationRatio?: number;
  /**
   * Deterministic seed for reproducibility. The orchestrator passes
   * `loopId + iterationIndex` so two runs over the same parent
   * produce the same variants.
   */
  readonly randomSeed?: number;
}

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

/* ─── Per-parameter mutation ─────────────────────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Sample ONE mutated value for a parameter field, centred on
 * `currentValue` and constrained to the field's bounds.
 *
 * The mutation is a uniform random step of ±30 % of the field range
 * (or one enum step for `enum` kinds). The step is intentionally
 * bounded so the generator does not jump wildly off-strategy.
 */
function mutateField(
  field: ParameterSpaceField,
  currentValue: number | string,
  rng: () => number,
): number | string {
  switch (field.kind) {
    case "integer": {
      const lo = field.min!;
      const hi = field.max!;
      const cur = typeof currentValue === "number" && Number.isInteger(currentValue)
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
      const cur = typeof currentValue === "number" && Number.isFinite(currentValue)
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
      // ±1 step in the enum list (wrap-around).
      const direction = rng() < 0.5 ? -1 : 1;
      return values[(idx + direction + values.length) % values.length]!;
    }
  }
}

/**
 * Build a `ParameterSpace` for one strategy by reading the live
 * `StrategyRegistry`. Returns null if the strategy is not registered
 * (in which case no parameter mutation is possible).
 */
function buildSpaceFromRegistry(
  registry: StrategyRegistry,
  strategyId: string,
): ParameterSpace | null {
  const strategy = registry.resolve(strategyId);
  if (!strategy) return null;
  const spec = strategy.parameterSpec;
  const fields: ParameterSpaceField[] = [];
  let totalGridPoints = 1;

  for (const f of spec.fields) {
    if (f.kind === "integer") {
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

/**
 * Mutate ALL fields in `space` for the given current parameters.
 * Fields not present in `parameters` are sampled from their default
 * range so the candidate is always validateable.
 */
function mutateParameters(
  space: ParameterSpace,
  currentParams: Readonly<Record<string, unknown>>,
  rng: () => number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of space.fields) {
    const cur = currentParams[field.key];
    if (cur === undefined || cur === null) {
      out[field.key] = field.defaultValue;
    } else {
      out[field.key] = mutateField(field, cur as number | string, rng);
    }
  }
  return out;
}

/**
 * Build ONE mutated BASE candidate from a BASE parent.
 */
function mutateBaseCandidate(
  parent: { type: "BASE"; strategyId: string; parameters: Readonly<Record<string, unknown>> },
  candidateId: string,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  const space = buildSpaceFromRegistry(registry, parent.strategyId);
  if (!space) {
    // No spec → emit the parent unchanged (still counts as a candidate,
    // preserves reproducibility, and lets the orchestrator observe that
    // this strategy has no mutable parameters).
    const base: BaseCandidate = {
      candidateType: "BASE",
      candidateId,
      strategyId: parent.strategyId,
      parameters: { ...parent.parameters },
    };
    return base;
  }
  const params = mutateParameters(space, parent.parameters, rng);
  const base: BaseCandidate = {
    candidateType: "BASE",
    candidateId,
    strategyId: parent.strategyId,
    parameters: params,
  };
  return base;
}

/**
 * Build ONE mutated COMPOSITE candidate from a COMPOSITE parent.
 *
 * Re-uses the parent's operator verbatim. Mutates each component's
 * parameters (if a `ParameterSpace` is available for its strategy)
 * and slightly perturbs each component weight by ±
 * `weightPerturbationRatio`, then re-normalises to sum 1.0.
 */
function mutateCompositeCandidate(
  parentConfig: CombinationConfig,
  candidateId: string,
  weightRatio: number,
  rng: () => number,
  registry: StrategyRegistry,
): SearchCandidate | null {
  // Step 1 — perturb weights.
  const rawWeights = parentConfig.components.map((c) =>
    clamp(c.weight * (1 + (rng() * 2 - 1) * weightRatio), 0, 1),
  );
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const normWeights = rawWeights.map((w) => w / weightSum);

  // Step 2 — build mutated components.
  const components: CombinationComponent[] = parentConfig.components.map((c, idx) => {
    const space = buildSpaceFromRegistry(registry, c.strategyId);
    const newParams = space
      ? mutateParameters(space, c.parameters ?? {}, rng)
      : (c.parameters ? { ...c.parameters } : {});
    return {
      strategyId: c.strategyId,
      weight: normWeights[idx]!,
      position: c.position,
      ...(Object.keys(newParams).length > 0 ? { parameters: newParams } : {}),
    };
  });

  const newConfig: CombinationConfig = {
    id: `strategy.composite.loop.${candidateId}`,
    name: `${parentConfig.name} (loop mutation)`,
    components,
    operator: parentConfig.operator ?? CombinationOperator.WEIGHTED,
  };

  const valid = validateCombinationConfig(newConfig);
  if (!valid.ok) return null;

  const composite: CompositeCandidate = {
    candidateType: "COMPOSITE",
    candidateId,
    config: newConfig,
  };
  return composite;
}

/* ─── Generator class ────────────────────────────────────────────────── */

export class LoopMutationGenerator implements StrategyGenerator {
  public readonly name = "Loop Mutation";
  public readonly id = LOOP_MUTATION_GENERATOR_ID;
  /** Required by the `StrategyGenerator` contract but unused here. */
  public spaces: ReadonlyArray<ParameterSpace> = [];

  private cfg: LoopMutationConfig | null = null;
  private registry: StrategyRegistry = getStrategyRegistry();

  public applyConfig(cfg: LoopMutationConfig | undefined | null): void {
    this.cfg = cfg ?? null;
  }

  public setRegistry(registry: StrategyRegistry): void {
    this.registry = registry;
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
    const candidateCount = Math.max(1, Math.min(this.cfg.candidateCount ?? 5, 100));
    const weightRatio = clamp(this.cfg.weightPerturbationRatio ?? 0.1, 0, 0.5);
    const seed = this.cfg.randomSeed ?? hashStringToInt(`${Date.now()}`);
    const rng = createRng(seed);

    let totalGenerated = state.generatedCount;
    let totalQueued = state.queuedCount;
    let totalRejected = state.rejectedCount;
    let candidateIndex = state.generatedCount;

    for (let i = 0; i < candidateCount; i += 1) {
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

      const candidate =
        this.cfg.parent.type === "BASE"
          ? mutateBaseCandidate(this.cfg.parent, cid, rng, this.registry)
          : mutateCompositeCandidate(
              this.cfg.parent.config,
              cid,
              weightRatio,
              rng,
              this.registry,
            );

      if (!candidate) {
        totalRejected += 1;
        state.rejectedCount += 1;
        continue;
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

/* ─── Re-exports for tests ────────────────────────────────────────────── */

export const __test__ = {
  createRng,
  mutateField,
  buildSpaceFromRegistry,
  mutateParameters,
  mutateBaseCandidate,
  mutateCompositeCandidate,
  clamp,
};
