import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // 1. Find the actual composite SV for one of the candidates
  const cand = await p.candidateStrategy.findFirst({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
  });
  if (!cand) return;
  const sv = await p.strategyVersion.findUnique({ where: { id: cand.strategyVersionId } });
  console.log("Composite SV.id=" + sv?.id);
  console.log("Composite SV.implementationRef=" + sv?.implementationRef);
  console.log("Composite SV.name=" + sv?.name);
  console.log("Composite SV.parameters=" + JSON.stringify(sv?.parameters).substring(0, 500));

  // List all relations from this SV
  console.log("\n-- List all relations where compositeVersionId=" + sv?.id);
  const direct = await p.compositeComponent.findMany({ where: { compositeVersionId: sv?.id } });
  console.log("compositeComponent rows:", direct.length);

  const all = await p.compositeComponent.findMany({ where: { compositeVersionId: sv?.id } });
  console.log("all rows:", all.length);
  for (const row of all) {
    console.log("  row:", JSON.stringify(row));
  }

  await p.$disconnect();
})();
