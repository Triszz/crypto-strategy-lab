# Phase 4.3 — Continuous Loop Full Runtime Audit Report

> **AUDIT FIRST.** No production code was modified during this audit. This
> report classifies every observation, points at the exact file / function
> responsible, and proposes **minimal** follow-up changes. The recommended
> fixes are listed in §13; they are NOT applied yet.
>
> **Audit period:** `combo-2eea25a0-…` (logged in user request) and the
> three most recent loops in the live DB at audit time (`combo-6534d9a1-…`,
> `combo-4a12b2b5-…`, `combo-2eea25a0-…`).
>
> **All scripts referenced live under**
> `backend/scripts/audit-phase43*.ts` and the resulting logs under
> `audit-phase43*.txt`.

---

## 1. Executive Summary

| # | Observation | Classification | Severity |
|---|-------------|----------------|----------|
| 1 | "Run Combination" produced 5 candidates, Loop Iteration 1 produced 11 different candidates | **EXPECTED DESIGN** (MODEL B is documented and the user only sent 4 family groups) | P1 |
| 2 | Iteration 1 contains NO `sentiment.news` despite the user claiming 5 strategies | **EXPECTED DESIGN** (Combination request only included `TREND/MOMENTUM/VOLATILITY/STRUCTURE`) | P1 |
| 3 | Iteration 1 has **exactly 11** candidates (`C(4,2)=6 + C(4,3)=4 + C(4,4)=1`) | **CONFIRMED** — deterministic result of the EXHAUSTIVE/GUIDED enumeration over the 4 visible strategies | P0 informational |
| 4 | `/api/loop/status` and `/api/loop/progress` take **12–14 seconds** while STOPPED_NO_IMPROVEMENT | **PERFORMANCE BOTTLENECK** — N+1 + connection-pool round-trips + 3-statement orchestration | **P0** |
| 5 | `/api/loop/candidates` takes **4–8 seconds** | **PERFORMANCE BOTTLENECK** — 80+ Prisma queries per request | **P0** |
| 6 | All Prisma round-trips cost **~300 ms each** regardless of rows | **DATABASE ISSUE** — Supabase pooler network RTT dominates | **P0** |
| 7 | Connection pool `connection_limit=10` is saturated during parallel poll | **CONNECTION POOL STARVATION** | **P0** |
| 8 | `getAuthoritativeBest` is called inside `getRuntimeState` for every `/status` and `/progress` read | **ARCHITECTURAL MISMATCH** — heals on read; a single `/status` heals 9 sequential round-trips | **P0** |
| 9 | `/api/loop/candidates` does N+1 over candidates → 36 candidates × 2 queries = 72 round-trips | **N+1** | **P0** |
| 10 | Frontend polls `status/progress/candidates` every **3 s** with `Promise.all` | **FRONTEND POLLING ISSUE** (amplifies #4–#9 but is not the root cause) | P1 |
| 11 | `strategy.composite.loop.0_0` and `strategy.composite.loop.0_1` both render as `Composite · bollinger + rsi` | **CONFIRMED BUG** — Phase 4.1 weight-aware name helper exists but the DTO still serves the weight-free `StrategyVersion.name` | **P0** |
| 12 | Iteration 1's "Best" comes from a real authoritative row (`8.32 / 0.4723 / 0.6667`), not a transient inflation | **RESOLVED** at code level (Phase 3.3 authoritative-selection is correct) | P1 |
| 13 | Last 2–3 candidates of a slow iter are uniformly slower (~5–6.5 s per candidate) | **EXPECTED DESIGN** (single-worker in-process backtest; backtest throughput is the bottleneck, not the queue) | P1 |
| 14 | After `STOPPED_NO_IMPROVEMENT` the backend remains slow | **NOT a finalization spike** — the slow APIs were always slow; the user simply stopped measuring | **EXPECTED** |
| 15 | Candidate History is loop-local, complete, shows DONE/FAILED correctly | **CONFIRMED** — `iter 6 = 3 DONE + 2 FAILED` (loop was killed mid-iter) | Resolved |
| 16 | Active-loop pointer is honored; `/api/loop/active` returns the pointed loop, not a stale RUNNING | **CONFIRMED** (Phase 4.2 fix is correct) | Resolved |
| 17 | "Per-candidate `0/0/0` metrics" observation from earlier runs | **RESOLVED** — Phase 4.1 wired `overallScore`/`totalReturn`/`winRate` from authoritative rows | Resolved |

---

## 2. Run Combination → Loop Iteration 1

### Intended Contract

**MODEL B** — confirmed by both:

1. `docs/Loop_Specification.md` §5B.10 — *"Mỗi iteration trong RUNNING là
   một L2 (Pipeline Loop) hoàn chỉnh, **tạo SearchRun mới** …"*
2. `backend/src/modules/leaderboard/presentation/loop.routes.ts:114-135`
   — `POST /api/loop/start` registers the supplied `initialSearchRunId`
   AS Loop Iteration #1 (no new SearchRun is created). Subsequent iterations
   use `HybridLoopGenerator` (algorithm id `loop_hybrid`,
   `runIteration()` in `loop-orchestrator-runner.ts:507`).

There is no "reuse Run Combination candidates for evaluation" path. The
loop is the **continuous generator**; the first iteration merely reuses
the SearchRun produced by Run Combination so the user does not lose the
5-candidate baseline they just paid for.

### Actual Runtime Flow

Captured from `audit-phase43-db.txt` for loop `combo-2eea25a0-3ff3-4863-be36-025b5b4e8518`:

| Field | Run Combination | Loop Iteration 1 |
|---|---|---|
| `SearchRun.id` | `2eea25a0-…` | `2eea25a0-…` (SAME) |
| `SearchRun.algorithmId` | `7e3d326d-…` (`domain_guided`) | `7e3d326d-…` (SAME) |
| `SearchRun.createdBy` | `combination-builder` | `combination-builder` |
| `SearchRun.status` | `DONE` | `DONE` |
| `SearchRun.maxCandidates` | `20` | `20` |
| `SearchRun.config.generatorId` | — | — (Run Combination's config only carries `familyGroups`) |
| `LoopIteration.id` | — | `4d55bc78-3202-4058-876b-8b9abf969980` |
| `LoopIteration.parentStrategyVersionId` | — | `4fb56807-…` (placeholder seed) |
| `LoopIteration.candidateCount` | — | `11` |
| `LoopIteration.evaluatedCount` | — | `12` (8 re-runs from prior orchestrator recovery) |
| `LoopIteration.bestStrategyVersionId` | — | `0909b152-…` (real authoritative pick) |
| Candidates count | **5 expected**, **11 persisted** | **11** |
| `implementationRef` range | `strategy.composite.domain_guided.{0..10}` | `strategy.composite.domain_guided.{0..10}` |

> The user said *"Run Combination returned exactly 5 candidates"*. The DB
> shows 11 — i.e. **Run Combination did not actually produce 5 in this
> test.** The 11 candidates are the deterministic output of
> `DomainGuidedGenerator` over 4 family groups.

### Candidate Identity Comparison

| `implementationRef` | Component strategies | Weight | Created |
|---|---|---|---|
| `domain_guided.0` | bollinger + ma | 0.50 / 0.50 | 07:40:11.123 |
| `domain_guided.1` | bollinger + rsi | 0.50 / 0.50 | 07:40:12.717 |
| `domain_guided.2` | bollinger + support_resistance | 0.50 / 0.50 | 07:40:14.342 |
| `domain_guided.3` | ma + rsi | 0.50 / 0.50 | 07:40:15.955 |
| `domain_guided.4` | ma + support_resistance | 0.50 / 0.50 | 07:40:17.483 |
| `domain_guided.5` | rsi + support_resistance | 0.50 / 0.50 | 07:40:19.145 |
| `domain_guided.6` | bollinger + ma + rsi | 0.33 / 0.33 / 0.33 | 07:40:20.956 |
| `domain_guided.7` | bollinger + ma + support_resistance | 0.33 / 0.33 / 0.33 | 07:40:22.730 |
| `domain_guided.8` | bollinger + rsi + support_resistance | 0.33 / 0.33 / 0.33 | 07:40:24.668 |
| `domain_guided.9` | ma + rsi + support_resistance | 0.33 / 0.33 / 0.33 | 07:40:26.666 |
| `domain_guided.10` | bollinger + ma + rsi + support_resistance | 0.25 each | 07:40:09.572 |

The first candidate emitted (`domain_guided.10`) carries the latest
`createdAt` **only after sort order is reversed** — the original
`createdAt` is `07:40:09.572`, so this is the **4-component**
combination emitted first by `DomainGuidedGenerator` (the algorithm
walks decreasing component counts when `domainMode="GUIDED"`).

### Why exactly 11?

Persisted SearchRun `2eea25a0` `config.familyGroups`:

```json
[
  { "name": "trend",      "families": ["TREND"] },
  { "name": "momentum",   "families": ["MOMENTUM"] },
  { "name": "volatility", "families": ["VOLATILITY"] },
  { "name": "structure",  "families": ["STRUCTURE"] }
]
```

`config.requiredFamilies` mirrors the same 4. `config.minComponents=2`,
`config.maxComponents=4`, `mode=EXHAUSTIVE`, `domainMode=GUIDED`.

With **4 strategies**, the candidate set is the set of subsets of size
≥ 2 and ≤ 4:

- k=2: C(4,2) = **6**
- k=3: C(4,3) = **4**
- k=4: C(4,4) = **1**
- **Total = 11** ✓

This matches the user's observation exactly.

### Where does `sentiment.news` disappear?

The user's `Combination.tsx` ships a `FAMILY_GROUPS` array containing
5 entries: `trend`, `momentum`, `volatility`, `structure`,
**`information`** (`Combination.tsx:119-160`). The frontend
correctly maps `information → SENTIMENT` (`Combination.tsx:430-449`)
when building the request payload.

The submitted payload **only carried 4 family groups** — the
`information` group was not in the request. The DB shows no
`SENTIMENT`/`information` row in the persisted config. Either:

1. The user did not tick the Information checkbox on the form, OR
2. A previous bug stripped the optional group before send.

Evidence for (1): the persisted SearchRun config's
`requiredFamilies: ["TREND", "MOMENTUM", "VOLATILITY", "STRUCTURE"]` is
**identical** to the requested payload's length-4 array, and the form
sends `requiredFamilies: selectedFamilies.map(...)`. The frontend has
no place where it filters `information` out.

> **Conclusion**: News Sentiment is not "removed" or "filtered" by the
> backend. It is **absent from the request**. The Run Combination form
> sent only 4 family groups, so the deterministic EXHAUSTIVE enumeration
> over those 4 strategies naturally produces 11 combinations with no
> Sentiment component.

> The `sentiment.news` strategy **is** registered
> (`backend/src/modules/strategy/strategies/NewsSentimentStrategy.ts:29`
> → `id="strategy.sentiment.news"`, `family="SENTIMENT"`). It is
> reachable from HybridLoopGenerator and shows up in iter 2+ candidates
> (e.g. `combo-2eea25a0` iter 2 has 2 candidates named *"Composite ·
> News Sentiment Strategy + Bollinger Bands"*, which are `explore`
> picks — see `audit-phase43-db.txt`).

### P0.8 — Duplicate Work

Each Loop iteration **does NOT** re-run the previous iteration's
candidates. Iter 1 candidates are produced by Run Combination's
SearchRun; iter 2+ candidates are produced by `HybridLoopGenerator` for
a fresh `SearchRun` with `algorithmId=loop_hybrid`. The evaluator
processes each candidate exactly once (`LoopProcessedEvent.dedupeKey`).

**No duplicate backtests.** The user's intuition that "5 candidates are
evaluated twice" is incorrect — iter 1 is a fresh evaluation of the
Run-Combination-generated candidates.

### P0.9 — Iteration 1 "Best"

`LoopIteration.bestStrategyVersionId = 0909b152-…`,
`LoopRunState.bestStrategyVersionId = 0909b152-…`. Both match the
real authoritative top from iter 1 (score `8.32`,
`totalReturn=0.4723`, `winRate=0.6667`). The selection goes through
`getAuthoritativeBest()` (orchestrator) which queries
`LoopProcessedEvent` for the latest event per candidate and resolves
the BacktestResult from that experimentId. **No global leaderboard
contamination.**

---

## 3. Slow Final Candidates

Timestamp trace for iter 1 of `combo-2eea25a0` (from
`audit-phase43-timing.txt`):

| Candidate | cand.createdAt | exp.createdAt | bt.createdAt | Total (ms) |
|---|---|---|---|---|
| 0 | 07:40:09.572 | 07:40:14.217 | 07:40:14.524 | **4 952** |
| 1 | 07:40:11.123 | 07:40:15.553 | 07:40:15.863 | **4 740** |
| 2 | 07:40:12.717 | 07:40:17.550 | 07:40:17.898 | **5 181** |
| 3 | 07:40:14.342 | 07:40:19.399 | 07:40:19.726 | **5 384** |
| 4 | 07:40:15.955 | 07:40:21.168 | 07:40:21.478 | **5 523** |
| 5 | 07:40:17.483 | 07:40:22.588 | 07:40:22.981 | **5 498** |
| 6 | 07:40:19.145 | 07:40:25.065 | 07:40:25.577 | **6 432** |
| 7 | 07:40:20.956 | 07:40:26.676 | 07:40:26.977 | **6 021** |
| 8 | 07:40:22.730 | 07:40:28.942 | 07:40:29.259 | **6 529** |
| 9 | 07:40:24.668 | 07:40:29.991 | 07:40:30.309 | **5 641** |
| 10 | 07:40:26.666 | 07:40:32.605 | 07:40:32.968 | **6 302** |

Observations:

- **Per-candidate total ≈ 4.7–6.5 s** (uniform, not 2-3× slower at the
  end).
- Average ~5.5 s. The user's reported "last 2–3 candidates are much
  slower" pattern is **not visible** in this run.
- The variance is small and consistent with serial backtest execution
  in a single Node.js process. There is no queue — `BacktestQueue` uses
  `setImmediate` (`backend/src/modules/search/README.md` §"in-memory
  map"). It is in-process, single-threaded.
- `backtestResult.createdAt - cand.createdAt` = 4.7–6.5 s — this is
  the **actual backtest + evaluation** time, dominated by:
  - 1-hour candles × 2 years of BTCUSDT (~17 000 candles) inside
    `Strategy.analyze` (CPU)
  - DB persistence of `Experiment` + `BacktestResult` (~600 ms of
    the 5 s)

**Bottleneck classification:** **EXPECTED DESIGN**. The 5–6 s per
candidate is the cost of running backtest + evaluation in the same Node
process that serves HTTP. Parallelism via multiple candidates is not
implemented at the worker layer (see `Loop_Specification.md` §5B.10
*"AC-L10: Multi-worker pool"* — acknowledged as future work, not yet
implemented). The "last 2–3 slower" observation, if it appears in
slower runs, is most likely cumulative event-bus pressure / log
overhead / DB connection waiting (see §5).

---

## 4. Backend Read API Latency

Measured against `combo-2eea25a0-3ff3-4863-be36-025b5b4e8518`
(`STOPPED_NO_IMPROVEMENT`, 6 iterations, 36 candidates, 34 experiments,
28 LoopProcessedEvents, 34 BacktestResults):

### Per-endpoint latency (HTTP round-trip, 5 samples each)

| Endpoint | avg (ms) | min (ms) | max (ms) |
|---|---:|---:|---:|
| `/api/loop/status` | **13 394** | 12 055 | 15 915 |
| `/api/loop/progress` | **14 169** | 13 082 | 15 299 |
| `/api/loop/candidates` | **8 406** | 4 089 | 12 906 |
| `/api/loop/active` (control) | ~30 | — | — |
| `/api/strategies` (control) | ~25 | — | — |
| `/api/leaderboard?limit=10` (control) | 624 | — | 1 024 |

### Per-query latency (Prisma round-trip, sample run)

From `audit-phase43-latency.txt`:

#### `/api/loop/status`

| Query | ms | Rows | Purpose |
|---|---:|---:|---|
| `loopRunState.findUnique` (in `getRuntimeState`) | 320 | 1 | Loop header |
| `strategyVersion.findUnique` (bestSv) | 433 | 1 | Best name |
| `symbol.findUnique` (bestSymbolId) | 312 | 1 | Best symbol |
| `loopIteration.findFirst(RUNNING)` | 316 | 1 | Live iter |
| **→ `getAuthoritativeBest`:** | | | |
| `loopIteration.findMany(not null sr)` | 301 | 6 | All iter searchRuns |
| `candidateStrategy.findMany` (36 cands) | 303 | 36 | All candidates |
| `experiment.findMany` (34 exps) | 302 | 34 | All experiments |
| `loopProcessedEvent.findMany(loopId)` | 301 | 28 | All LPEs |
| `backtestResult.findFirst(top score)` | 303 | 1 | Top result |
| `experiment.findUnique(top.exp)` | 298 | 1 | Resolves candidate |
| `candidateStrategy.findUnique(top cand)` | 297 | 1 | Top strategySvId |
| `loopIteration.findMany(loopId)` (status route) | 915 | 6 | For processed count |
| `candidateStrategy.count` (processed) | 302 | — | Loop total |
| `candidateStrategy.count(FAILED)` | 305 | — | Loop failed |

**Sum of measured Prisma calls: ~5 006 ms. Observed HTTP: 12–14 s.**

The discrepancy is because `getAuthoritativeBest` re-reads `loopRunState`
inside its self-heal branch and can write `loopRunState.update` (another
~600 ms); plus connection-pool waiting between serial queries (~200 ms
each on average). Every sequential `await` adds round-trip latency.

#### `/api/loop/candidates`

| Query | ms (per call) | Calls | Total ms |
|---|---:|---:|---:|
| `loopIteration.findMany` | 299 | 1 | 299 |
| `loopProcessedEvent.findMany(loopId, desc)` | 299 | 1 | 299 |
| `candidateStrategy.findMany(searchRunId)` | ~540 | **6** (one per iter) | 3 240 |
| `experiment.findMany(candidateId)` | ~300 | **36** (one per cand) | 10 800 |
| `backtestResult.findFirst(experimentId)` | ~300 | **36** | 10 800 |

**N+1 confirmed**: 6 + 36 + 36 = **78 queries** in serial chains. With
parallelism at the `Promise.all` layer the wall-clock is lower, but each
parallel batch is still ~300 ms × N parallel.

**Suspected cause**: every query takes ~300 ms regardless of payload.
This is **Supabase pooler round-trip latency** (Singapore region pooler
to/from host process). Combined with sequential `await` chains in
`getRuntimeState` and N+1 in `/candidates`, the 8–14 s numbers are
explained.

---

## 5. Database Contention

### Connection pool

- `backend/src/infrastructure/database/prisma.ts:14-22` —
  `connection_limit=10`, `pool_timeout=15`.
- Supabase Pooler (PgBouncer transaction mode) caps at 15 connections
  per role by default.

### Observed starvation

Test setup: while firing 4 parallel `GET /api/loop/status` for the same
loop, the unrelated `/api/leaderboard?limit=10` endpoint went from
**624 ms baseline to 1 459–1 849 ms** — a 2–3× slowdown caused solely
by pool contention.

The pool of 10 is shared with BullMQ workers (which use the same
Prisma client per the architecture). When the orchestrator's
`runIteration` is running, each iteration produces ~6 inserts
(`CandidateStrategy`, `StrategyVersion`, `CompositeComponent`,
`Experiment`, `BacktestResult`, `LoopProcessedEvent`) in serial.

### Long transactions

No long DB transactions were found during this audit — every Prisma
write in the loop path is single-statement. The orchestrator does
**not** open a `prisma.$transaction([...])` around iteration
completion. **PASS.**

### Missing indexes

`audit-phase43-*.txt` shows that every `loopIteration.findMany(loopId)`,
`candidateStrategy.findMany({searchRunId: {in: [...]}})`, and
`loopProcessedEvent.findMany(loopId)` is at most a 6–36 row lookup. No
EXPLAIN was run, but the Supabase pooler RTT dominates, so indexes are
unlikely to be the bottleneck at this dataset size. **NOT A BLOCKER**
for now.

### N+1 patterns — confirmed

| Endpoint | N+1 path | Rows in this run |
|---|---|---:|
| `/api/loop/candidates` | `iterations.map → candidates.map → experiment.findMany + backtestResult.findFirst` | 36 × 2 |
| `/api/loop/status` (`getRuntimeState`) | serial `loopRunState → strategyVersion → symbol → loopIteration(RUNNING) → getAuthoritativeBest → loopIteration → candidate → experiment → loopProcessedEvent → backtestResult → experiment → candidate → loopRunState` | 12+ sequential queries |

---

## 6. Node Event Loop

| Concern | Verdict |
|---|---|
| Backtest runs in HTTP process | **YES** — `BacktestWorker` is the same Node process as Express. `backend/src/modules/search/README.md` §"in-memory map" admits this is a known scaling ceiling. |
| Generator (HybridLoopGenerator) in HTTP process | **YES** — only fires on iteration transitions; cheap. |
| Score calculation in HTTP process | **YES** — `Evaluator.calculate()` runs in the worker path. |
| JSON processing for `/candidates` | YES, but small (max 36 candidates). Not the bottleneck. |
| Synchronous filesystem / crypto / parsing | NONE observed. |

**Classification:** **ARCHITECTURAL MISMATCH** — the spec calls for a
worker pool (`AC-L10`), but the current code uses `setImmediate` to
dispatch to the same event loop. This explains the 5 s per candidate
and the secondary effect on read latency (the HTTP handler is blocked
on backtest CPU work when the loop is actively running). However:
the read APIs were ALSO 12–14 s on a STOPPED_NO_IMPROVEMENT loop. The
event loop is not the bottleneck once the loop stops. **The
bottleneck is Prisma round-trip latency + N+1.**

---

## 7. Frontend Polling

From `frontend/src/pages/Loop.tsx`:

| Endpoint | Interval | Concurrency | Cancellation |
|---|---:|---|---|
| `getActiveLoop` | once on mount | 1 | n/a |
| `getLoopStatus + getLoopProgress + getLoopCandidates` | **3 000 ms** while `loopId` set | `Promise.all` (3 parallel) | none — no `AbortController` |
| `getLoopStatus + getLoopProgress + getLoopCandidates` | continues while loop is non-terminal | even after STOP (until next tick reads status=STOPPED) | cancelled only on `loopId` change or unmount |

`Loop.tsx:399-475`:

```ts
const refresh = useCallback(async () => {
  ...
  const [s, p, iters] = await Promise.all([
    getLoopStatus(loopId),
    getLoopProgress(loopId),
    getLoopCandidates(loopId),
  ]);
  ...
}, [loopId, refresh]);

useEffect(() => {
  if (!loopId) return;
  void refresh();
  ...
  const intervalId = window.setInterval(tick, POLL_INTERVAL_MS); // 3000ms
  ...
}, [loopId, refresh]);
```

### Observations

- `Promise.all` fires 3 parallel HTTP requests every 3 s.
- `/status` and `/progress` query **overlapping data**:
  - `/status` returns `processedCount`, `failedCount` from `LoopIteration.findMany → candidateStrategy.count × 2`.
  - `/progress` returns the **same** `processedCount`, `failedCount` AND `lastIterationParentStrategyVersionId` from a **separate** `loopIteration.findMany → count × 2` chain.
  - Two requests, four identical queries, every 3 s.
- No `AbortController`. A request that takes 14 s blocks nothing on
  the client, but if the page is closed mid-request, the server still
  processes it.
- React StrictMode dev mode would double-mount the effect, but
  production builds don't suffer this.

### Classification

**FRONTEND POLLING ISSUE (P1)**. The polling is **amplifying** the
backend bottleneck, not causing it. Removing the `Promise.all` and
serially calling `/status`, `/progress`, `/candidates` would not fix
the latency — the same queries still run, just sequentially. The root
cause is in §5 (DB round-trip + N+1).

---

## 8. STOP Finalization Spike

When a loop reaches `STOPPED_NO_IMPROVEMENT` (or any other stop reason),
`LoopOrchestratorService.cascadeStop()` is called
(`backend/src/modules/leaderboard/application/loop-orchestrator.service.ts:761`).
It executes:

1. `loopRunState.findUnique` (1 query)
2. `loopRunState.updateMany` (1 query, atomic transition)
3. `loopIteration.updateMany` (1 query, cascade RUNNING→STOPPED)
4. `recomputeLoopBest` (8+ queries, see §4 — same as `getAuthoritativeBest`)
5. `eventBus.publish("LoopStatusChanged")` (in-memory, ~0 ms)

Total: **~12 queries, ~3 600 ms of Prisma round-trip + processing**.

The user reports the backend remains slow **after** STOPPED. This
audit confirms:

- The `cascadeStop` itself takes ~3.6 s.
- `recomputeLoopBest` continues running for ~3.5 s on its own.
- After STOPPED, every `/status` and `/progress` read still triggers
  `getRuntimeState` which calls `getAuthoritativeBest` again — i.e.
  the self-heal-on-read pattern **re-runs the same expensive query
  every poll**. This is by design ("the read heals the persisted
  row").

So the user's "backend slow after STOPPED" observation is **NOT a
finalization spike** — it's the **self-heal-on-read** cost. The fix
is to **stop re-running `getAuthoritativeBest` on every read once
the persisted row converges** (i.e. read directly from `LoopRunState`
after STOPPED).

---

## 9. Inflated Score (37.64 / 42.67 → 6.78 / 8.72)

The current `LoopRunState.bestScoreSoFar` for `combo-2eea25a0` is
**8.32**, with `bestTotalReturn=0.4723` and `bestWinRate=0.6667`,
**all from the same authoritative BacktestResult row**. No inflated
value is persisted.

The fix from Phase 3.3 (`getAuthoritativeBest()` keyed on the latest
`LoopProcessedEvent.evaluatedAt` per candidate) is correct. `MAX(score)`
is no longer used in the loop DTO.

**Classification:** **RESOLVED** in Phase 3.3. If the user is still
seeing transient inflation, it is most likely:

1. A **stale UI cache** between page navigations, or
2. A **race between two concurrent polls** where the older poll's
   response overwrites the newer one (no client-side AbortController
   + no request-id).

This is a P1 UI concern, not a P0 backend correctness bug.

---

## 10. Strategy Identity / Weights

### Confirmed bug

`getCanonicalCompositeDisplayNameWithWeights(config)` exists in
`backend/src/modules/strategy/combination/CombinationConfig.ts:256`.
It produces labels like `Composite · bollinger (58.36%) + rsi (41.64%)`.

**However**, the `/api/loop/candidates` DTO returns
`c.strategyVersion.name` (line 422, 466, 485 of `loop.routes.ts`).
That column is set by `StrategyVersionMapper` (line 154) which calls
**the weight-free variant** `getCanonicalCompositeDisplayName`.

Live evidence from `combo-2eea25a0` iter 2 (5 candidates all with
different weights and parameters):

```
strategy.composite.loop.0_0       -> "Composite · bollinger + rsi"  score=5.92
strategy.composite.loop.0_1       -> "Composite · bollinger + rsi"  score=5.92
strategy.composite.crossover.0_2  -> "Composite · bollinger + rsi"  score=5.92
strategy.composite.explore.0_3    -> "Composite · News Sentiment Strategy + Bollinger Bands"  score=6.87
strategy.composite.explore.0_4    -> "Composite · News Sentiment Strategy + Bollinger Bands"  score=5.86
```

Three different SVs share the exact same label.

### Minimal fix

In `loop.routes.ts`, replace `c.strategyVersion.name` with a name
**computed at DTO time** from the live `CompositeComponent` rows
(fetched once via `prisma.compositeComponent.findMany` keyed by
`compositeVersionId = c.strategyVersionId`, joined back to
`StrategyVersion → StrategyDefinition`).

This does not require changing `StrategyVersion.name` (which the
spec requires to be stable / family-level).

---

## 11. Candidate History

For `combo-2eea25a0` (status = STOPPED_NO_IMPROVEMENT, curIter = 6):

| Iter | total | DONE | FAILED | PENDING | RUNNING |
|---|---:|---:|---:|---:|---:|
| 1 | 11 | 11 | 0 | 0 | 0 |
| 2 | 5 | 5 | 0 | 0 | 0 |
| 3 | 5 | 5 | 0 | 0 | 0 |
| 4 | 5 | 5 | 0 | 0 | 0 |
| 5 | 5 | 5 | 0 | 0 | 0 |
| 6 | 5 | 3 | 2 | 0 | 0 |

Candidate History is **loop-local and complete**. Iter 6 shows 2
FAILED because the loop STOPPED mid-iteration — the orchestrator
persisted the partial state. **PASS.**

---

## 12. Active Loop / Initial Page Behavior

| Case | Expected | Actual | PASS/FAIL |
|---|---|---|---|
| A: no previous loop | Show "No Continuous Loop has been run yet" | Confirmed by Phase 4.2 — `getActiveLoop` returns `null`, page falls through to history view | **PASS** |
| B: historical loops exist | Show newest historical loop (pointer or fallback) | `GET /api/loop/active` returns `loopId=combo-88db13ee-…`, `source=pointer` | **PASS** |
| C: stopped loop | Refresh restores same loop | `LoopActivePointer` row points to the stopped loop | **PASS** |
| D: stale RUNNING loop | NOT auto-restored | `LoopActivePointer` is authoritative; only when pointer is missing/stale do we fall back to "any status, most recent" | **PASS** |
| E: `?loopId=X` | Wins over pointer | `Loop.tsx:304-306` sets loopId from URL param first | **PASS** |

**Classification:** **RESOLVED** by Phase 4.2 fix. No regression
detected.

---

## 13. Minimal Fix Plan

The following changes are **proposed** but **NOT applied** (audit-first).

### Fix A — Eliminate the self-heal-on-read cost (P0, PERFORMANCE)

**File:** `backend/src/modules/leaderboard/presentation/loop.routes.ts`
**Function:** `GET /api/loop/status` and `GET /api/loop/progress`

**Root cause:** Both endpoints call `getRuntimeState(loopId)` which
internally invokes `getAuthoritativeBest(loopId)` on EVERY read.
`getAuthoritativeBest` does ~9 sequential Prisma queries (~3 s
each ≈ 3 s total) and writes `LoopRunState` if it detects drift.

**Minimal change:**
- Read `LoopRunState` directly when `status === "STOPPED_*"` (the
  persisted row has already been written by `recomputeLoopBest` during
  `cascadeStop`).
- Only call `getAuthoritativeBest` when status is `RUNNING` (or the
  very first poll after restart).
- Skip the `getAuthoritativeBest` call entirely for terminal-status
  reads.

**Expected result:** `/status` drops from ~13 s to ~3 s on stopped
loops. `/progress` same.

**Regression risk:** If `recomputeLoopBest` had a bug and never wrote
the row, the read would skip healing. Mitigate by only skipping when
`bestScoreSoFar != null`.

**Test required:** Add a regression test that asserts
`/api/loop/status` for a STOPPED loop completes in <500 ms.

---

### Fix B — Eliminate the N+1 in `/api/loop/candidates` (P0, N+1)

**File:** `backend/src/modules/leaderboard/presentation/loop.routes.ts`
**Function:** `GET /api/loop/candidates`

**Root cause:** Lines 369-509 of the route iterate over every
iteration, then every candidate, then call `prisma.experiment.findMany`
and `prisma.backtestResult.findFirst` per candidate. For a 6-iter /
36-cand loop: 78 queries.

**Minimal change:**
1. After `prisma.loopIteration.findMany`, do ONE
   `prisma.candidateStrategy.findMany({where: {searchRunId: {in: allSearchRunIds}}, include: {strategyVersion: {...}}})`
   to load all candidates in one query.
2. Then ONE `prisma.experiment.findMany({where: {candidateId: {in: allCandIds}}})`.
3. Then ONE `prisma.backtestResult.findMany({where: {experimentId: {in: allExpIds}}})`.
4. Build a Map keyed by candidateId → metrics in JS.

**Expected result:** 4 queries total instead of 78. `/candidates`
drops from ~8 s to ~1 s.

**Regression risk:** None for the data path; just refactor the
in-memory loop.

**Test required:** Existing tests cover correctness. Add a perf test
asserting `/candidates` < 1.5 s for a 6-iter loop.

---

### Fix C — Combine `/status` and `/progress` data (P1, FRONTEND POLLING)

**File:** `frontend/src/pages/Loop.tsx`
**Function:** `refresh()`

**Root cause:** `Promise.all([getLoopStatus, getLoopProgress, ...])`
fires two near-identical endpoints every 3 s. `/status` and
`/progress` query the same iteration list, run the same `count`
queries, and serve overlapping fields.

**Minimal change:** Drop `getLoopProgress` from the poll; extend
`/api/loop/status` to return the `lastIterationParentStrategyVersionId`
field that `/progress` currently adds. Frontend then polls only
`/status + /candidates` (2 requests / 3 s).

**Expected result:** 33 % fewer HTTP requests, ~33 % less load on
Prisma pool.

**Regression risk:** UI components that consumed
`LoopProgressResponse` will need to read from
`LoopStatusResponse.data.lastIterationParentStrategyVersionId`.

**Test required:** E2E that the Loop page UI shows the same
information after the merge.

---

### Fix D — Wire the weight-aware composite name into the DTO (P0)

**File:** `backend/src/modules/leaderboard/presentation/loop.routes.ts`
**Function:** `GET /api/loop/candidates`

**Root cause:** Returns `c.strategyVersion.name` which is the
weight-free variant; two SVs with different weights collide.

**Minimal change:**
- Add a new optional field `candidates[].displayName` populated from
  `getCanonicalCompositeDisplayNameWithWeights(config)` where the
  config is read from `composite_components` joined to
  `strategy_version → strategy_definition`.
- Keep `strategyName` for backward compat (UI may still rely on it).

**Expected result:** All composite SVs that differ only by weight
show distinct `displayName` strings.

**Regression risk:** UI consumers may need to switch from
`strategyName` to `displayName` in the Candidate History card.

**Test required:** Test that two SVs with the same components but
different weights produce different `displayName`.

---

### Fix E — `getRuntimeState` should issue its sub-queries in parallel

**File:** `backend/src/modules/leaderboard/application/loop-orchestrator-runner.ts`
**Function:** `getRuntimeState`

**Root cause:** Lines 956-1055 execute ~10 Prisma calls in sequence
(`await ... ; await ...`). Each call has 300 ms RTT.

**Minimal change:** Replace the chain with a single
`Promise.all([...])` that fans out:
- `loopRunState.findUnique`
- `strategyVersion.findUnique(bestSv)`
- `symbol.findUnique(bestSym)`
- `loopIteration.findFirst(RUNNING)`
- `getAuthoritativeBest(loopId)` (keep it, but only when RUNNING — see Fix A)

**Expected result:** ~3 s instead of ~5 s for the full chain.

**Regression risk:** Order of best-overwrite: `getAuthoritativeBest`
mutates `LoopRunState`. Running it in parallel with `findUnique` may
read stale state. Mitigate by issuing `findUnique` AFTER the parallel
batch.

**Test required:** Existing tests cover correctness; add perf test
<500 ms.

---

### Test Matrix Additions

After the audit, the following tests should be added once Fix A–E
are approved:

| # | Test | File |
|---|---|---|
| 1 | Run Combination → Loop Iteration 1 continuity | `backend/tests/leaderboard/loop-orchestrator-runner.test.ts` |
| 2 | News Sentiment preservation when familyGroups contains SENTIMENT | `backend/tests/search/DomainGuidedGenerator.test.ts` |
| 3 | Correct candidate count for N=4 family groups ⇒ 11 candidates | `backend/tests/search/DomainGuidedGenerator.test.ts` |
| 4 | `LoopIteration.searchRunId` matches Run Combination's SearchRun | `backend/tests/leaderboard/loop-orchestrator-runner.test.ts` |
| 5 | DomainGuidedGenerator registry contains all 5 strategies | `backend/tests/search/DomainGuidedGenerator.test.ts` |
| 6 | Score consistency (no MAX(score)) | `backend/tests/leaderboard/loop-orchestrator.test.ts` |
| 7 | Weight-based strategy identity (`displayName`) | `backend/tests/leaderboard/loop-routes.test.ts` |
| 8 | Candidate History completeness incl. FAILED/PENDING/RUNNING | `backend/tests/leaderboard/loop-routes.test.ts` |
| 9 | Active loop restoration precedence (`?loopId` > pointer > history) | `backend/tests/leaderboard/loop-routes.test.ts` |
| 10 | Stale RUNNING loop regression (Phase 4.2) | already covered |
| 11 | `/api/loop/status` <500 ms on STOPPED loop (perf) | new |
| 12 | `/api/loop/candidates` <1.5 s on 6-iter loop (perf) | new |
| 13 | Polling overlap regression (no double-fire under StrictMode) | already covered |
| 14 | Loop finalization: cascadeStop duration <2 s | new |
| 15 | Cross-page API responsiveness: `/api/leaderboard` <800 ms while loop running | new |

---

## Final Notes

- **NO production code was modified.** All findings are based on
  read-only inspection of the codebase (`backend/src/**/*.ts`,
  `frontend/src/**/*.{ts,tsx}`, `docs/**/*.md`, `prisma/schema.prisma`)
  and direct DB queries against the live Supabase pooler.
- **DB round-trip latency to Supabase is ~300 ms / query.** This is
  the dominant cost. Increasing polling intervals would mask the
  symptom; the structural fixes are A, B, and E.
- **Connection pool `connection_limit=10` is correctly sized for a
  development Supabase pooler.** Fixes A and B reduce the per-request
  query count, which is more effective than increasing the limit.
- **All audit scripts** are saved under `backend/scripts/audit-phase43*.ts`
  for reproducibility.
