/**
 * search · application · StrategyVersionMapper
 *
 * Resolves runtime strategy ids to database StrategyVersion UUIDs.
 *
 * Architecture:
 *
 *   SearchCandidate
 *       │
 *       ├── BASE:  strategyId = "strategy.ma"
 *       │            ↓
 *       │         StrategyDefinition (find/create by implementationRef)
 *       │            ↓
 *       │         StrategyVersion (find/create)
 *       │            ↓
 *       │         strategyVersionId (UUID)
 *       │
 *       └── COMPOSITE: config.components[].strategyId = "strategy.ma"
 *                        ↓
 *                     StrategyVersion (find by implementationRef)
 *                        ↓
 *                     componentVersionId (UUID for CompositeComponent)
 *
 * The mapper lives in the application layer — it touches Prisma directly.
 */
import type { PrismaClient } from "@prisma/client";
import type { CombinationConfig } from "../../strategy/combination/CombinationConfig";
import { logger } from "../../../shared/logger/logger";

export interface StrategyVersionInfo {
  readonly strategyVersionId: string;
  readonly definitionId: string;
  readonly definitionType: "BASE" | "COMPOSITE";
}

export class StrategyVersionMapper {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly log: typeof logger = logger,
  ) {}

  /**
   * Resolve a BASE strategy's `implementationRef` to its current active
   * `StrategyVersion.id`.
   *
   * @param implementationRef  Matches `Strategy.id`, e.g. `"strategy.ma"`.
   * @param strategyName      Human-readable name for bootstrap.
   */
  public async resolveBaseStrategy(
    implementationRef: string,
    strategyName: string,
  ): Promise<StrategyVersionInfo> {
    // Look for an existing active version by implementationRef
    const existingVersion = await this.prisma.strategyVersion.findFirst({
      where: { implementationRef, isActive: true },
    });

    if (existingVersion) {
      const def = await this.prisma.strategyDefinition.findUnique({
        where: { id: existingVersion.definitionId },
      });
      return {
        strategyVersionId: existingVersion.id,
        definitionId: existingVersion.definitionId,
        definitionType: (def?.type ?? "BASE") as "BASE" | "COMPOSITE",
      };
    }

    // Bootstrap: create definition + version
    this.log.info({ implementationRef }, "search.StrategyVersionMapper.bootstrap");
    const newDef = await this.prisma.strategyDefinition.create({
      data: { type: "BASE", family: "TREND" },
    });

    const version = await this.prisma.strategyVersion.create({
      data: {
        definitionId: newDef.id,
        version: "1.0.0",
        name: strategyName,
        implementationRef,
        parameters: {},
        isActive: true,
      },
    });

    return {
      strategyVersionId: version.id,
      definitionId: newDef.id,
      definitionType: "BASE",
    };
  }

  /**
   * Resolve a COMPOSITE candidate's `CombinationConfig` to its
   * `StrategyVersion.id`.
   *
   * Each component's `strategyId` (runtime `implementationRef`) is looked up
   * to produce `componentVersionId` for the `CompositeComponent` rows.
   *
   * @param config        The CombinationConfig from the CompositeCandidate.
   * @param strategyName  Human-readable name.
   */
  public async resolveCompositeStrategy(
    config: CombinationConfig,
    strategyName: string,
  ): Promise<StrategyVersionInfo> {
    // Find or create the composite definition
    const existingDef = await this.prisma.strategyDefinition.findFirst({
      where: { id: config.id, type: "COMPOSITE" },
      include: {
        versions: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    let definitionId: string;

    if (existingDef && existingDef.versions.length > 0) {
      definitionId = existingDef.id;
    } else {
      this.log.info({ configId: config.id }, "search.StrategyVersionMapper.bootstrapComposite");
      const newDef = await this.prisma.strategyDefinition.create({
        data: { type: "COMPOSITE", family: "TREND" },
      });
      definitionId = newDef.id;
    }

    // Get or create the active version
    let versionId: string;
    const existingVersions = await this.prisma.strategyVersion.findMany({
      where: { definitionId, isActive: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (existingVersions.length > 0) {
      versionId = existingVersions[0]!.id;
    } else {
      const version = await this.prisma.strategyVersion.create({
        data: {
          definitionId,
          version: "1.0.0",
          name: strategyName,
          implementationRef: config.id,
          parameters: {},
          isActive: true,
        },
      });
      versionId = version.id;
    }

    // Sync CompositeComponent rows
    await this.prisma.compositeComponent.deleteMany({
      where: { compositeVersionId: versionId },
    });

    for (const component of config.components) {
      // Resolve each component's strategyId → StrategyVersion.id
      const componentVersion = await this.prisma.strategyVersion.findFirst({
        where: { implementationRef: component.strategyId, isActive: true },
      });

      if (!componentVersion) {
        throw new Error(
          `StrategyVersionMapper: no active version found for implementationRef "${component.strategyId}"`,
        );
      }

      await this.prisma.compositeComponent.create({
        data: {
          compositeVersionId: versionId,
          componentVersionId: componentVersion.id,
          weight: component.weight,
          position: component.position,
        },
      });
    }

    return {
      strategyVersionId: versionId,
      definitionId,
      definitionType: "COMPOSITE",
    };
  }
}
