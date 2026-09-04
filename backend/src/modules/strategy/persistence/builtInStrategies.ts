/**
 * strategy · persistence · builtInStrategies
 *
 * Keeps the Prisma schema in lock-step with the in-memory
 * `StrategyRegistry`. The runtime registry (see `domain/StrategyRegistry`
 * + `strategies/bootstrap.ts`) is the canonical source of truth for the
 * 4 built-in BASE strategies. This module mirrors those entries into the
 * database so every module that reads `StrategyDefinition`,
 * `StrategyVersion` or `StrategyRegistry` (Search, Backtest, Evaluation,
 * Leaderboard, Combination…) can safely join against them.
 *
 * The sync is fully **idempotent**. It is meant to run on every server
 * startup; it is also exposed as a standalone CLI at
 * `prisma/sync-builtin-strategies.ts` for operators.
 *
 * Three responsibilities:
 *   1. **Dedup** — historical seed data may contain orphan rows whose
 *      `implementationRef` doesn't match a registered id (e.g.
 *      `Strategy.MACrossover`, `Strategy.RSIMomentum`). Those rows are
 *      preserved as referenced data — every FK pointing at them is
 *      rewritten to the canonical row first, then the orphan is deleted.
 *   2. **Upsert** — for every `BUILT_IN_STRATEGIES` entry, ensure exactly
 *      one active `StrategyDefinition` + `StrategyVersion` + enabled
 *      `StrategyRegistry` row exists with the right `name`/`family`.
 *   3. **Report** — returns a small summary so callers / the CLI can
 *      log what changed.
 *
 * MUST stay infrastructure-bound (it owns DB access by definition).
 * Pure-domain code MUST NOT import this module.
 */
import type { PrismaClient, StrategyFamily, StrategyType } from "@prisma/client";
import { BUILT_IN_STRATEGIES } from "../strategies/bootstrap";
import type { Strategy } from "../domain/Strategy";

export interface BuiltInStrategiesSyncReport {
  readonly dedupedRefs: ReadonlyArray<string>;
  readonly upsertedRefs: ReadonlyArray<string>;
  readonly registeredRefs: ReadonlyArray<string>;
  readonly removedLegacyDefinitions: number;
}

/** Family values the registry emits — mirrors the Prisma StrategyFamily enum. */
type BuiltInFamily = StrategyFamily;

/**
 * Run the synchronisation. Safe to call on every server boot — when the
 * DB is already in a healthy state, the returned arrays will all be empty.
 */
export async function syncBuiltInStrategies(
  prisma: PrismaClient,
): Promise<BuiltInStrategiesSyncReport> {
  // Snapshot the registry BEFORE we touch the DB so we have a stable
  // list of canonical ids to compare against.
  const canonicalBuiltIns: ReadonlyArray<Strategy> = BUILT_IN_STRATEGIES;

  const dedupedRefs: string[] = [];
  const upsertedRefs: string[] = [];
  const registeredRefs: string[] = [];
  let removedLegacyDefinitions = 0;

  // ─────────────────────────────────────────────────────────────────────
  // Step 1 — DEDUP
  //
  // Find every `StrategyVersion` row that does NOT correspond to a
  // canonical built-in. Each such row is treated as a legacy duplicate.
  // We retarget its FKs (CandidateStrategy, LeaderboardEntry,
  // RankingHistory) to the canonical version that shares the same
  // logical family (or, failing that, the alphabetically-first matching
  // canonical row), then delete the legacy version + definition.
  //
  // Scope: built-in synchronisation is strictly a BASE affair. The
  // DEDUP query therefore filters on `definition.type = "BASE"`.
  // COMPOSITE StrategyVersions are runtime-generated and are NEVER
  // touched by this step. Generic guard — no id or implRef is
  // hardcoded — so future COMPOSITE strategies are equally protected.
  // ─────────────────────────────────────────────────────────────────────
  const canonicalIds = new Set(canonicalBuiltIns.map((s) => s.id));

  const legacyVersions = await prisma.strategyVersion.findMany({
    where: {
      // Built-in synchronisation only operates on BASE definitions.
      // COMPOSITE rows are owned by Combination/Search and must stay
      // out of the DEDUP pipeline entirely.
      definition: { type: "BASE" },
      OR: [
        { implementationRef: { notIn: Array.from(canonicalIds) } },
        { implementationRef: { in: ["Strategy.MACrossover", "Strategy.RSIMomentum"] } },
      ],
      // Only act on fully-safe-to-fold rows: rows whose implementationRef
      // does not match the registry. (The targeted list above covers the
      // historical "Strategy.MACrossover" / "Strategy.RSIOversold"
      // leftovers whose casing predates the bootstrap.)
    },
    include: { definition: true },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[syncBuiltInStrategies] DEDUP step: scanning ${legacyVersions.length} legacy version(s) against canonical ids [${Array.from(canonicalIds).join(", ")}]`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[syncBuiltInStrategies] DEDUP step: rows =`,
    legacyVersions.map((l) => l.implementationRef),
  );

  const legacyDefinitionIds = new Set<string>();
  const legacyVersionIds = new Set<string>();

  for (const legacy of legacyVersions) {
    const legacyFamily = upperFamily(legacy.definition?.family);
    const mappedRef = inferCanonicalIdForLegacy(legacy.implementationRef);
    const canonical = canonicalBuiltIns.find((s) => {
      // 1. Explicit legacy-id mapping (e.g. Strategy.MACrossover → strategy.ma).
      if (mappedRef && s.id === mappedRef) return true;
      // 2. Same-family fallback for ad-hoc duplicates (e.g. any synthetic
      //    TREND row → strategy.ma, the only built-in TREND strategy).
      // Built-in strategies are BASE by definition, so no further type
      // discrimination is needed here.
      if (
        !mappedRef &&
        legacyFamily &&
        upperFamily(s.family) === legacyFamily
      ) {
        return true;
      }
      return false;
    });

    if (!canonical) {
      // eslint-disable-next-line no-console
      console.warn(
        `[syncBuiltInStrategies] no canonical target for legacy ref "${legacy.implementationRef}" (family=${legacyFamily ?? "?"}) — left in place`,
      );
      continue;
    }

    const canonicalVersion = await ensureCanonicalVersion(
      prisma,
      canonical,
      registeredRefs,
    );

    // ─────────────────────────────────────────────────────────────────────
    // LeaderboardEntry collision handling.
    //
    // The unique constraint `(strategy_version_id, symbol_id, timeframe)`
    // means we cannot blindly update every legacy LeaderboardEntry to
    // `canonicalVersion.id` — if the canonical version already has its
    // own LeaderboardEntry for the same `(symbolId, timeframe)` pair,
    // the update would violate the constraint (Prisma P2002).
    //
    // For each legacy LeaderboardEntry we therefore decide:
    //   • canonical entry already exists on (symbolId, timeframe)
    //       → delete the redundant legacy entry (preserve canonical)
    //   • canonical entry does NOT exist on (symbolId, timeframe)
    //       → migrate the legacy entry by updating its strategyVersionId
    //
    // Canonical LeaderboardEntry rows are NEVER deleted, so leaderboard
    // ranking semantics remain owned by the Leaderboard module.
    // ─────────────────────────────────────────────────────────────────────
    const legacyLeaderboardEntries = await prisma.leaderboardEntry.findMany({
      where: { strategyVersionId: legacy.id },
      select: { id: true, symbolId: true, timeframe: true },
    });

    let leaderboardDeleted = 0;
    let leaderboardMigrated = 0;

    if (legacyLeaderboardEntries.length > 0) {
      const collisionSymbolTimeframes = legacyLeaderboardEntries
        .filter((entry) => entry.symbolId !== null && entry.timeframe !== null)
        .map((entry) => ({
          symbolId: entry.symbolId!,
          timeframe: entry.timeframe!,
        }));

      const canonicalCollisions =
        collisionSymbolTimeframes.length > 0
          ? await prisma.leaderboardEntry.findMany({
              where: {
                strategyVersionId: canonicalVersion.id,
                OR: collisionSymbolTimeframes.map((p) => ({
                  symbolId: p.symbolId,
                  timeframe: p.timeframe,
                })),
              },
              select: { symbolId: true, timeframe: true },
            })
          : [];

      const collisionKey = new Set(
        canonicalCollisions.map((c) => `${c.symbolId}::${c.timeframe}`),
      );

      const collidingLegacyIds = legacyLeaderboardEntries
        .filter((e) => collisionKey.has(`${e.symbolId}::${e.timeframe}`))
        .map((e) => e.id);
      const migrateableLegacyEntries = legacyLeaderboardEntries.filter(
        (e) => !collisionKey.has(`${e.symbolId}::${e.timeframe}`),
      );

      if (collidingLegacyIds.length > 0) {
        const deleted = await prisma.leaderboardEntry.deleteMany({
          where: { id: { in: collidingLegacyIds } },
        });
        leaderboardDeleted = deleted.count;
      }

      if (migrateableLegacyEntries.length > 0) {
        const updated = await prisma.leaderboardEntry.updateMany({
          where: {
            id: { in: migrateableLegacyEntries.map((e) => e.id) },
          },
          data: { strategyVersionId: canonicalVersion.id },
        });
        leaderboardMigrated = updated.count;
      }
    }

    // Retarget the remaining FK rows. Order matters because of composite-key
    // tables on some schemas; here it's just a plain update.
    const candidateUpdate = await prisma.candidateStrategy.updateMany({
      where: { strategyVersionId: legacy.id },
      data: { strategyVersionId: canonicalVersion.id },
    });
    const rankingUpdate = await prisma.rankingHistory.updateMany({
      where: { strategyVersionId: legacy.id },
      data: { strategyVersionId: canonicalVersion.id },
    });
    const compositeChildUpdate = await prisma.compositeComponent.updateMany({
      where: { componentVersionId: legacy.id },
      data: { componentVersionId: canonicalVersion.id },
    });
    const compositeParentUpdate = await prisma.compositeComponent.updateMany({
      where: { compositeVersionId: legacy.id },
      data: { compositeVersionId: canonicalVersion.id },
    });

    // Stage the legacy rows for deletion in a second pass so that
    // multiple legacy versions sharing the same `StrategyDefinition`
    // don't cause duplicate-delete errors mid-loop.
    legacyVersionIds.add(legacy.id);
    legacyDefinitionIds.add(legacy.definitionId);

    removedLegacyDefinitions++;
    dedupedRefs.push(legacy.implementationRef);

    // Diagnostic so operators can see what happened. pino handles the
    // structured shape; we keep the side-effect narrow here.
    // eslint-disable-next-line no-console
    console.log(
      `[syncBuiltInStrategies] folded ${legacy.implementationRef} (def=${legacy.definitionId.slice(0, 8)}, ` +
        `candidates=${candidateUpdate.count}, leaderboardMigrated=${leaderboardMigrated}, leaderboardDeleted=${leaderboardDeleted}, ` +
        `ranking=${rankingUpdate.count}, compositeChild=${compositeChildUpdate.count}, ` +
        `compositeParent=${compositeParentUpdate.count}) -> ${canonical.id}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 1b — DELETE staged legacy rows
  //
  // Now that all FKs have been retargeted we can safely delete the
  // staged legacy versions. Cascade from the definition model will
  // take care of any residual version rows. `deleteMany` is safe to
  // call with a stale id set — Prisma's `P2025` ("record not found")
  // is silently absorbed because it implies someone else already
  // removed the row, which is exactly the desired end-state.
  // ─────────────────────────────────────────────────────────────────────
  if (legacyVersionIds.size > 0) {
    for (const id of legacyVersionIds) {
      await prisma.strategyVersion
        .delete({ where: { id } })
        .catch((err: { code?: string }) => {
          if (err.code !== "P2025") throw err;
        });
    }
  }
  if (legacyDefinitionIds.size > 0) {
    for (const definitionId of legacyDefinitionIds) {
      await prisma.strategyDefinition
        .delete({ where: { id: definitionId } })
        .catch((err: { code?: string }) => {
          if (err.code !== "P2025") throw err;
        });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 2 — UPSERT canonical rows + registry pointers
  // ─────────────────────────────────────────────────────────────────────
  for (const strategy of canonicalBuiltIns) {
    const version = await ensureCanonicalVersion(prisma, strategy, registeredRefs);
    if (version.wasCreated) {
      upsertedRefs.push(strategy.id);
    }
  }

  return {
    dedupedRefs,
    upsertedRefs,
    registeredRefs,
    removedLegacyDefinitions,
  };
}

/**
 * Ensure a single `StrategyDefinition` + active `StrategyVersion` +
 * enabled `StrategyRegistry` row exists for the supplied canonical
 * strategy. Mutates the schema in place; returns the version row and
 * whether it had to be created. Also pushes to `registeredRefs` when a
 * `StrategyRegistry` row was newly created.
 */
async function ensureCanonicalVersion(
  prisma: PrismaClient,
  strategy: Strategy,
  registeredRefs: string[],
): Promise<{ id: string; wasCreated: boolean }> {
  const family = upperFamily(strategy.family);
  if (!family) {
    throw new Error(
      `[syncBuiltInStrategies] strategy ${strategy.id} reported an unknown family: ${String(strategy.family)}`,
    );
  }
  const type: StrategyType = "BASE";

  // 1. Find the active version that already carries this implementationRef.
  const existing = await prisma.strategyVersion.findFirst({
    where: { implementationRef: strategy.id, isActive: true },
    include: { definition: true },
  });

  if (existing) {
    // Keep name + family in sync; do NOT mutate `version` because that's
    // an immutable audit trail.
    const desiredName = strategy.name ?? existing.name;
    let definition = existing.definition;
    if (
      definition.family !== family ||
      definition.type !== type ||
      desiredName !== existing.name
    ) {
      definition = await prisma.strategyDefinition.update({
        where: { id: definition.id },
        data: { family, type, description: existing.description ?? null },
      });
    }
    if (existing.name !== desiredName) {
      await prisma.strategyVersion.update({
        where: { id: existing.id },
        data: { name: desiredName },
      });
    }
    await ensureRegistryRow(prisma, definition.id, registeredRefs);
    return { id: existing.id, wasCreated: false };
  }

  // 2. Fresh row.
  const definition = await prisma.strategyDefinition.create({
    data: {
      type,
      family,
      description: "Built-in base strategy registered by StrategyRegistry.",
    },
  });
  const version = await prisma.strategyVersion.create({
    data: {
      definitionId: definition.id,
      version: "1.0.0",
      name: strategy.name ?? strategy.id,
      implementationRef: strategy.id,
      parameters: {},
      isActive: true,
    },
  });
  await ensureRegistryRow(prisma, definition.id, registeredRefs);
  return { id: version.id, wasCreated: true };
}

/** Idempotent: creates the registry pointer if missing. */
async function ensureRegistryRow(
  prisma: PrismaClient,
  definitionId: string,
  registeredRefs: string[],
): Promise<void> {
  const existing = await prisma.strategyRegistry.findUnique({
    where: { definitionId },
  });
  if (existing) {
    if (!existing.isEnabled) {
      await prisma.strategyRegistry.update({
        where: { id: existing.id },
        data: { isEnabled: true },
      });
    }
    return;
  }
  await prisma.strategyRegistry.create({
    data: { definitionId, isEnabled: true },
  });
  registeredRefs.push(definitionId);
}

/** Map registry-emitted family (a string literal) onto the Prisma enum. */
function upperFamily(family: Strategy["family"]): BuiltInFamily | null {
  const upper = String(family).toUpperCase();
  switch (upper) {
    case "TREND":
      return "TREND";
    case "MOMENTUM":
      return "MOMENTUM";
    case "STRUCTURE":
      return "STRUCTURE";
    case "VOLATILITY":
      return "VOLATILITY";
    case "SENTIMENT":
      return "SENTIMENT";
    default:
      return null;
  }
}

/**
 * Historical seed data spelled two strategies with PascalCase ids
 * (`Strategy.MACrossover`, `Strategy.RSIMomentum`). Now that the
 * runtime registry uses lowercase dotted ids (`strategy.ma`,
 * `strategy.rsi`), we map the legacy rows to their canonical
 * counterpart by family. Returning `undefined` lets the caller skip
 * (no canonical target for that legacy id).
 */
function inferCanonicalIdForLegacy(legacyRef: string): string | undefined {
  switch (legacyRef) {
    case "Strategy.MACrossover":
      return "strategy.ma";
    case "Strategy.RSIMomentum":
      return "strategy.rsi";
    default:
      return undefined;
  }
}
