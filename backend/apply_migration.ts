import { getPrismaClient } from "./src/infrastructure/database/prisma";

async function main() {
  const prisma = getPrismaClient();

  // First, clean up any wrongly-named enum from prior partial attempts
  await prisma.$executeRaw`DROP TYPE IF EXISTS combination_operator`.catch(() => {});

  console.log("Step 1 — ensure CombinationOperator enum exists (correct name for Prisma)...");
  await prisma.$executeRaw`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'CombinationOperator'
      ) THEN
        CREATE TYPE "CombinationOperator" AS ENUM ('AND', 'OR', 'MAJORITY_VOTE', 'WEIGHTED');
      END IF;
    END
    $$;
  `;
  console.log("  enum ready.");

  // Drop + recreate the table so it uses the correct enum name
  console.log("Step 2 — recreate saved_combinations table with correct enum...");
  await prisma.$executeRaw`DROP TABLE IF EXISTS "saved_combinations" CASCADE`;
  await prisma.$executeRaw`
    CREATE TABLE "saved_combinations" (
      "id"          uuid         NOT NULL  DEFAULT gen_random_uuid(),
      "name"        varchar(255) NOT NULL,
      "description" varchar(1000),
      "operator"   "CombinationOperator" NOT NULL DEFAULT 'WEIGHTED',
      "components"  json         NOT NULL  DEFAULT '[]',
      "tags"        text[]       NOT NULL  DEFAULT '{}',
      "owner_id"    varchar(64),
      "created_at"  timestamptz  NOT NULL  DEFAULT now(),
      "updated_at"  timestamptz  NOT NULL  DEFAULT now(),
      CONSTRAINT "saved_combinations_pkey" PRIMARY KEY ("id")
    )
  `;
  console.log("  table created.");

  console.log("Step 3 — ensure indexes exist...");
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "saved_combinations_owner_id_created_at_idx"
      ON "saved_combinations" ("owner_id", "created_at" DESC)
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "saved_combinations_created_at_idx"
      ON "saved_combinations" ("created_at" DESC)
  `;
  console.log("  indexes ready.");

  console.log("\nStep 4 — verify Prisma can read the new table...");
  const count: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*)::bigint AS count FROM saved_combinations
  `;
  console.log(`  saved_combinations row count: ${count[0]?.count ?? "?"}`);

  console.log("\nStep 5 — test Prisma write + read round-trip...");
  const saved = await prisma.savedCombination.create({
    data: {
      name: "migration-verify",
      operator: "WEIGHTED",
      components: [
        { strategyId: "strategy.ma", weight: 1, position: 0 },
      ],
    },
  });
  console.log(`  created: id=${saved.id}`);

  const found = await prisma.savedCombination.findUnique({ where: { id: saved.id } });
  console.log(`  found: name=${found?.name}`);

  await prisma.savedCombination.delete({ where: { id: saved.id } });
  console.log("  test row deleted.");

  console.log("\n✓ All steps completed successfully.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗ Migration failed:", e.message);
  process.exit(1);
});
