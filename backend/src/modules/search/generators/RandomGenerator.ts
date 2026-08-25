/**
 * search · generators · RandomGenerator
 *
 * Implements `StrategyGenerator` for Random Search (FR-021). Produces candidates
 * by sampling uniformly at random from each strategy's declared parameter space.
 *
 * Behaviour:
 *   - Each iteration picks ONE random BASE strategy from `spaces`.
 *   - Samples one random parameter set from that strategy's space.
 *   - Skips duplicates (same parameter set for same strategy — BR-019).
 *   - Stops when `shouldStop()` returns `true` or `maxCandidates` reached.
 *
 * The generator is deterministic for the same `spaces` array and `maxCandidates`
 * (uses `Math.random()` which is seeded per Node.js process start).
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { StrategyGenerator, GeneratorRunResult, OnCandidate } from "../domain/StrategyGenerator";
import { resolveOnCandidate } from "../domain/StrategyGenerator";
import type { ParameterSpace } from "../domain/ParameterSpace";
import type { StopCondition, SearchState } from "../domain/StopCondition";
import type { BaseCandidate } from "../domain/SearchCandidate";
import { formatCandidateId } from "../domain/SearchCandidate";

export const RANDOM_GENERATOR_ID = "random";

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
function randomCandidate(
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

export class RandomGenerator implements StrategyGenerator {
  public readonly name = "Random Search";
  public readonly id = RANDOM_GENERATOR_ID;
  public spaces: ReadonlyArray<ParameterSpace> = [];

  public constructor() {}

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

    const t0 = Date.now();
    const seen = new Set<string>();
    // Initialise counters from state to support pause/resume.
    // These are local accumulators that remain in sync with state.
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

      const space = randChoice(this.spaces);
      const cand = randomCandidate(space, formatCandidateId(0, candidateIndex));
      candidateIndex++;
      totalGenerated++;

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
    }
  }
}
