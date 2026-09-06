// Phase 4.3 — diagnostic script: time each Prisma query for the slowest endpoints
// Replays the same queries that /api/loop/status, /api/loop/progress,
// and /api/loop/candidates execute, and reports per-query timing.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const loopId = process.argv[2] ?? "combo-2eea25a0-3ff3-4863-be36-025b5b4e8518";

interface TimedQuery {
  name: string;
  ms: number;
  rows: number;
}

async function timed<T>(name: string, fn: () => Promise<T>, rows = 0): Promise<{ result: T; t: TimedQuery }> {
  const t0 = Date.now();
  const result = await fn();
  return {
    result,
    t: { name, ms: Date.now() - t0, rows },
  };
}

async function main() {
  console.log("\n========== STATUS endpoint queries ==========\n");
  {
    const iters = await timed("loopIteration.findMany(loopId)", () =>
      prisma.loopIteration.findMany({ where: { loopId }, select: { searchRunId: true } }),
    );
    console.log(`  ${iters.t.name}: ${iters.t.ms}ms, ${iters.t.rows} rows`);
    const runIds = iters.result.map((i) => i.searchRunId).filter((s): s is string => !!s);
    const candCount = await timed(`candidateStrategy.count(in ${runIds.length})`, () =>
      prisma.candidateStrategy.count({ where: { searchRunId: { in: runIds } } }),
    );
    console.log(`  ${candCount.t.name}: ${candCount.t.ms}ms`);
    const failCount = await timed(`candidateStrategy.count(FAILED)`, () =>
      prisma.candidateStrategy.count({ where: { searchRunId: { in: runIds }, status: "FAILED" } }),
    );
    console.log(`  ${failCount.t.name}: ${failCount.t.ms}ms`);

    // Now the runner.getRuntimeState chain
    console.log("\n========== getRuntimeState queries ==========\n");
    const t0 = Date.now();
    const loopRow = await timed("loopRunState.findUnique", () => prisma.loopRunState.findUnique({ where: { loopId } }));
    console.log(`  ${loopRow.t.name}: ${loopRow.t.ms}ms`);
    if (loopRow.result?.bestStrategyVersionId) {
      const ver = await timed("strategyVersion.findUnique(bestSv)", () => prisma.strategyVersion.findUnique({
        where: { id: loopRow.result.bestStrategyVersionId! },
        include: { definition: true },
      }));
      console.log(`  ${ver.t.name}: ${ver.t.ms}ms`);
    }
    if (loopRow.result?.bestStrategySymbolId) {
      const sym = await timed("symbol.findUnique", () => prisma.symbol.findUnique({ where: { id: loopRow.result.bestStrategySymbolId! } }));
      console.log(`  ${sym.t.name}: ${sym.t.ms}ms`);
    }

    const liveIter = await timed("loopIteration.findFirst(RUNNING)", () => prisma.loopIteration.findFirst({ where: { loopId, status: "RUNNING" }, orderBy: { iterationIndex: "desc" } }));
    console.log(`  ${liveIter.t.name}: ${liveIter.t.ms}ms`);

    // getAuthoritativeBest
    console.log("\n========== getAuthoritativeBest queries ==========\n");
    const it = await timed("loopIteration.findMany(not null sr)", () => prisma.loopIteration.findMany({ where: { loopId, searchRunId: { not: null } }, select: { searchRunId: true } }));
    console.log(`  ${it.t.name}: ${it.t.ms}ms, ${it.result.length} rows`);
    const allRunIds = it.result.map((i) => i.searchRunId).filter((s): s is string => !!s);
    const cands = await timed("candidateStrategy.findMany(all sr)", () => prisma.candidateStrategy.findMany({ where: { searchRunId: { in: allRunIds } }, select: { id: true } }));
    console.log(`  ${cands.t.name}: ${cands.t.ms}ms, ${cands.result.length} rows`);

    // resolveAuthoritativeExperimentsForCandidates
    const exps = await timed("experiment.findMany(all candidates)", () => prisma.experiment.findMany({
      where: { candidateId: { in: cands.result.map((c) => c.id) } },
      select: { id: true, candidateId: true, createdAt: true },
    }));
    console.log(`  ${exps.t.name}: ${exps.t.ms}ms, ${exps.result.length} rows`);

    const lpe = await timed("loopProcessedEvent.findMany(loopId)", () => prisma.loopProcessedEvent.findMany({
      where: { loopId },
      orderBy: { evaluatedAt: "desc" },
      select: { dedupeKey: true, evaluatedAt: true },
    }));
    console.log(`  ${lpe.t.name}: ${lpe.t.ms}ms, ${lpe.result.length} rows`);

    const top = await timed("backtestResult.findFirst(top overallScore)", () => prisma.backtestResult.findFirst({
      where: { experimentId: { in: exps.result.map((e) => e.id) } },
      orderBy: [{ overallScore: "desc" }, { createdAt: "asc" }],
    }));
    console.log(`  ${top.t.name}: ${top.t.ms}ms`);

    const topExp = await timed("experiment.findUnique(top.experimentId)", () => top.result ? prisma.experiment.findUnique({ where: { id: top.result.experimentId }, select: { candidateId: true } }) : null);
    console.log(`  ${topExp.t.name}: ${topExp.t.ms}ms`);

    const topCand = await timed("candidateStrategy.findUnique(topExp.candidateId)", () => topExp.result?.candidateId ? prisma.candidateStrategy.findUnique({ where: { id: topExp.result.candidateId }, select: { strategyVersionId: true, searchRunId: true } }) : null);
    console.log(`  ${topCand.t.name}: ${topCand.t.ms}ms`);

    const totalMs = Date.now() - t0;
    console.log(`\n  TOTAL getRuntimeState + getAuthoritativeBest: ${totalMs}ms`);
  }

  console.log("\n========== CANDIDATES endpoint queries ==========\n");
  {
    const iters = await timed("loopIteration.findMany(all)", () => prisma.loopIteration.findMany({ where: { loopId }, orderBy: { iterationIndex: "asc" } }));
    console.log(`  ${iters.t.name}: ${iters.t.ms}ms, ${iters.t.rows} rows`);

    const processedEvents = await timed("loopProcessedEvent.findMany(loopId, desc)", () => prisma.loopProcessedEvent.findMany({
      where: { loopId },
      orderBy: { evaluatedAt: "desc" },
      select: { dedupeKey: true, evaluatedAt: true, strategyVersionId: true },
    }));
    console.log(`  ${processedEvents.t.name}: ${processedEvents.t.ms}ms, ${processedEvents.result.length} rows`);

    for (const iter of iters.result) {
      if (!iter.searchRunId) continue;
      const cs = await timed(`  candidateStrategy.findMany(sr=${iter.searchRunId.substring(0,8)})`, () => prisma.candidateStrategy.findMany({
        where: { searchRunId: iter.searchRunId! },
        orderBy: { createdAt: "asc" },
        include: { strategyVersion: { select: { id: true, name: true, implementationRef: true, definition: { select: { type: true } } } } },
      }));
      console.log(`  ${cs.t.name}: ${cs.t.ms}ms, ${cs.result.length} rows`);
      // per candidate, simulate the N+1
      for (const c of cs.result) {
        const e = await timed(`    experiment.findMany(c=${c.id.substring(0,8)})`, () => prisma.experiment.findMany({
          where: { candidateId: c.id },
          select: { id: true, errorMessage: true, status: true },
        }));
        if (e.result.length > 0) {
          const r = await timed(`    backtestResult.findFirst(exp=${e.result[0].id.substring(0,8)})`, () => prisma.backtestResult.findFirst({ where: { experimentId: e.result[0].id } }));
          console.log(`      ${r.t.name}: ${r.t.ms}ms`);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
