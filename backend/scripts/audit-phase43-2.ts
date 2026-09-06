// Audit script — investigate strategy registry + spaces for SENTIMENT family

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n========== STRATEGIES (definitions) ==========\n");
  const defs = await prisma.strategyDefinition.findMany({});
  for (const d of defs) {
    console.log(`  ${d.id.substring(0, 8)}  name=${d.name}  implRef=${d.implementationRef}  indicator=${d.indicatorTypeId?.substring(0, 8)}`);
  }

  console.log("\n========== INDICATOR TYPES ==========\n");
  const its = await prisma.indicatorType.findMany({});
  for (const it of its) {
    console.log(`  ${it.id.substring(0, 8)}  code=${it.code}  family=${it.family ?? "?"}`);
  }

  console.log("\n========== ALL STRATEGY VERSIONS (news_sentiment check) ==========\n");
  const svs = await prisma.strategyVersion.findMany({
    where: { implementationRef: { contains: "sentiment" } },
  });
  for (const sv of svs) {
    const def = await prisma.strategyDefinition.findUnique({ where: { id: sv.definitionId } });
    console.log(`  svId=${sv.id.substring(0, 8)}  implRef=${sv.implementationRef}  defId=${sv.definitionId.substring(0, 8)}  defImplRef=${def?.implementationRef}`);
  }

  console.log("\n========== ALL STRATEGY VERSIONS (count by implRef) ==========\n");
  const allSvs = await prisma.strategyVersion.findMany({
    select: { id: true, implementationRef: true, definitionId: true, indicatorTypeId: true },
  });
  const grouped = new Map<string, number>();
  for (const sv of allSvs) {
    grouped.set(sv.implementationRef, (grouped.get(sv.implementationRef) ?? 0) + 1);
  }
  for (const [k, v] of grouped) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\n========== SENTIMENT family check (search spaces) ==========\n");
  const sentSpaces = await prisma.strategyVersion.findMany({
    where: { OR: [{ implementationRef: { contains: "sentiment" } }, { implementationRef: { contains: "news" } }] },
  });
  console.log(`Found ${sentSpaces.length} spaces with sentiment/news in implRef`);
  for (const sv of sentSpaces) {
    console.log(`  implRef=${sv.implementationRef}`);
  }

  console.log("\n========== TRY TO LIST STRATEGIES BY FAMILY ==========\n");
  // The "spaces" in DomainGuidedGenerator come from the generator's config — they are StrategyVersion rows.
  // Let's check what families are actually in the registry.
  const sentVersions = await prisma.strategyVersion.findMany({
    include: { indicatorType: true },
  });
  for (const sv of sentVersions) {
    console.log(`  implRef=${sv.implementationRef.padEnd(50)} indicatorFamily=${sv.indicatorType?.family ?? "?"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
