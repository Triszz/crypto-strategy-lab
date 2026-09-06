import { PrismaClient } from "@prisma/client";
import {
  getCanonicalCompositeDisplayName,
} from "../src/modules/strategy/combination/CombinationConfig";
import { bootstrapStrategies } from "../src/modules/strategy";

(async () => {
  bootstrapStrategies();
  const prisma = new PrismaClient();

  // Take ONE SV and inspect its components and the canonical name
  const sv = await prisma.strategyVersion.findFirst({
    where: { implementationRef: "strategy.composite.domain_guided.0" },
    include: {
      compositeChild: { include: { componentVersion: true }, orderBy: { position: "asc" } },
    },
  });

  if (!sv) { await prisma.$disconnect(); return; }
  console.log(`SV id=${sv.id} name="${sv.name}" implRef=${sv.implementationRef}`);
  const components = sv.compositeChild.map((c) => ({
    strategyId: c.componentVersion.implementationRef,
    weight: Number(c.weight),
    position: c.position,
  }));
  console.log("components:", components);
  console.log("canonical name from helper:", getCanonicalCompositeDisplayName({
    id: sv.implementationRef,
    name: sv.name,
    components: components as any,
    operator: "WEIGHTED" as any,
  }));

  await prisma.$disconnect();
})();
