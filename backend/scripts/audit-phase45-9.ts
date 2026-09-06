import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // Get all candidates for 65d89c34 with their SV.id and name
  const candidates = await p.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
    include: {
      strategyVersion: {
        select: { id: true, name: true, implementationRef: true },
      },
    },
  });

  // Also get the composite components separately keyed by SV.id
  const candsDetailed = [];
  for (const c of candidates) {
    const components = await p.compositeComponent.findMany({
      where: { compositeVersionId: c.strategyVersionId },
      orderBy: { position: "asc" },
      include: {
        componentVersion: { select: { implementationRef: true } },
      },
    });
    candsDetailed.push({
      implRef: c.strategyVersion.implementationRef,
      name: c.strategyVersion.name,
      components: components.map((cc) => `${cc.componentVersion.implementationRef}@p${cc.position}`).join(" "),
    });
  }

  // Sort by implRef for clarity
  candsDetailed.sort((a, b) => a.implRef.localeCompare(b.implRef));
  for (const c of candsDetailed) {
    console.log(`${c.implRef.padEnd(42)} name="${c.name}"`);
    console.log(`  components: ${c.components}`);
  }
  await p.$disconnect();
})();
