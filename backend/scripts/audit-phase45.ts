import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const sr = await p.searchRun.findMany({
    where: { createdBy: "combination-builder" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, createdAt: true, config: true, maxCandidates: true },
  });
  for (const r of sr) {
    const cfg = r.config as any;
    const fgs = cfg?.familyGroups ?? [];
    console.log(
      "id=" + r.id.substring(0, 8),
      "maxCand=" + r.maxCandidates,
      "FG=" + fgs.map((g: any) => g.name + ":" + JSON.stringify(g.families)).join(" | "),
      "rF=" + JSON.stringify(cfg?.requiredFamilies ?? []),
      "minK=" + (cfg?.minComponents ?? "?"),
      "maxK=" + (cfg?.maxComponents ?? "?"),
      "mode=" + (cfg?.mode ?? "?"),
      "domainMode=" + (cfg?.domainMode ?? "?"),
    );
  }
  await p.$disconnect();
})();
