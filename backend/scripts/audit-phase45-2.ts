import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  // The two runs that DO have the SENTIMENT family group
  for (const id of ["65d89c34-64c4-4602-82ab-aef150f14345", "c0a13b33-dd5f-4263-9216-b0dfc1603c76", "7a94a3df-93e7-4205-8bc7-3e699947e12b"]) {
    const sr = await p.searchRun.findFirst({ where: { id } });
    if (!sr) continue;
    console.log("\n=== SearchRun " + sr.id + " ===");
    console.log("createdBy=" + sr.createdBy);
    console.log("config=" + JSON.stringify(sr.config));

    const cands = await p.candidateStrategy.findMany({
      where: { searchRunId: sr.id },
      include: {
        strategyVersion: {
          include: {
            definition: true,
            compositeChild: { include: { componentVersion: { include: { definition: true } } } },
          },
        },
      },
    });
    console.log(`Candidates: ${cands.length}`);
    for (const c of cands) {
      const componentStrs = c.strategyVersion.compositeChild.map(
        (cc) =>
          (cc.componentVersion.definition.implementationRef ?? "?") +
          "/w=" +
          Number(cc.weight).toFixed(2),
      );
      console.log(
        "  implRef=" + c.strategyVersion.implementationRef,
        "components=[" + componentStrs.join(", ") + "]",
      );
    }
  }
  await p.$disconnect();
})();
