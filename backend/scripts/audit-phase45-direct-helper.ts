import {
  getCanonicalCompositeDisplayName,
  getCanonicalCompositeDisplayNameWithWeights,
} from "../src/modules/strategy/combination/CombinationConfig";
import { bootstrapStrategies } from "../src/modules/strategy";
bootstrapStrategies();
const config = {
  id: "strategy.composite.domain_guided.0",
  name: "Domain-guided bollinger + ma",
  components: [
    { strategyId: "strategy.ma", weight: 0.5, position: 0 },
    { strategyId: "strategy.rsi", weight: 0.5, position: 1 },
  ],
  operator: "WEIGHTED" as any,
};
console.log("canonicalName =", JSON.stringify(getCanonicalCompositeDisplayName(config as any)));
console.log("canonicalNameWW =", JSON.stringify(getCanonicalCompositeDisplayNameWithWeights(config as any)));
