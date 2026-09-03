import { getPrismaClient } from "../../../infrastructure/database";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { logger } from "../../../shared/logger/logger";

export interface CompletionTrackerResult {
  isCompleted: boolean;
  searchRunId?: string;
  finishedCount: number;
  totalCandidates: number;
}

export class BacktestCompletionTracker {
  /**
   * Checks if all candidates for a given CandidateStrategy's SearchRun have finished backtesting.
   * If terminal_count >= total_candidates, updates the SearchRun status to 'DONE'
   * and publishes SearchRunCompleted event.
   */
  public async checkCompletionByCandidateId(candidateId?: string): Promise<CompletionTrackerResult> {
    if (!candidateId) {
      return { isCompleted: false, finishedCount: 0, totalCandidates: 0 };
    }

    try {
      const prisma = getPrismaClient();
      const candidate = await prisma.candidateStrategy.findUnique({
        where: { id: candidateId },
        select: { searchRunId: true },
      });

      if (!candidate || !candidate.searchRunId) {
        return { isCompleted: false, finishedCount: 0, totalCandidates: 0 };
      }

      return await this.checkCompletionBySearchRunId(candidate.searchRunId);
    } catch (err: any) {
      logger.warn({ err: err.message, candidateId }, "Completion check by candidateId failed");
      return { isCompleted: false, finishedCount: 0, totalCandidates: 0 };
    }
  }

  /**
   * Directly checks completion status for a SearchRun ID.
   */
  public async checkCompletionBySearchRunId(searchRunId: string): Promise<CompletionTrackerResult> {
    try {
      const prisma = getPrismaClient();
      const searchRun = await prisma.searchRun.findUnique({
        where: { id: searchRunId },
        include: {
          _count: {
            select: { candidates: true },
          },
        },
      });

      if (!searchRun) {
        return { isCompleted: false, finishedCount: 0, totalCandidates: 0 };
      }

      const totalCandidates = searchRun._count.candidates;
      const finishedCount = await prisma.candidateStrategy.count({
        where: {
          searchRunId,
          status: { in: ["DONE", "FAILED", "SKIPPED"] },
        },
      });

      const isCompleted = finishedCount > 0 && (finishedCount >= totalCandidates || finishedCount >= searchRun.maxCandidates);

      if (isCompleted && searchRun.status !== "DONE") {
        await prisma.searchRun.update({
          where: { id: searchRunId },
          data: {
            status: "DONE",
            finishedAt: new Date(),
          },
        });

        logger.info(
          { searchRunId, finishedCount, totalCandidates, maxCandidates: searchRun.maxCandidates },
          "SearchRun completed all candidates backtest 100%",
        );

        try {
          getEventBus().publish("SearchRunCompleted", {
            searchRunId,
            finishedCount,
            totalCandidates,
            completedAt: new Date().toISOString(),
          });

          getEventBus().publish("SearchCompleted", {
            searchRunId,
            totalCandidates: finishedCount,
            completedAt: new Date().toISOString(),
          });
        } catch (eventErr: any) {
          logger.warn({ err: eventErr.message }, "Failed to publish SearchRunCompleted event");
        }
      }

      return {
        isCompleted,
        searchRunId,
        finishedCount,
        totalCandidates,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, searchRunId }, "Completion check by searchRunId failed");
      return { isCompleted: false, finishedCount: 0, totalCandidates: 0 };
    }
  }
}
