import { PrismaClient } from "@prisma/client";
(async () => {
  const p = new PrismaClient();
  const totalComposite = await p.strategyVersion.count({ where: { definition: { type: "COMPOSITE" } } });
  const withDnw = await p.strategyVersion.count({ where: { definition: { type: "COMPOSITE" }, displayNameWithWeights: { not: null } } });
  console.log("composite SV total:", totalComposite);
  console.log("composite SV with displayNameWithWeights:", withDnw);
  // Also check distinct implRef prefixes
  const byPrefix = await p.strategyVersion.groupBy({
    by: ["implementationRef"],
    where: { definition: { type: "COMPOSITE" } },
    _count: true,
  });
  const byKind = {};
  for (const r of byPrefix) {
    const prefix = r.implementationRef.split(".").slice(0, 3).join(".");
    byKind[prefix] = (byKind[prefix] || 0) + r._count;
  }
  console.log("by implRef family:");
  for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}.* = ${v}`);
  await p.$disconnect();
})();
