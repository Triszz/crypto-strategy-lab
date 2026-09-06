import { PrismaClient } from "@prisma/client";
import {
  getCanonicalCompositeDisplayName,
  getCanonicalCompositeDisplayNameWithWeights,
} from "../src/modules/strategy/combination/CombinationConfig";
import { getStrategyRegistry } from "../src/modules/strategy/domain/StrategyRegistry";
import { bootstrapStrategies } from "../src/modules/strategy";

/**
 * Phase 4.5: One-shot demo-stabilization backfill.
 *
 * For every COMPOSITE StrategyVersion, derive the canonical display
 * names from its persisted composite_components (components + weights)
 * and overwrite `name` and `displayNameWithWeights` if they differ.
 *
 *   - historical rows whose name was the legacy "Domain-guided … "
 *     short format (the bug class) now get re-derived from the
 *     authoritative components, so the display label finally agrees
 *     with the underlying composite components.
 *
 *   - rows that already have canonical names are skipped (idempotent).
 *
 * Constraints respected:
 *   - No deletion of historical data.
 *   - No schema change (column already added by 20260906220000_… migration).
 *   - Re-uses the existing canonical-name helpers (no new naming algorithm).
 */

(async () => {
  bootstrapStrategies();
  const registry = getStrategyRegistry();
  const prisma = new PrismaClient();

  // Pull every COMPOSITE StrategyVersion
  const svs = await prisma.strategyVersion.findMany({
    where: { definition: { type: "COMPOSITE" } },
    include: {
      definition: true,
      // `compositeParent` = rows in CompositeComponent where THIS sv is the
      // *composite* side (i.e. parent). `compositeChild` would be wrong:
      // it would follow rows where this sv is the *component* (child).
      compositeParent: {
        include: { componentVersion: { include: { definition: true } } },
        orderBy: { position: "asc" },
      },
    },
  });

  console.log(`Backfilling ${svs.length} COMPOSITE StrategyVersions...`);

  let updated = 0;
  let skipped = 0;
  for (const sv of svs) {
    const components = sv.compositeParent.map((c) => ({
      strategyId: c.componentVersion.implementationRef,
      weight: Number(c.weight),
      position: c.position,
    }));
    if (components.length < 2) {
      skipped++;
      continue;
    }

    // The mapper uses the registry to look up labels. The helpers also call
    // registry.resolve(); so we mirror that.
    // The display helper expects components in position order:
    //   [...config.components].sort((a,b)=>(a.position??0)-(b.position??0))
    // We persist already sorted, but we still hand the canonical helper
    // a config object in the same shape it would receive from the generator.
    const sortedComponents = [...components].sort(
      (a, b) => a.position - b.position,
    );

    const config = {
      id: sv.implementationRef,
      name: sv.name, // ignored by helpers
      components: sortedComponents,
      operator: "WEIGHTED" as const,
    };

    const canonicalName = getCanonicalCompositeDisplayName(config as any);
    const canonicalNameWithWeights =
      getCanonicalCompositeDisplayNameWithWeights(config as any);

    const nameChanged = sv.name !== canonicalName;
    const dnwwChanged = sv.displayNameWithWeights !== canonicalNameWithWeights;

    if (nameChanged || dnwwChanged) {
      await prisma.strategyVersion.update({
        where: { id: sv.id },
        data: {
          ...(nameChanged ? { name: canonicalName } : {}),
          ...(dnwwChanged ? { displayNameWithWeights: canonicalNameWithWeights } : {}),
        },
      });
      updated++;
      if (updated <= 5 || updated % 20 === 0) {
        console.log(
          `  [${updated}/${svs.length}] SV=${sv.id.substring(0, 8)}  prev="${sv.name}"  -> "${canonicalName}"`,
        );
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}, total=${svs.length}`);
  await prisma.$disconnect();
})();
