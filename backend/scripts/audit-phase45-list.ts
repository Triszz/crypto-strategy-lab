import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const all = await p.searchRun.findMany({
    where: { createdBy: "combination-builder" },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const r of all) console.log(r.id, r.createdAt.toISOString());
  await p.$disconnect();
})();
