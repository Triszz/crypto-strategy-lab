/**
 * evaluation · infrastructure · strategyEvaluatedContext
 *
 * Enriches the `StrategyEvaluated` event payload with the Loop ownership
 * chain:
 *
 *   experimentId
 *     → CandidateStrategy (candidateStrategy)
 *       → SearchRun (searchRunId)
 *         → LoopIteration (loopId)
 *           → LoopRunState
 *
 * The orchestrator service uses the derived `loopId` to filter counter
 * updates so that one loop's candidates cannot pollute another loop's
 * counters. When the candidate is not attached to any loop (e.g. a
 * manual backtest or a search run started outside a loop) the helper
 * returns null and the orchestrator ignores the event.
 *
 * This file is intentionally placed in the evaluation module because
 * it is the sole publisher of `StrategyEvaluated`. The lookup chain is
 * kept here (rather than inside the leaderboard / orchestrator
 * subscriber) to preserve the strict ownership rule:
 *
 *   event → emit with own context
 *
 * MUST stay read-only against Prisma. No mutations.
 */
import type { PrismaClient } from "@prisma/client";

export interface StrategyEvaluatedLoopContext {
  readonly experimentId: string;
  readonly candidateId: string | null;
  readonly searchRunId: string | null;
  readonly loopId: string | null;
  readonly iterationIndex: number | null;
}

/**
 * Resolve the loop ownership for a candidate.
 *
 * Returns null fields (NOT throws) when the candidate is unattached so
 * the caller can publish a regular event with `loopId = null`.
 */
export async function resolveStrategyEvaluatedContext(
  prisma: PrismaClient,
  experimentId: string,
): Promise<StrategyEvaluatedLoopContext> {
  try {
    const experiment = await prisma.experiment.findUnique({
      where: { id: experimentId },
      select: { candidateId: true },
    });

    if (!experiment?.candidateId) {
      return { experimentId, candidateId: null, searchRunId: null, loopId: null, iterationIndex: null };
    }

    const candidate = await prisma.candidateStrategy.findUnique({
      where: { id: experiment.candidateId },
      select: { searchRunId: true },
    });

    if (!candidate?.searchRunId) {
      return {
        experimentId,
        candidateId: experiment.candidateId,
        searchRunId: null,
        loopId: null,
        iterationIndex: null,
      };
    }

    const iteration = await prisma.loopIteration.findFirst({
      where: { searchRunId: candidate.searchRunId },
      select: { loopId: true, iterationIndex: true },
      orderBy: { iterationIndex: "desc" },
    });

    if (!iteration) {
      return {
        experimentId,
        candidateId: experiment.candidateId,
        searchRunId: candidate.searchRunId,
        loopId: null,
        iterationIndex: null,
      };
    }

    return {
      experimentId,
      candidateId: experiment.candidateId,
      searchRunId: candidate.searchRunId,
      loopId: iteration.loopId,
      iterationIndex: iteration.iterationIndex,
    };
  } catch {
    // On any DB failure, return null ownership so the event still
    // propagates — we never want to drop a `StrategyEvaluated` event
    // because of a context lookup failure.
    return { experimentId, candidateId: null, searchRunId: null, loopId: null, iterationIndex: null };
  }
}
