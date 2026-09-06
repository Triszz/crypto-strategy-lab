import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // First, resolve one component manually
  const sv = await p.strategyVersion.findUnique({
    where: { id: "f91e6172-af2f-4142-a605-297f053c559d" },
  });
  console.log("Component SV direct:", JSON.stringify({ id: sv?.id, impl: sv?.implementationRef, name: sv?.name, params: sv?.parameters }));

  // Try to access definition relation
  const svWithDef = await p.strategyVersion.findUnique({
    where: { id: "f91e6172-af2f-4142-a605-297f053c559d" },
    include: { definition: true },
  });
  console.log("With definition:", JSON.stringify({ id: svWithDef?.id, definition: svWithDef?.definition }, null, 2));

  // Now query by definition separately
  const def = await p.strategyDefinition.findFirst({
    where: { versions: { some: { id: "f91e6172-af2f-4142-a605-297f053c559d" } } },
  });
  console.log("Definition via findFirst:", def?.implementationRef);

  await p.$disconnect();
})();
