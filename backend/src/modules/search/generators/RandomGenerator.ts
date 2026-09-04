/**
 * search · generators · RandomGenerator
 *
 * Implements `StrategyGenerator` for Random Search (FR-021). Produces COMPOSITE
 * candidates by randomly selecting k strategies (2 ≤ k ≤ N) from the pool and
 * sampling one parameter set per strategy.
 *
 * Behaviour:
 *   - In COMPOSITE mode (default): picks a random k where
 *     `minComponents ≤ k ≤ maxComponents`, then samples k DISTINCT strategies,
 *     canonicalises component ordering (sorted by strategyId), assigns
 *     normalised weights summing to 1, and emits one CompositeCandidate.
 *   - In BASE mode (legacy, `compositeMode: "BASE"`): picks ONE random BASE
 *     strategy from `spaces` and emits one BaseCandidate per iteration.
 *   - Skips duplicates (same component set for the same parameters).
 *   - Stops when `shouldStop()` returns `true` or `maxCandidates` reached.
 *
 * Module 5 / 6 compliance: composite mode ensures random search can discover
 * combination sizes of 2..N, not just single BASE strategies.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { StrategyGenerator, GeneratorRunResult, OnCandidate } from "../domain/StrategyGenerator";
import { resolveOnCandidate } from "../domain/StrategyGenerator";
import type { ParameterSpace } from "../domain/ParameterSpace";
import type { StopCondition, SearchState } from "../domain/StopCondition";
import type { BaseCandidate, CompositeCandidate } from "../domain/SearchCandidate";
import { formatCandidateId } from "../domain/SearchCandidate";
import {
  validateCombinationConfig,
  type CombinationConfig,
  type CombinationComponent,
} from "../../strategy/combination/CombinationConfig";
import { CombinationOperator } from "../../strategy/combination/CombinationConfig";

export const RANDOM_GENERATOR_ID = "random";

/**
 * Configuration for RandomGenerator.
 *
 * Default behaviour (no config): composite mode with k ∈ [2, N].
 */
export interface RandomGeneratorConfig {
  /**
   * The candidate generation mode.
   *  - "COMPOSITE" (default): randomly select k distinct strategies, build a composite.
   *  - "BASE": legacy behaviour — emit one BaseCandidate per iteration.
   */
  readonly compositeMode?: "COMPOSITE" | "BASE";
  /** Minimum number of component strategies in each composite. Defaults to 2. */
  readonly minComponents?: number;
  /** Maximum number of component strategies in each composite. Defaults to N. */
  readonly maxComponents?: number;
}

/** Random integer in [lo, hi] inclusive. */
function randInt(lo: number, hi: number): number {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Random float in [lo, hi]. */
function randFloat(lo: number, hi: number): number {
  return Math.random() * (hi - lo) + lo;
}

/** Random element from an array. */
function randChoice<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Sample a random parameter value from one `ParameterSpaceField`.
 */
function randomValue(field: ParameterSpace["fields"][number]): number | string {
  switch (field.kind) {
    case "integer":
      return randInt(field.min!, field.max!);
    case "decimal":
      return randFloat(field.min!, field.max!);
    case "enum": {
      const values = field.values!;
      return randChoice(values);
    }
  }
}

/**
 * Build one random `BaseCandidate` from a `ParameterSpace`.
 */
function randomBaseCandidate(
  space: ParameterSpace,
  candidateId: string,
): BaseCandidate {
  const params: Record<string, unknown> = {};
  for (const field of space.fields) {
    params[field.key] = randomValue(field);
  }
  return {
    candidateType: "BASE",
    candidateId,
    strategyId: space.strategyId,
    parameters: Object.freeze(params),
  };
}

/**
 * Deterministic fingerprint for deduplication: sorted key-value JSON.
 * Same params for same strategy → same fingerprint.
 */
function fingerprint(candidate: BaseCandidate): string {
  const parts: string[] = [candidate.strategyId];
  const sorted = Object.keys(candidate.parameters)
    .sort()
    .map((k) => `${k}=${candidate.parameters[k]}`);
  parts.push(...sorted);
  return parts.join("|");
}

/**
 * Pick k DISTINCT indices from {0..n-1} and return them sorted ascending.
 * Partial Fisher-Yates shuffle.
 */
function pickDistinctIndices(n: number, k: number): number[] {
  if (k <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, k).sort((a, b) => a - b);
}

/**
 * Build one random `CompositeCandidate` from a subset of `spaces`.
 *
 * - Sorts by strategyId so the fingerprint is stable.
 * - Assigns equal weights (1/k).
 * - Generates a stable config.id.
 */
function randomCompositeCandidate(
  subset: ReadonlyArray<ParameterSpace>,
  candidateId: string,
): CompositeCandidate | null {
  if (subset.length === 0) return null;
  const sorted = subset.slice().sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  const components: CombinationComponent[] = sorted.map((sp, idx) => ({
    strategyId: sp.strategyId,
    weight: 1 / sorted.length,
    position: idx,
  }));
  const config: CombinationConfig = {
    id: `strategy.composite.random.${candidateId}`,
    name: `Random ${sorted.map((sp) => sp.strategyId.replace(/^strategy\./, "")).join(" + ")}`,
    components,
    operator: CombinationOperator.WEIGHTED,
  };
  const valid = validateCombinationConfig(config);
  if (!valid.ok) return null;
  return { candidateType: "COMPOSITE", candidateId, config };
}

function compositeFingerprint(cand: CompositeCandidate): string {
  return cand.config.components
    .slice()
    .sort((a, b) => a.strategyId.localeCompare(b.strategyId))
    .map((c) => c.strategyId)
    .join("|");
}

export class RandomGenerator implements StrategyGenerator {
  public readonly name = "Random Search";
  public readonly id = RANDOM_GENERATOR_ID;
  public spaces: ReadonlyArray<ParameterSpace> = [];
  /** Generator-specific configuration. Set via applyConfig(). */
  public randomConfig: RandomGeneratorConfig = {};

  public constructor() {}

  public applyConfig(cfg: RandomGeneratorConfig | undefined | null): void {
    this.randomConfig = cfg ?? {};
  }

  public async generate(
    onCandidate: OnCandidate,
    shouldStop: StopCondition,
    state: SearchState,
  ): Promise<{ done: true; result: GeneratorRunResult } | { done: false }> {
    if (this.spaces.length === 0) {
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

    const compositeMode = this.randomConfig.compositeMode ?? "COMPOSITE";
    const n = this.spaces.length;
    const minK = Math.max(2, this.randomConfig.minComponents ?? 2);
    const maxK = Math.max(minK, this.randomConfig.maxComponents ?? n);

    const t0 = Date.now();
    const seen = new Set<string>();
    let totalGenerated = state.generatedCount;
    let totalQueued = state.queuedCount;
    let totalRejected = state.rejectedCount;
    let candidateIndex = state.generatedCount;

    while (true) {
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

      // Safety: stop if we've generated more than 2000 past the initial count.
      if (totalGenerated >= state.generatedCount + 2000) {
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

      totalGenerated++;

      if (compositeMode === "BASE") {
        // Legacy: one BASE candidate per iteration
        const space = randChoice(this.spaces);
        const cand = randomBaseCandidate(
          space,
          formatCandidateId(0, candidateIndex),
        );
        candidateIndex++;

        const fp = fingerprint(cand);
        if (seen.has(fp)) {
          totalRejected++;
          state.rejectedCount++;
          continue;
        }
        seen.add(fp);

        const accepted = await resolveOnCandidate(onCandidate, cand);
        if (!accepted) {
          return {
            done: true,
            result: {
              totalGenerated,
              totalQueued,
              totalRejected,
              stoppedByCondition: false,
              stoppedByBackPressure: true,
              generationMs: Date.now() - t0,
            },
          };
        }
        totalQueued++;
        state.queuedCount++;
        state.generatedCount++;
        continue;
      }

      // COMPOSITE mode (default for Module 5/6 compliance)
      const k = randInt(minK, Math.min(maxK, n));
      const idxSubset = pickDistinctIndices(n, k);
      const subset = idxSubset.map((i) => this.spaces[i]!);
      const cand = randomCompositeCandidate(
        subset,
        String(candidateIndex),
      );
      candidateIndex++;

      if (!cand) {
        totalRejected++;
        state.rejectedCount++;
        continue;
      }

      const fp = compositeFingerprint(cand);
      if (seen.has(fp)) {
        totalRejected++;
        state.rejectedCount++;
        continue;
      }
      seen.add(fp);

      const accepted = await resolveOnCandidate(onCandidate, cand);
      if (!accepted) {
        return {
          done: true,
          result: {
            totalGenerated,
            totalQueued,
            totalRejected,
            stoppedByCondition: false,
            stoppedByBackPressure: true,
            generationMs: Date.now() - t0,
          },
        };
      }
      totalQueued++;
      state.queuedCount++;
      state.generatedCount++;
    }
  }
}

// Re-export internal helpers for tests
export const __test__ = {
  pickDistinctIndices,
  randomCompositeCandidate,
  compositeFingerprint,
};
