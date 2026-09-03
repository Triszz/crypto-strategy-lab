/**
 * search · generators · DomainGuidedGenerator
 *
 * Implements `StrategyGenerator` for Domain-guided Search (FR-022). Produces
 * candidates by combining BASE strategies from different families into COMPOSITE
 * candidates.
 *
 * Behaviour:
 *   - When `minComponents` / `maxComponents` is configured: enumerates all
 *     k-subsets of the available strategies (min ≤ k ≤ max), then filters each
 *     subset through the required-family rule and deduplicates by component set.
 *   - When `familyGroups` is configured (legacy / backward-compatible path):
 *     for each declared family group, picks ONE strategy from each family in
 *     that group. In STRICT mode (default) the generator emits one composite
 *     containing ALL filled groups. In GUIDED mode it enumerates all subsets
 *     of filled groups of size ≥ 2 so the user gets multiple composite
 *     candidates of varying sizes.
 *   - In EXHAUSTIVE mode: emits all unique valid candidates.
 *   - In RANDOM_SAMPLE mode: samples candidates at random (with dedup).
 *   - Assigns equal weights (1 / N) to each component by default.
 *   - Produces a `CompositeCandidate` with a `CombinationConfig`.
 *   - Skips duplicate composites (same component set — BR-019).
 *   - Respects `maxCandidates`.
 *
 * Family → ParameterSpace mapping
 * --------------------------------
 * The frontend sends groups like `{ name: "trend", families: ["TREND"] }`. Each
 * `ParameterSpace.strategyId` (e.g. `"strategy.ma"`) has a corresponding concrete
 * `Strategy` in the runtime `StrategyRegistry`, and that Strategy declares its
 * `family` (e.g. `"TREND"`). To map a family string to a ParameterSpace we
 * iterate over `this.spaces`, resolve the corresponding Strategy from the
 * injected registry, and index by `strategy.family`.
 *
 * This deliberately does NOT hardcode strategy IDs: a new BASE strategy whose
 * `family` field matches an existing group is automatically picked up.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no Socket.IO,
 * no Binance SDK.
 */
import type { Strategy } from "../../strategy/domain/Strategy";
import type { StrategyRegistry } from "../../strategy/domain/StrategyRegistry";
import { getStrategyRegistry } from "../../strategy/domain/StrategyRegistry";
import type { StrategyGenerator, GeneratorRunResult, OnCandidate } from "../domain/StrategyGenerator";
import { resolveOnCandidate } from "../domain/StrategyGenerator";
import type { ParameterSpace } from "../domain/ParameterSpace";
import type { StopCondition, SearchState } from "../domain/StopCondition";
import type { CompositeCandidate } from "../domain/SearchCandidate";
import {
  validateCombinationConfig,
  type CombinationConfig,
  type CombinationComponent,
} from "../../strategy/combination/CombinationConfig";
import { CombinationOperator } from "../../strategy/combination/CombinationConfig";

export const DOMAIN_GUIDED_GENERATOR_ID = "domain_guided";

/**
 * Family group configuration for DomainGuidedGenerator.
 * Each group declares which strategy families can appear together in one composite.
 */
export interface FamilyGroup {
  /** Human-readable label for this group, e.g. "trend". */
  readonly name: string;
  /**
   * Which families can fill this group. Currently each group has exactly one
   * family; the array shape is preserved for future extensibility (e.g.
   * `{name: "trend", families: ["TREND", "MOMENTUM"]}` to allow either).
   */
  readonly families: ReadonlyArray<string>;
}

/**
 * Configuration for DomainGuidedGenerator.
 *
 * Two enumeration strategies are supported:
 *
 *   A. Component-count mode (preferred for diverse combination generation):
 *      Set `minComponents` and/or `maxComponents`. The generator enumerates
 *      all k-subsets of the available strategies (where min ≤ k ≤ max), filters
 *      each subset through the `requiredFamilies` rule, and emits unique
 *      composites. `familyGroups` is IGNORED in this mode (may be absent or
 *      empty).
 *
 *   B. Family-group mode (legacy / backward-compatible):
 *      Set `familyGroups` without `minComponents` / `maxComponents`.
 *      - STRICT (default): emits exactly one composite containing one strategy
 *        from each filled group.
 *      - GUIDED: enumerates all subsets of filled groups of size ≥ 2 to
 *        produce multiple composite candidates of varying sizes (2, 3, …, N).
 */
export interface DomainGuidedConfig {
  /**
   * Ordered family groups for mode B.
   * Each group picks exactly ONE strategy from one of its declared families.
   *
   * Ignored when `minComponents` / `maxComponents` is set.
   */
  readonly familyGroups: ReadonlyArray<FamilyGroup>;

  /**
   * Minimum number of component strategies in each generated composite.
   * When set, the generator switches to subset-enumeration mode.
   * Must be ≥ 2 (a composite must have at least 2 components).
   * Defaults to 2 when `maxComponents` is set but `minComponents` is absent.
   */
  readonly minComponents?: number;

  /**
   * Maximum number of component strategies in each generated composite.
   * Must be ≥ `minComponents` when both are set.
   * Defaults to the total number of available strategies when absent in
   * subset-enumeration mode.
   */
  readonly maxComponents?: number;

  /**
   * Strategy families that MUST be represented in every generated composite.
   * Only used in subset-enumeration mode (when `minComponents` is set) and in
   * GUIDED mode.
   *
   * When absent, any k-subset (meeting the size constraint) is valid.
   */
  readonly requiredFamilies?: ReadonlyArray<string>;

  /**
   * How the `requiredFamilies` rule should be applied.
   *
   * - `"STRICT"` (default): every emitted composite MUST satisfy
   *   `requiredFamilies`. Composites that do not cover every required family
   *   are filtered out.
   *
   * - `"GUIDED"`: `requiredFamilies` is treated as a PREFERENCE, not a hard
   *   requirement. Every valid k-subset is emitted; composites that satisfy
   *   `requiredFamilies` are emitted first (highest priority), followed by the
   *   rest. This enables broader >=2 combinations while still ranking
   *   domain-valid candidates higher.
   */
  readonly domainMode?: "STRICT" | "GUIDED";

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

/**
 * Build the (family → list-of-ParameterSpace) index. The generator uses this to
 * pick concrete spaces that match each declared family.
 */
function buildFamilyIndex(
  spaces: ReadonlyArray<ParameterSpace>,
  registry: StrategyRegistry,
): Map<string, ParameterSpace[]> {
  const idx = new Map<string, ParameterSpace[]>();
  for (const space of spaces) {
    const strategy: Strategy | undefined = registry.resolve(space.strategyId);
    if (!strategy) continue;
    const family = String(strategy.family);
    const bucket = idx.get(family) ?? [];
    bucket.push(space);
    idx.set(family, bucket);
  }
  return idx;
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

/**
 * Composite candidate paired with the k (subset size) used for sorting.
 * Internal helper, not exported.
 */
interface TaggedCandidate {
  readonly cand: CompositeCandidate;
  readonly k: number;
}

/**
 * Build a CompositeCandidate from an explicit list of strategies.
 * Used by GUIDED mode to assemble composites from arbitrary subsets.
 */
function buildCandidateFromStrategies(
  strategyIds: ReadonlyArray<string>,
  spacesByStrategyId: ReadonlyMap<string, ParameterSpace>,
  registry: StrategyRegistry,
  candidateId: string,
  /** Optional prefix to make candidate IDs distinct between generator modes. */
  idPrefix: string = "domain_guided",
): CompositeCandidate | null {
  if (strategyIds.length < 2) return null;

  const sorted = strategyIds.slice().sort((a, b) => a.localeCompare(b));
  const components: CombinationComponent[] = sorted.map((strategyId, idx) => ({
    strategyId,
    weight: 1 / sorted.length,
    position: idx,
  }));

  const names = sorted.map((sid) => {
    const sp = spacesByStrategyId.get(sid);
    if (sp) return sid.replace(/^strategy\./, "");
    const strat = registry.resolve(sid);
    return strat?.name ?? sid.replace(/^strategy\./, "");
  });

  const config: CombinationConfig = {
    id: `strategy.composite.${idPrefix}.${candidateId}`,
    name: `Domain-guided ${names.join(" + ")}`,
    components,
    operator: CombinationOperator.WEIGHTED,
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
 * Enumerate all non-empty subsets of an array.
 * For an input of length N returns 2^N - 1 subsets, each sorted by index.
 */
function allNonEmptySubsets<T>(arr: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  const n = arr.length;
  const total = 1 << n;
  const result: Array<ReadonlyArray<T>> = [];
  for (let mask = 1; mask < total; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(arr[i]!);
    }
    result.push(subset);
  }
  return result;
}

export class DomainGuidedGenerator implements StrategyGenerator {
  public readonly name = "Domain-guided Search";
  public readonly id = DOMAIN_GUIDED_GENERATOR_ID;
  public spaces: ReadonlyArray<ParameterSpace> = [];
  public domainConfig!: DomainGuidedConfig;
  private registry: StrategyRegistry = getStrategyRegistry();

  /**
   * Apply a runtime configuration. Normalises fields and freezes the config.
   */
  public applyConfig(cfg: DomainGuidedConfig | undefined | null): void {
    if (!cfg) {
      this.domainConfig = {
        familyGroups: [],
        mode: "RANDOM_SAMPLE",
        maxCombinations: undefined,
        minComponents: undefined,
        maxComponents: undefined,
        requiredFamilies: undefined,
        domainMode: "STRICT",
      };
      return;
    }

    const familyGroups: FamilyGroup[] = Array.isArray(cfg.familyGroups)
      ? cfg.familyGroups.map((g: FamilyGroup) => ({
          name: String(g.name ?? ""),
          families: Array.isArray(g.families) ? g.families.map((f: string) => String(f)) : [],
        }))
      : [];

    let minComponents: number | undefined;
    let maxComponents: number | undefined;
    if (typeof cfg.minComponents === "number" && cfg.minComponents >= 2) {
      minComponents = cfg.minComponents;
    }
    if (typeof cfg.maxComponents === "number" && cfg.maxComponents >= 2) {
      maxComponents = cfg.maxComponents;
    }
    if (minComponents === undefined && maxComponents !== undefined) {
      minComponents = 2;
    }
    if (
      minComponents !== undefined &&
      maxComponents !== undefined &&
      minComponents > maxComponents
    ) {
      maxComponents = minComponents;
    }

    this.domainConfig = {
      familyGroups,
      mode: cfg.mode === "EXHAUSTIVE" ? "EXHAUSTIVE" : "RANDOM_SAMPLE",
      maxCombinations:
        typeof cfg.maxCombinations === "number" && cfg.maxCombinations > 0
          ? cfg.maxCombinations
          : undefined,
      minComponents,
      maxComponents,
      requiredFamilies:
        Array.isArray(cfg.requiredFamilies) && cfg.requiredFamilies.length > 0
          ? cfg.requiredFamilies.map((f) => String(f))
          : undefined,
      domainMode: cfg.domainMode === "GUIDED" ? "GUIDED" : "STRICT",
    };
  }

  /**
   * Inject the StrategyRegistry. Used by tests and by SearchService so the
   * generator can resolve each space to its Strategy and read the family.
   */
  public setRegistry(registry: StrategyRegistry): void {
    this.registry = registry;
  }

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
    const maxCombinations: number = this.domainConfig.maxCombinations ?? Infinity;
    const { familyGroups, domainMode, requiredFamilies } = this.domainConfig;
    const useSubsetMode =
      this.domainConfig.minComponents !== undefined ||
      this.domainConfig.maxComponents !== undefined;

    // Build family → ParameterSpace index for required-family lookup.
    const spacesByFamily = buildFamilyIndex(this.spaces, this.registry);

    // Build strategyId → ParameterSpace index for GUIDED-mode subset enumeration.
    const spacesByStrategyId = new Map<string, ParameterSpace>();
    for (const space of this.spaces) {
      spacesByStrategyId.set(space.strategyId, space);
    }

    // The set of strategy IDs that are visible to GUIDED / subset enumeration:
    // every strategy that belongs to one of the user-filled family groups.
    // If no family groups are filled, fall back to all available strategies.
    const filledFamilies = familyGroups
      .flatMap((g) => g.families)
      .map((f) => String(f));
    const poolStrategyIds: string[] =
      filledFamilies.length > 0
        ? filledFamilies.flatMap((fam) => {
            const bucket = spacesByFamily.get(fam) ?? [];
            return bucket.map((sp) => sp.strategyId);
          })
        : this.spaces.map((sp) => sp.strategyId);
    const dedupedPool = Array.from(new Set(poolStrategyIds)).sort((a, b) =>
      a.localeCompare(b),
    );

    // Required-family filter. This is the actual hard-rule check used by
    // STRICT mode. GUIDED mode inverts the semantics at the call site (it
    // sorts by `passesFamilyFilter` but does not skip subsets that fail it).
    const passesFamilyFilter = (strategyIds: ReadonlyArray<string>): boolean => {
      if (!requiredFamilies || requiredFamilies.length === 0) return true;
      const covered = new Set<string>();
      for (const sid of strategyIds) {
        const strat = this.registry.resolve(sid);
        if (strat) covered.add(String(strat.family));
      }
      return requiredFamilies.every((rf) => covered.has(rf));
    };

    // Pre-compute the candidate list for EXHAUSTIVE mode.
    let allCandidates: ReadonlyArray<CompositeCandidate> = [];
    if (this.domainConfig.mode === "EXHAUSTIVE") {
      allCandidates = this._buildExhaustiveCandidates({
        useSubsetMode,
        familyGroups,
        dedupedPool,
        spacesByFamily,
        spacesByStrategyId,
        seen,
        candidateIndexStart: candidateIndex,
        passesFamilyFilter,
      });
    }

    let candIdx = 0;

    // Early-exit if EXHAUSTIVE mode pre-computed an empty candidate list
    // (e.g. no family group was representable in the registry). Returning
    // here without bumping counters preserves the pre-existing contract that
    // `totalGenerated === 0` when no candidates could be produced.
    if (this.domainConfig.mode === "EXHAUSTIVE" && candIdx >= allCandidates.length) {
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

      let cand: CompositeCandidate | null = null;

      if (this.domainConfig.mode === "EXHAUSTIVE") {
        if (candIdx >= allCandidates.length) {
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
        cand = allCandidates[candIdx]!;
        candIdx++;
        candidateIndex++;
      } else {
        // RANDOM_SAMPLE
        cand = this._sampleRandomCandidate({
          useSubsetMode,
          familyGroups,
          dedupedPool,
          spacesByFamily,
          spacesByStrategyId,
          seen,
          candidateIndex,
          passesFamilyFilter,
        });
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
      }

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

      if (this.domainConfig.mode === "EXHAUSTIVE" && candIdx >= allCandidates.length) {
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
  }

  /**
   * Build the deterministic candidate list for EXHAUSTIVE mode.
   *
   * Two layouts are supported:
   *
   *  - Subset enumeration (Mode A): for every k-subset of the pool
   *    (minComponents ≤ k ≤ maxComponents), build a CompositeCandidate.
   *    Optional `requiredFamilies` filters subsets.
   *
   *  - Family-group (Mode B): for each filled family group, pick ONE
   *    strategy from that family. In STRICT mode (default) the resulting
   *    composite contains ALL filled groups → exactly one candidate. In
   *    GUIDED mode the generator enumerates all subsets of filled groups of
   *    size ≥ 2 → multiple candidates of varying sizes.
   */
  private _buildExhaustiveCandidates(args: {
    useSubsetMode: boolean;
    familyGroups: ReadonlyArray<FamilyGroup>;
    dedupedPool: ReadonlyArray<string>;
    spacesByFamily: ReadonlyMap<string, ReadonlyArray<ParameterSpace>>;
    spacesByStrategyId: ReadonlyMap<string, ParameterSpace>;
    seen: Set<string>;
    candidateIndexStart: number;
    passesFamilyFilter: (sids: ReadonlyArray<string>) => boolean;
  }): ReadonlyArray<CompositeCandidate> {
    const {
      useSubsetMode,
      familyGroups,
      dedupedPool,
      spacesByStrategyId,
      seen,
      candidateIndexStart,
      passesFamilyFilter,
    } = args;

    const out: Array<TaggedCandidate> = [];
    let candidateIndex = candidateIndexStart;

    // ── Mode A: subset enumeration ─────────────────────────────────────────
    if (useSubsetMode) {
      const n = dedupedPool.length;
      const minK = this.domainConfig.minComponents ?? 2;
      const maxK = this.domainConfig.maxComponents ?? n;
      const effectiveMin = Math.max(2, Math.min(minK, n));
      const effectiveMax = Math.max(effectiveMin, Math.min(maxK, n));

      for (let k = effectiveMin; k <= effectiveMax; k++) {
        for (const idxSubset of allKSubsets(n, k)) {
          const strategyIds = idxSubset.map((i) => dedupedPool[i]!);
          if (this.domainConfig.domainMode === "STRICT" && !passesFamilyFilter(strategyIds)) {
            continue;
          }
          const cand = buildCandidateFromStrategies(
            strategyIds,
            spacesByStrategyId,
            this.registry,
            String(candidateIndex),
          );
          candidateIndex++;
          if (!cand) continue;
          const fp = compositeFingerprint(cand);
          if (seen.has(fp)) continue;
          seen.add(fp);
          out.push({ cand, k } as TaggedCandidate);
        }
      }

      // GUIDED mode: rank domain-valid composites first, then by ascending k.
      if (
        this.domainConfig.domainMode === "GUIDED" &&
        this.domainConfig.requiredFamilies &&
        this.domainConfig.requiredFamilies.length > 0
      ) {
        out.sort((a, b) => {
          const aValid = passesFamilyFilter(a.cand.config.components.map((c) => c.strategyId));
          const bValid = passesFamilyFilter(b.cand.config.components.map((c) => c.strategyId));
          if (aValid && !bValid) return -1;
          if (!aValid && bValid) return 1;
          return a.k - b.k;
        });
      } else {
        out.sort((a, b) => a.k - b.k);
      }
      return out.map((v) => v.cand);
    }

    // ── Mode B: family-group ──────────────────────────────────────────────
    const groupStrategyIds: string[][] = familyGroups.map((group) => {
      const ids: string[] = [];
      for (const fam of group.families) {
        const bucket = args.spacesByFamily.get(fam) ?? [];
        for (const sp of bucket) ids.push(sp.strategyId);
      }
      return Array.from(new Set(ids));
    });

    // Any empty group short-circuits the whole generator.
    if (groupStrategyIds.some((ids) => ids.length === 0)) {
      return [];
    }

    if (this.domainConfig.domainMode === "GUIDED") {
      // Enumerate all subsets of filled groups with size ≥ 2.
      for (const groupSubset of allNonEmptySubsets(groupStrategyIds)) {
        if (groupSubset.length < 2) continue;
        const strategyIds = groupSubset.flat().slice().sort((a, b) => a.localeCompare(b));
        if (!passesFamilyFilter(strategyIds)) {
          continue;
        }
        const cand = buildCandidateFromStrategies(
          strategyIds,
          spacesByStrategyId,
          this.registry,
          String(candidateIndex),
        );
        candidateIndex++;
        if (!cand) continue;
        const fp = compositeFingerprint(cand);
        if (seen.has(fp)) continue;
        seen.add(fp);
        out.push({ cand, k: groupSubset.length });
      }
      return out.map((v) => v.cand);
    }

    // STRICT family-group: one composite with one strategy per filled group.
    // Pick the FIRST strategy from each group (deterministic).
    const strategyIds = groupStrategyIds.map((ids) => ids[0]!);
    const cand = buildCandidateFromStrategies(
      strategyIds,
      spacesByStrategyId,
      this.registry,
      String(candidateIndex),
    );
    if (cand) {
      const fp = compositeFingerprint(cand);
      if (!seen.has(fp)) {
        seen.add(fp);
        out.push({ cand, k: strategyIds.length });
      }
    }
    return out.map((v) => v.cand);
  }

  /**
   * Sample one random candidate for RANDOM_SAMPLE mode.
   *
   * - Subset enumeration (Mode A): pick a random k ∈ [min, max] and sample
   *   k distinct strategy IDs from the pool.
   * - Family-group (Mode B): pick one filled-group subset of size k and one
   *   strategy from each group in that subset.
   */
  private _sampleRandomCandidate(args: {
    useSubsetMode: boolean;
    familyGroups: ReadonlyArray<FamilyGroup>;
    dedupedPool: ReadonlyArray<string>;
    spacesByFamily: ReadonlyMap<string, ReadonlyArray<ParameterSpace>>;
    spacesByStrategyId: ReadonlyMap<string, ParameterSpace>;
    seen: Set<string>;
    candidateIndex: number;
    passesFamilyFilter: (sids: ReadonlyArray<string>) => boolean;
  }): CompositeCandidate | null {
    const {
      useSubsetMode,
      familyGroups,
      dedupedPool,
      spacesByStrategyId,
      candidateIndex,
      passesFamilyFilter,
    } = args;

    if (useSubsetMode) {
      const n = dedupedPool.length;
      const minK = this.domainConfig.minComponents ?? 2;
      const maxK = this.domainConfig.maxComponents ?? n;
      const k = minK + Math.floor(Math.random() * (maxK - minK + 1));
      const subset = randomKSubsets(n, k).map((i) => dedupedPool[i]!);
      if (this.domainConfig.domainMode === "STRICT" && !passesFamilyFilter(subset)) {
        return null;
      }
      return buildCandidateFromStrategies(
        subset,
        spacesByStrategyId,
        this.registry,
        String(candidateIndex),
      );
    }

    // Mode B (family-group): pick subset of filled groups + one strategy per group.
    const groupStrategyIds: string[][] = familyGroups.map((group) => {
      const ids: string[] = [];
      for (const fam of group.families) {
        const bucket = args.spacesByFamily.get(fam) ?? [];
        for (const sp of bucket) ids.push(sp.strategyId);
      }
      return Array.from(new Set(ids));
    });
    if (groupStrategyIds.length < 2 || groupStrategyIds.some((ids) => ids.length === 0)) {
      return null;
    }

    // GUIDED: pick a random subset of size ≥ 2.
    // STRICT: use ALL groups.
    const chosenIndices =
      this.domainConfig.domainMode === "GUIDED"
        ? pickRandomSubsetIndices(groupStrategyIds.length)
        : groupStrategyIds.map((_, i) => i);
    if (chosenIndices.length < 2) return null;

    const strategyIds = chosenIndices
      .map((gi) => groupStrategyIds[gi]![Math.floor(Math.random() * groupStrategyIds[gi]!.length)]!)
      .slice()
      .sort((a, b) => a.localeCompare(b));
    return buildCandidateFromStrategies(
      strategyIds,
      spacesByStrategyId,
      this.registry,
      String(candidateIndex),
    );
  }
}

/**
 * Enumerate all k-subsets of {0, 1, ..., n-1} in lexicographic order.
 */
function allKSubsets(n: number, k: number): ReadonlyArray<ReadonlyArray<number>> {
  if (k < 0 || k > n) return [];
  if (k === 0) return [[]];
  const result: number[][] = [];
  const current: number[] = [];

  function recurse(start: number, remaining: number): void {
    if (remaining === 0) {
      result.push([...current]);
      return;
    }
    for (let i = start; i <= n - remaining; i++) {
      current.push(i);
      recurse(i + 1, remaining - 1);
      current.pop();
    }
  }
  recurse(0, k);
  return result;
}

/**
 * Sample ONE random k-subset of {0, 1, ..., n-1} using a partial Fisher-Yates
 * shuffle. Returns the indices sorted ascending.
 */
function randomKSubsets(n: number, k: number): ReadonlyArray<number> {
  if (k <= 0) return [];
  if (k >= n) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }
  return indices.slice(0, k).sort((a, b) => a - b);
}

/**
 * Pick a random non-empty subset of {0, ..., n-1}. The returned subset has
 * size ≥ 1 with uniform probability per size bucket.
 */
function pickRandomSubsetIndices(n: number): number[] {
  if (n <= 0) return [];
  // Bias toward larger subsets to give the user more variety.
  const k = 1 + Math.floor(Math.random() * n);
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }
  return indices.slice(0, k).sort((a, b) => a - b);
}

// Re-export internal helpers for tests
export const __test__ = {
  buildFamilyIndex,
  allKSubsets,
  randomKSubsets,
  allNonEmptySubsets,
  buildCandidateFromStrategies,
};
