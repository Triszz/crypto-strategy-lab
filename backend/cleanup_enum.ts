import { getPrismaClient } from "./src/infrastructure/database/prisma";

async function main() {
  const prisma = getPrismaClient();

  // Clean up the wrong enum left from the previous attempt
  // The CombinationOperator enum is the correct one to keep.
  console.log("Dropping leftover 'combination_operator' enum...");
  await prisma.$executeRaw`DROP TYPE IF EXISTS combination_operator CASCADE`;
  console.log("  done.");

  // Verify all current types
  const types = await prisma.$queryRaw<Array<{ typname: string; typtype: string }>>`
    SELECT typname, typtype FROM pg_type WHERE typname ILIKE '%combination%'
  `;
  console.log("\nCombination-related types:");
  for (const t of types) {
    console.log(`  ${t.typname} (${t.typtype})`);
  }

  // Verify the saved_combinations table exists
  const cols = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_combinations'
    ORDER BY ordinal_position
  `;
  console.log("\nsaved_combinations columns:");
  for (const c of cols) {
    console.log(`  ${c.column_name} (${c.data_type})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
