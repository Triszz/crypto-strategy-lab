import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const loops = await p.loopRunState.findMany({ orderBy: { startedAt: "desc" }, take: 3 });
  for (const l of loops) console.log(l.loopId, l.status);
  await p.$disconnect();
})();
