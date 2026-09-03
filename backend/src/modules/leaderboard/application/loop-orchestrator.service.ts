import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { getEventBus, EventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";

export interface LoopConfig {
  loopId: string;
  maxCandidates?: number;       // e.g. 100
  timeLimitSeconds?: number;    // e.g. 3600 (1h)
  noImprovementCap?: number;    // e.g. 50 iterations
}

export type LoopStatus =
  | "RUNNING"
  | "PAUSED"
  | "STOPPED_MAX_CANDIDATES"
  | "STOPPED_TIMEOUT"
  | "STOPPED_NO_IMPROVEMENT"
  | "STOPPED_MANUAL";

export class LoopOrchestratorService {
  private prisma = getPrismaClient();

  constructor(private readonly eventBus: EventBus = getEventBus()) {
    this.registerEventListener();
  }

  private registerEventListener(): void {
    this.eventBus.subscribe<{
      strategyVersionId: string;
      overallScore: number;
    }>("StrategyEvaluated", (payload) => {
      void this.handleStrategyEvaluatedForLoop(payload);
    });
  }

  public async startLoop(config: LoopConfig): Promise<void> {
    const loopId = config.loopId || `loop-${Date.now()}`;
    const maxCandidates = config.maxCandidates || 100;
    const timeLimitSeconds = config.timeLimitSeconds || 3600;
    const noImprovementCap = config.noImprovementCap || 50;

    await this.prisma.loopRunState.upsert({
      where: { loopId },
      update: {
        status: "RUNNING",
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        totalEvaluated: 0,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
        updatedAt: new Date(),
      },
      create: {
        loopId,
        status: "RUNNING",
        maxCandidates,
        timeLimitSeconds,
        noImprovementCap,
        totalEvaluated: 0,
        noImprovementCount: 0,
        bestScoreSoFar: 0,
      },
    });

    logger.info({ loopId, maxCandidates, timeLimitSeconds, noImprovementCap }, "Continuous Strategy Loop started");
    this.eventBus.publish("LoopStatusChanged", { loopId, status: "RUNNING" });
  }

  public async pauseLoop(loopId: string): Promise<void> {
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: { status: "PAUSED" },
    });
    this.eventBus.publish("LoopStatusChanged", { loopId, status: "PAUSED" });
  }

  public async stopLoop(loopId: string, reason: LoopStatus = "STOPPED_MANUAL"): Promise<void> {
    await this.prisma.loopRunState.update({
      where: { loopId },
      data: { status: reason },
    });
    logger.info({ loopId, reason }, "Continuous Strategy Loop stopped");
    this.eventBus.publish("LoopStatusChanged", { loopId, status: reason });
  }

  public async getLoopState(loopId: string) {
    return this.prisma.loopRunState.findUnique({ where: { loopId } });
  }

  private async handleStrategyEvaluatedForLoop(payload: {
    strategyVersionId: string;
    overallScore: number;
  }): Promise<void> {
    const activeLoops = await this.prisma.loopRunState.findMany({
      where: { status: "RUNNING" },
    });

    for (const loop of activeLoops) {
      const newTotalEvaluated = loop.totalEvaluated + 1;
      const currentBest = Number(loop.bestScoreSoFar);
      const newScore = payload.overallScore;

      let isImprovement = false;
      let newBest = currentBest;
      let newNoImpCount = loop.noImprovementCount + 1;

      if (newScore > currentBest) {
        isImprovement = true;
        newBest = newScore;
        newNoImpCount = 0; // reset counter
      }

      // Check 3 Stop Conditions
      const elapsedSeconds = (Date.now() - loop.startedAt.getTime()) / 1000;
      let stopReason: LoopStatus | null = null;

      if (newTotalEvaluated >= loop.maxCandidates) {
        stopReason = "STOPPED_MAX_CANDIDATES";
      } else if (elapsedSeconds >= loop.timeLimitSeconds) {
        stopReason = "STOPPED_TIMEOUT";
      } else if (newNoImpCount >= loop.noImprovementCap) {
        stopReason = "STOPPED_NO_IMPROVEMENT";
      }

      const nextStatus = stopReason || "RUNNING";

      await this.prisma.loopRunState.update({
        where: { id: loop.id },
        data: {
          totalEvaluated: newTotalEvaluated,
          bestScoreSoFar: newBest,
          noImprovementCount: newNoImpCount,
          status: nextStatus,
        },
      });

      if (stopReason) {
        logger.info({ loopId: loop.loopId, stopReason, totalEvaluated: newTotalEvaluated }, "Stop Condition triggered");
        this.eventBus.publish("LoopStatusChanged", { loopId: loop.loopId, status: stopReason });
      }
    }
  }
}
