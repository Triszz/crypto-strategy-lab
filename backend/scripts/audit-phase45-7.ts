import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // Find SearchRuns created today, group by status
  const today = new Date("2026-09-06T00:00:00Z");
  const recent = await p.searchRun.findMany({
    where: { createdAt: { gte: today } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, createdBy: true, config: true },
  });
  console.log("Total SearchRuns today:", recent.length);
  for (const r of recent) {
    const cfg = r.config as any;
    const fams = (cfg?.familyGroups ?? []).map((g: any) => `${g.name}:${JSON.stringify(g.families)}`).join(" | ");
    console.log(`${r.id.substring(0, 8)} | ${r.createdAt.toISOString()} | createdBy=${r.createdBy} | ${fams}`);
  }
  await p.$disconnect();
})();
