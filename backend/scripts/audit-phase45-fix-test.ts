import { PrismaClient } from "@prisma/client";
import { bootstrapStrategies } from "../src/modules/strategy";
import { DomainGuidedGenerator } from "../src/modules/search/generators/DomainGuidedGenerator";
import { getStrategyRegistry } from "../src/modules/strategy/domain/StrategyRegistry";
import { StrategyVersionMapper } from "../src/modules/search/application/StrategyVersionMapper";
import {
  getCanonicalCompositeDisplayName,
  getCanonicalCompositeDisplayNameWithWeights,
} from "../src/modules/strategy/combination/CombinationConfig";

(async () => {
  bootstrapStrategies();
  const registry = getStrategyRegistry();
  const prisma = new PrismaClient();
  const mapper = new StrategyVersionMapper(prisma);

  // Build spaces exactly like SearchService.start() does
  const { buildParameterSpace } = await import("../src/modules/search/domain/ParameterSpace");
  const strategyIds = registry.list();
  const spaces: any[] = [];
  for (const id of strategyIds) {
    const strategy = registry.resolve(id);
    if (!strategy) continue;
    const space = buildParameterSpace(strategy.id, strategy.parameterSpec);
    if (space !== null) spaces.push(space);
  }

  const cfg = {
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
  } as any;

  const gen = new DomainGuidedGenerator();
  (gen as any).spaces = spaces;
  gen.applyConfig(cfg);
  gen.setRegistry(registry);

  // Generate 11 candidates, but DON'T actually persist them
  const cands: any[] = [];
  await gen.generate(
    async (c: any) => {
      cands.push(c);
      return true; // accept
    },
    () => false,
    { generatedCount: 0, queuedCount: 0, rejectedCount: 0, elapsedMs: 0 },
  );

  console.log(`Generated ${cands.length} candidates`);
  console.log("==================================================\n");

  // For each candidate, simulate the mapper's bootstrapComposite path (new SV)
  // then resolveCompositeStrategy (existing). Use a unique implementationRef
  // to force bootstrap, then re-resolve with same id.
  for (const c of cands) {
    // Force a unique implementationRef so bootstrap path runs
    const idUnique = c.config.id + "_audit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const freshConfig = { ...c.config, id: idUnique };
    console.log("CREATING:", idUnique);
    console.log("  config.name (passes in):", freshConfig.name);
    console.log(
      "  config.components:",
      freshConfig.components.map((comp: any) => `${comp.strategyId}@w=${comp.weight}`).join(", "),
    );

    const vInfo = await mapper.resolveCompositeStrategy(freshConfig, freshConfig.name);
    const sv = await prisma.strategyVersion.findUnique({ where: { id: vInfo.strategyVersionId } });
    console.log("  >>> persisted name:", sv?.name);
    console.log("  >>> persisted displayNameWithWeights:", sv?.displayNameWithWeights);

    // Now simulate a re-resolve (existing-version path) with same ID
    // but using a DIFFERENT name from a stale/wrong generator output
    const staleConfig = {
      ...freshConfig,
      name: "Stale-Domain-guided bollinger + ma", // simulate legacy name from old generator
    };
    const vInfo2 = await mapper.resolveCompositeStrategy(staleConfig, staleConfig.name);
    const sv2 = await prisma.strategyVersion.findUnique({ where: { id: vInfo2.strategyVersionId } });
    console.log("  >>> after RE-RESOLVE with stale name:");
    console.log("      name:", sv2?.name);
    console.log("      displayNameWithWeights:", sv2?.displayNameWithWeights);
    console.log("");

    // Cleanup
    await prisma.compositeComponent.deleteMany({ where: { compositeVersionId: sv?.id } });
    await prisma.strategyVersion.delete({ where: { id: sv?.id } });
    await prisma.strategyDefinition.delete({ where: { id: sv!.definitionId } });
  }

  await prisma.$disconnect();
  console.log("\nAll good!");
})();
