import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  // Look up SV "strategy.composite.domain_guided.0"
  const sv = await prisma.strategyVersion.findFirst({
    where: { implementationRef: "strategy.composite.domain_guided.0" },
  });
  console.log("SV:", sv?.id, sv?.name);
  // Look at composite_components where compositeVersionId = sv.id
  const children = await prisma.compositeComponent.findMany({
    where: { compositeVersionId: sv!.id },
  });
  console.log("composite_components WHERE compositeVersionId=sv.id:", children.length);
  for (const ch of children) {
    const cv = await prisma.strategyVersion.findUnique({ where: { id: ch.componentVersionId } });
    console.log("  comp:", cv?.implementationRef, "weight=", Number(ch.weight), "position=", ch.position);
  }
  await prisma.$disconnect();
})();
