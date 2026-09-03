/* eslint-disable no-console */
/**
 * Standalone CLI: synchronise built-in strategy rows with the runtime
 * StrategyRegistry. Idempotent. Re-runs are no-ops once the DB is in a
 * healthy state.
 *
 *   npx tsx prisma/sync-builtin-strategies.ts
 *
 * Safe to run against a production DB — it only adds missing rows,
 * folds legacy duplicates, and never deletes user-saved data.
 */
import { PrismaClient } from "@prisma/client";
import {
  bootstrapStrategies,
} from "../src/modules/strategy/strategies/bootstrap";
import {
  syncBuiltInStrategies,
} from "../src/modules/strategy/persistence/builtInStrategies";

async function main(): Promise<void> {
  // Bootstrap the runtime registry first so the persistence helper has
  // a fully-populated list of canonical strategies to mirror.
  bootstrapStrategies();

  const prisma = new PrismaClient();
  try {
    const report = await syncBuiltInStrategies(prisma);

    console.log("\n[syncBuiltInStrategies] Done.");
    console.log(
      `  deduped legacy refs:           ${report.dedupedRefs.length === 0 ? "(none)" : report.dedupedRefs.join(", ")}`,
    );
    console.log(
      `  newly upserted canonical refs: ${report.upsertedRefs.length === 0 ? "(none)" : report.upsertedRefs.join(", ")}`,
    );
    console.log(
      `  registry pointers registered:  ${report.registeredRefs.length === 0 ? "(none)" : report.registeredRefs.join(", ")}`,
    );
    console.log(
      `  legacy definitions removed:    ${report.removedLegacyDefinitions}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("[syncBuiltInStrategies] failed:", err);
  process.exit(1);
});
