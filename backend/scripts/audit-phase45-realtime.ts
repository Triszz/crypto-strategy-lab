import { PrismaClient } from "@prisma/client";
import { bootstrapStrategies } from "../src/modules/strategy";
import { DomainGuidedGenerator } from "../src/modules/search/generators/DomainGuidedGenerator";
import { getStrategyRegistry } from "../src/modules/strategy/domain/StrategyRegistry";

(async () => {
  bootstrapStrategies();
  const registry = getStrategyRegistry();

  // Mimic the SearchService.start() building of spaces
  const strategyIds = registry.list();
  console.log("Registry list:", strategyIds);

  const spaces: any[] = [];
  const { buildParameterSpace } = await import("../src/modules/search/domain/ParameterSpace");
  for (const id of strategyIds) {
    const strategy = registry.resolve(id);
    if (!strategy) continue;
    const space = buildParameterSpace(strategy.id, strategy.parameterSpec);
    if (space !== null) spaces.push(space);
  }
  console.log("\nSpaces:", spaces.map((s) => s.strategyId));

  // User-selected family groups (frontend payload)
  const userPayload = {
    mode: "EXHAUSTIVE",
    domainMode: "GUIDED",
    familyGroups: [
      { name: "trend", families: ["TREND"] },
      { name: "momentum", families: ["MOMENTUM"] },
      { name: "structure", families: ["STRUCTURE"] },
      { name: "information", families: ["SENTIMENT"] },
    ],
    maxComponents: 4,
    minComponents: 2,
    requiredFamilies: ["TREND", "MOMENTUM", "STRUCTURE", "SENTIMENT"],
  };

  const gen = new DomainGuidedGenerator();
  (gen as any).spaces = spaces;
  gen.applyConfig(userPayload as any);
  gen.setRegistry(registry);

  const out: any[] = [];
  await gen.generate(
    async (cand: any) => {
      out.push({
        name: cand.config.name,
        components: cand.config.components.map((c: any) => c.strategyId),
      });
      return true;
    },
    () => false,
    { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
  );

  console.log("\n=== Generated candidates ===");
  for (const c of out) {
    console.log(`name="${c.name}" | components=[${c.components.join(", ")}]`);
  }
  console.log("Total:", out.length);
  process.exit(0);
})();
