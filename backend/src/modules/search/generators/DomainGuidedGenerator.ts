/**
 * search · generators · DomainGuidedGenerator
 *
 * Implements `StrategyGenerator` for Domain-guided Search (FR-022). Produces candidates
 * by combining BASE strategies from different families into COMPOSITE candidates.
 *
 * Behaviour:
 *   - Picks ONE strategy from each declared family group.
 *   - Assigns weights to each component.
 *   - Produces a `CompositeCandidate` with a `CombinationConfig`.
 *   - Skips duplicate composites (same component set — BR-019).
 *   - Respects `maxCandidates`.
 *
 * The generator uses only the families declared in the configured spaces.
 * A COMPOSITE candidate is assembled by taking one strategy per declared family
 * and combining them with equal weights.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { StrategyGenerator, GeneratorRunResult, OnCandidate } from "../domain/StrategyGenerator";
import { resolveOnCandidate } from "../domain/StrategyGenerator";
import type { ParameterSpace } from "../domain/ParameterSpace";
import type { StopCondition, SearchState } from "../domain/StopCondition";
import type { CompositeCandidate } from "../domain/SearchCandidate";
import { formatCandidateId } from "../domain/SearchCandidate";
import { validateCombinationConfig } from "../../strategy/combination/CombinationConfig";
import type { CombinationConfig } from "../../strategy/combination/CombinationConfig";

export const DOMAIN_GUIDED_GENERATOR_ID = "domain_guided";

/**
 * Family group configuration for DomainGuidedGenerator.
 * Each group declares which strategy families can appear together in one composite.
 * A valid composite contains exactly ONE strategy from each group.
 *
 * Example:
 *   groups: [
 *     { name: "trend", families: ["TREND"] },
 *     { name: "momentum", families: ["MOMENTUM"] },
 *   ]
 *   → Produces composites of [trend strategy + momentum strategy]
 */
export interface FamilyGroup {
  /** Human-readable label for this group, e.g. "trend". */
  readonly name: string;
  /** Which families can fill this group. */
  readonly families: ReadonlyArray<string>;
}

/**
 * Configuration for DomainGuidedGenerator.
 * Extends `GeneratorConfig` with the family grouping strategy.
 */
export interface DomainGuidedConfig {
  /**
   * The ordered list of family groups. A composite must contain exactly one
   * strategy from each group.
   */
  readonly familyGroups: ReadonlyArray<FamilyGroup>;
  /**
   * Whether to enumerate all possible family combinations (EXHAUSTIVE) or
   * sample randomly (RANDOM_SAMPLE, the default).
   */
  readonly mode: "EXHAUSTIVE" | "RANDOM_SAMPLE";
  /**
   * For RANDOM_SAMPLE mode: how many total composites to try to generate.
   * Duplicates are rejected, so the final count may be lower.
   */
  readonly maxCombinations?: number;
}

function buildCompositeCandidate(
  spaceByFamily: Map<string, ParameterSpace>,
  groups: ReadonlyArray<FamilyGroup>,
  candidateId: string,
): CompositeCandidate | null {
  const components = groups.map((group, idx) => {
    const space = spaceByFamily.get(group.families[0]!);
    if (!space) return null;
    return {
      strategyId: space.strategyId,
      weight: 1 / groups.length,
      position: idx,
    };
  });

  if (components.some((c) => c === null)) return null;

  const config: CombinationConfig = {
    id: `strategy.composite.domain_guided.${candidateId}`,
    name: `Domain-guided ${groups.map((g) => g.name).join(" + ")}`,
    components: components as CombinationConfig["components"],
  };

  const valid = validateCombinationConfig(config);
  if (!valid.ok) return null;

  return {
    candidateType: "COMPOSITE",
    candidateId,
    config,
  };
}

/**
 * Fingerprint for deduplication: sorted list of strategy ids.
 */
function compositeFingerprint(cand: CompositeCandidate): string {
  return cand.config.components
    .slice()
    .sort((a, b) => a.strategyId.localeCompare(b.strategyId))
    .map((c) => c.strategyId)
    .join("|");
}

export class DomainGuidedGenerator implements StrategyGenerator {
  public readonly name = "Domain-guided Search";
  public readonly id = DOMAIN_GUIDED_GENERATOR_ID;
  public spaces: ReadonlyArray<ParameterSpace> = [];
  public domainConfig!: DomainGuidedConfig;

  public async generate(
    onCandidate: OnCandidate,
    shouldStop: StopCondition,
    state: SearchState,
  ): Promise<{ done: true; result: GeneratorRunResult } | { done: false }> {
    if (this.spaces.length === 0 || !this.domainConfig) {
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
    let totalGenerated = state.generatedCount;
    let totalQueued = state.queuedCount;
    let totalRejected = state.rejectedCount;
    let candidateIndex = state.generatedCount;
    const { familyGroups } = this.domainConfig;
    const maxCombinations = this.domainConfig.maxCombinations ?? Infinity;

    // Build a mapping from strategy id to its space.
    const spaceByStrategyId = new Map<string, ParameterSpace>();
    for (const space of this.spaces) {
      spaceByStrategyId.set(space.strategyId, space);
    }

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

      if (totalGenerated >= maxCombinations) {
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

      const cand = buildCompositeCandidate(
        spaceByStrategyId,
        familyGroups,
        formatCandidateId(0, candidateIndex),
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
