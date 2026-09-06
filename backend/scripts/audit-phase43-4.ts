import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const srs = await p.searchRun.findMany({
    where: { id: { in: ['2eea25a0-009e-40cb-bcc3-636b2da61a56', '2eea25a0-3ff3-4863-be36-025b5b4e8518'] } },
    select: { id: true, config: true, createdAt: true, createdBy: true },
  });
  console.log("Found", srs.length, "search runs");
  for (const sr of srs) console.log(JSON.stringify({id: sr.id.substring(0, 8), createdAt: sr.createdAt, createdBy: sr.createdBy, config: sr.config}, null, 2));
  await p.$disconnect();
})();
