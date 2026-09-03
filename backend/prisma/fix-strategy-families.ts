/* eslint-disable no-console */
/**
 * One-shot data fix: align StrategyDefinition.family with the canonical
 * taxonomy reported by the in-process StrategyRegistry.
 *
 * Why: the original DB seed stamped every BASE definition with
 *   family=TREND  (regardless of whether it was MA, RSI, Bollinger…).
 * That produced wrong-coloured pills in Discovery and wrong tooltips on
 * hover. The runtime code now prefers the registry's family, but this
 * script back-fills the rows so reports / exports that read the column
 * directly also stay consistent.
 *
 * Run:
 *   npx tsx prisma/fix-strategy-families.ts
 */
import { PrismaClient, StrategyFamily } from "@prisma/client";
import { bootstrapStrategies, getStrategyRegistry } from "../src/modules/strategy";

const prisma = new PrismaClient();

interface Fix {
  readonly ref: string;
  readonly family: StrategyFamily;
}

const FALLBACK_FAMILY = StrategyFamily.TREND;

async function main(): Promise<void> {
  // Make sure every built-in strategy is registered so we can ask the
  // registry for the canonical family.
  bootstrapStrategies();
  const registry = getStrategyRegistry();

  const refs = registry.list();

  // Build the desired mapping from registry (canonical) — fall back to
  // the registry list alone for strategies that weren't registered.
  const desired = new Map<string, StrategyFamily>();
  for (const ref of refs) {
    const s = registry.resolve(ref);
    if (!s?.family) continue;
    // The registry reports families as string literals (e.g. "VOLATILITY");
    // convert into the Prisma enum.
    const upper = String(s.family).toUpperCase();
    const asEnum = (StrategyFamily as Record<string, StrategyFamily>)[upper];
    if (asEnum) desired.set(ref, asEnum);
  }

  // Walk every active StrategyVersion, resolve its definition, and
  // update the definition's family where it disagrees with the registry.
  const versions = await prisma.strategyVersion.findMany({
    where: { isActive: true },
    select: {
      implementationRef: true,
      definitionId: true,
    },
  });

  const updatesByDefinition = new Map<string, { family: StrategyFamily }>();
  let scanned = 0;
  for (const v of versions) {
    scanned++;
    const want = desired.get(v.implementationRef) ?? FALLBACK_FAMILY;
    const def = await prisma.strategyDefinition.findUnique({
      where: { id: v.definitionId },
      select: { family: true },
    });
    if (!def) continue;
    if (def.family !== want) {
      const existing = updatesByDefinition.get(v.definitionId);
      if (!existing) {
        updatesByDefinition.set(v.definitionId, { family: want });
      }
    }
  }

  console.log(
    `Scanned ${scanned} active versions across ${versions.length === 0 ? 0 : new Set(versions.map(v => v.definitionId)).size} definitions.`,
  );
  console.log(`Planning ${updatesByDefinition.size} definition update(s):`);

  let applied = 0;
  for (const [definitionId, { family }] of updatesByDefinition) {
    const def = await prisma.strategyDefinition.findUnique({
      where: { id: definitionId },
      include: { versions: { select: { implementationRef: true, name: true } } },
    });
    if (!def) continue;
    // Only flip away from TREND when the registry says otherwise. This
    // prevents accidentally overwriting intentionally-curated non-TREND
    // families (e.g. custom / external strategies that aren't in the
    // registry). Any future non-TREND value that needs correction should
    // be added to the registry or handled as a separate migration.
    if (def.family === StrategyFamily.TREND && family !== StrategyFamily.TREND) {
      console.log(
        `  definition ${definitionId.slice(0, 8)} ${def.family} -> ${family}  (versions: ${def.versions.map((v) => v.implementationRef).join(", ")})`,
      );
      await prisma.strategyDefinition.update({
        where: { id: definitionId },
        data: { family },
      });
      applied++;
    } else {
      console.log(
        `  SKIP definition ${definitionId.slice(0, 8)} already has family=${def.family}, registry wants=${family}`,
      );
    }
  }

  console.log(`Applied ${applied} update(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
