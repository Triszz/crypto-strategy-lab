import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const candidates = await p.candidateStrategy.findMany({
    where: { searchRunId: "65d89c34-64c4-4602-82ab-aef150f14345" },
    orderBy: { createdAt: "asc" },
  });
  for (const c of candidates) {
    const sv = await p.strategyVersion.findUnique({
      where: { id: c.strategyVersionId },
      select: { createdAt: true, name: true, implementationRef: true },
    });
    console.log(`cand.createdAt=${c.createdAt.toISOString()} | sv.createdAt=${sv?.createdAt?.toISOString()} | implRef=${sv?.implementationRef} | name="${sv?.name}"`);
  }
  await p.$disconnect();
})();
