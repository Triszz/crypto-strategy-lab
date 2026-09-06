# Phase 4.5 Audit — Search/Discovery Candidate Integrity, Weighted Strategy Identity, Per-Candidate Backtest

> AUDIT FIRST. Fix only confirmed root causes. Minimal, demo-safe changes.

---

## A. Root Causes

### A.1 Issue A — Display-name mismatch ("bollinger" appears where News Sentiment actually is)

**Confirmed bug**. NOT a candidate-generation bug. NOT a frontend/DTO bug. NOT a missing strategy.

**Trace:**

1. **Strategy registry at runtime** — `GET /api/strategies` returns:
   ```
   strategy.bollinger          family=VOLATILITY
   strategy.ma                 family=TREND
   strategy.rsi                family=MOMENTUM
   strategy.sentiment.news     family=SENTIMENT   ← present, registered
   strategy.support_resistance family=STRUCTURE
   ```

2. **Frontend payload** (`Combination.tsx`) — When the user selects MA + RSI + SR + News Sentiment and clicks *Run Combination*, the frontend builds:
   ```js
   familyGroups=[
     {name:"trend",       families:["TREND"]},
     {name:"momentum",    families:["MOMENTUM"]},
     {name:"structure",   families:["STRUCTURE"]},
     {name:"information", families:["SENTIMENT"]}
   ]
   ```
   No filtering, no hard-coded family list, no override.

3. **DTO/Zod validation** (`search.routes.ts:34-43`) — `generatorConfig` is `z.record(z.unknown()).optional()`. Passes through unchanged.

4. **SearchService.persist** (`SearchService.ts:117-122` + `PrismaSearchRepository.createSearchRun:97-109`) — `config` is persisted as `JSON` via Prisma without filtering. **The persisted config DOES contain SENTIMENT**.

5. **SearchService.start()** (`SearchService.ts:213-230`) — `spaces` are built from `registry.list()`, which includes `strategy.sentiment.news`. The generator receives `spaces` + `persistedConfig` (with SENTIMENT).

6. **DomainGuidedGenerator** (`DomainGuidedGenerator.ts:374-385`) — With SENTIMENT in `filledFamilies`, `poolStrategyIds = [ma, rsi, sentiment.news, support_resistance]`, giving exactly 11 candidates. Verified via `scripts/audit-phase45-realtime.ts`.

7. **The bug appears here** — `buildCandidateFromStrategies` (line 197-228) builds `cand.config.name = "Domain-guided ${names.join(' + ')}"`. **`names` uses `spacesByStrategyId.get(sid) ?? registry.resolve(sid).name`.** When the same `config.id` (`strategy.composite.domain_guided.<idx>`) is re-resolved later (today), it **matches an existing StrategyVersion row created 3 days ago** with the legacy name (which used a pool that included bollinger and not sentiment.news).

8. **StrategyVersionMapper.resolveCompositeStrategy** (`StrategyVersionMapper.ts:138-172`) — On a re-resolve hit:
   - Calls `syncCompositeComponents(existingVersion.id, config.components)` → **rewrites components with NEW config** (sentiment.news).
   - Calls `getCanonicalCompositeDisplayName(config)` → returns e.g. `"Composite · Moving Average Crossover + News Sentiment Strategy"` (length ≈ 60).
   - **Conditional**: `if (canonicalName.length < existingVersion.name.length)` → fails because the legacy name is shorter (≈ 30).
   - **The name is NEVER overwritten.** Components are sentiment.news, display name still says "bollinger".

**Evidence (database, today):**

| SV implRef | SV `name` (persisted) | Actual `composite_components` |
|---|---|---|
| `…domain_guided.0` | "Domain-guided bollinger + ma" | ma, rsi |
| `…domain_guided.1` | "Domain-guided bollinger + rsi" | ma, **sentiment.news** |
| `…domain_guided.10` | "Domain-guided bollinger + ma + rsi + support_resistance" | ma, rsi, **sentiment.news**, support_resistance |

**SV creation date for these rows: 2026-09-03 (3 days before the SearchRun that surfaced them: 2026-09-06).**

**Summary:** the candidates' components are correct; their display names are stale because the mapper's name-rewrite only fires when the canonical name is shorter than the existing one. The user's 4-strategy selection does include News Sentiment; the bug is purely cosmetic (display), but it visually breaks the invariant `GENERATED CANDIDATE COMPONENTS ⊇ displayed components` — and crucially the user reads the *display name* to judge whether their selection was respected.

**Invariant check** (realtime, in-memory): `scripts/audit-phase45-realtime.ts` invokes `DomainGuidedGenerator` with the exact user payload against the live `bootstrapStrategies()` registry. Result:
- 11 candidates
- Components include `strategy.sentiment.news`
- Names include `"sentiment.news"`, NOT `"bollinger"`

So the **generation pipeline is correct**. The mapper's display-name preservation policy is the only thing keeping the bug visible.

---

### A.2 Issue B — Iteration 1 SearchRun identity

`SearchService.start()` and `loop.routes.ts` → `registerIteration({ initialSearchRunId, ... })` correctly thread the Run Combination SearchRun into Iteration 1. Audit scripts confirm `LoopIteration[1].searchRunId === CombinationBuilder SearchRun.id`. **No bug here** — Iteration 1 already preserves the SearchRun. The candidate display is broken (A.1) but the row identity is correct.

---

### A.3 Issue C — Weight-aware display names

`getCanonicalCompositeDisplayNameWithWeights(config)` exists (`CombinationConfig.ts:256-281`) and produces e.g. `"Composite · Bollinger Bands (58.36%) + Relative Strength Index (Wilder) (41.64%)"`.

**It is NOT used anywhere** in the response DTOs:

- `search.routes.ts:444-452` — `/api/search/:id/candidates` returns `strategyVersion.name` directly. Weight-free.
- `loop.routes.ts:423,466,485` — `/api/loop/candidates` and `/api/loop/progress` return `strategyName: c.strategyVersion.name`. Weight-free.
- `HybridLoopGenerator` and `LoopMutationGenerator` build composite SVs whose `.name` is set by `StrategyVersionMapper.resolveCompositeStrategy` to the **weight-free** canonical name (because the comparison is `canonicalName.length < existingVersion.name.length`, and the weight-free name is shorter, so weight-aware never wins).

**Two independent problems:**

1. The mapper's name selection is weight-free.
2. Even if the mapper were fixed, the API DTOs would still need to expose a weight-aware label separately — the SV.name is "stable family label" (Phase 3.4 contract); a *display-only* `displayNameWithWeights` should be returned alongside it.

---

### A.4 Issue D — Search Backtest UI

`/api/backtests/run` is **async by default** (`backtest.controller.ts:82-86` returns `202 + { jobId, status }`); `sync=true` makes it synchronous and returns the full `BacktestResult` immediately. The Search page already calls `sync: true` (`Search.tsx:629-632`) and saves `experimentId` — but **never fetches the result** to display it. The button only sets `loading` and `experimentId`. No result metrics render.

**No batching API exists** for batch result retrieval by candidateId. Per-candidate polling against `/api/backtests/:experimentId` would be a single fetch per terminal candidate, which is acceptable (each fetch is one experiment row + one backtest result, no N+1).

---

### A.5 Identity column on Loop candidate history

`Loop.tsx:269-271`:
```
Strategy | Type | Score | Return | Win Rate | Identity
```
"Identity" cell at `Loop.tsx:196-198` shows `c.implementationRef ?? "—"`. The contract requires removing the visible column but keeping the IDs for tooltips/debug.

---

## B. Changes (proposed — NOT yet applied)

| File | Change | Reason |
|---|---|---|
| `backend/src/modules/search/application/StrategyVersionMapper.ts` | Remove the `canonicalName.length < existingVersion.name.length` guard; always overwrite with the canonical weight-free name when components changed. | Fix A.1 — names stale because mapper refused to overwrite a shorter legacy name. |
| `backend/src/modules/search/application/StrategyVersionMapper.ts` | In bootstrap path, persist `getCanonicalCompositeDisplayNameWithWeights(config)` as a separate column on `StrategyVersion` (new column `displayNameWithWeights`). | Fix A.3 — preserve a weight-aware identity at the strategy representation level, not just as a frontend string. |
| `backend/prisma/schema.prisma` + migration | Add `displayNameWithWeights` (nullable `String`). | Storage for Fix C. |
| `backend/src/modules/search/presentation/search.routes.ts` | Add `displayNameWithWeights` field to `/api/search/:id/candidates` response. | Expose Fix C for Search/Discovery UI. |
| `backend/src/modules/leaderboard/presentation/loop.routes.ts` | Same: add `displayNameWithWeights` to `/api/loop/candidates` and `/api/loop/progress` responses. | Expose Fix C for Loop UI. |
| `frontend/src/pages/Search.tsx` | Add per-candidate `BacktestResult` state + render after `experimentId` is known. Disable button only on the clicked candidate. Show existing metrics from the Backtest/Evaluation result model (no new metrics). | Fix D — same-page result UI. |
| `frontend/src/pages/Loop.tsx` | Remove the "Identity" column header (line 270) and its cell (line 196-198). Move `implementationRef` to a `title` attribute / tooltip on the Strategy name (line 180 already has a title). | Fix A.5 — remove visible Identity column, keep IDs accessible. |

### B.1 What stays unchanged (per hard constraints)

- `Continuous Loop` lifecycle, iteration boundaries, stop conditions, parent selection, generator lifecycle, BullMQ worker concurrency, Redis architecture — **untouched**.
- Evaluation core, Ranking core, Leaderboard core — **untouched**.
- `Backtest.tsx` — **untouched**.
- No per-user isolation; shared-loop visibility preserved.
- No historical data deletion. The name fix runs on **all re-resolves from this point forward**; historical SV rows will be updated by the mapper on the next `resolveCompositeStrategy` call that touches them.
- `Combination.tsx`, `RandomGenerator`, `DomainGuidedGenerator`, `HybridLoopGenerator` — **no change**. The generator pipeline is correct.

---

## C. Domain-guided verification (realtime, in-memory)

```
registry.list() = [strategy.bollinger, strategy.ma, strategy.rsi, strategy.sentiment.news, strategy.support_resistance]
spaces = same list

applyConfig({
  mode:"EXHAUSTIVE", domainMode:"GUIDED",
  familyGroups:[trend:TREND, momentum:MOMENTUM, structure:STRUCTURE, information:SENTIMENT],
  maxComponents:4, minComponents:2,
  requiredFamilies:[TREND, MOMENTUM, STRUCTURE, SENTIMENT]
})

→ 11 candidates generated:
  ma + rsi + sentiment.news + support_resistance
  ma + rsi
  ma + sentiment.news
  ma + support_resistance
  rsi + sentiment.news
  rsi + support_resistance
  sentiment.news + support_resistance
  ma + rsi + sentiment.news
  ma + rsi + support_resistance
  ma + sentiment.news + support_resistance
  rsi + sentiment.news + support_resistance
```

✅ News Sentiment present and eligible. ✅ Bollinger is NOT in the pool (family=VOLATILITY, not in filled families). ✅ No silent injection.

---

## D. Weighted identity (planned output)

Before fix:
```
"Domain-guided bollinger + rsi"      (composite SV.name, weight-free, identical to siblings)
```

After fix (`displayNameWithWeights` returned alongside):
```
"Composite · Bollinger Bands (58.36%) + Relative Strength Index (Wilder) (41.64%)"
"Composite · Bollinger Bands (40.00%) + Relative Strength Index (Wilder) (60.00%)"
```

Two SVs that differ only in weights now have **distinguishable display labels** while their `strategyVersion.name` (family label) stays identical to preserve Phase 3.4's "same components → same family label" contract.

---

## E. Search Backtest verification (planned)

```
Click "Run Backtest" on candidate #c1
   → POST /api/backtests/run  body={candidateId:c1, sync:true}
   → 200 OK { experimentId, overallScore, totalReturn, winRate, maxDrawdown, ... }
   → render metrics under c1 only
   → c1 button → "Running…" → "Run Backtest"  (re-enabled)
   → c2, c3 buttons remain enabled throughout
   → failed: show "Backtest Failed: <error>" inline under c1
```

No navigation to `Backtest.tsx`. No new metrics.

---

## F. Performance plan

- Existing `/loop/*` polling pattern kept as-is. No new N+1 introduced.
- Search page already polls every 2s while PENDING/RUNNING, stops on terminal state (Search.tsx:679-707).
- Per-candidate backtest display uses a single fetch per terminal candidate (`GET /api/backtests/:experimentId`); not an N+1 polling loop.
- `/api/search/:id/candidates` already uses one `findMany` with an include (no per-candidate query).
- New backtest UI state is in-memory, no extra backend round-trips beyond the single `runBacktest({sync:true})` call.

---

## G. Tests (planned)

- `backend/tests/.../StrategyVersionMapper.test.ts` — new: name always overwrites when components differ; `displayNameWithWeights` always set on bootstrap + sync.
- `backend/tests/.../DomainGuidedGenerator.test.ts` — new: with payload `[MA,RSI,SR,NEWS]` produces 11 candidates, sentiment.news appears, bollinger absent.
- `backend/tests/.../CombinationConfig.test.ts` — new: weight-aware label distinguishes weights; deterministic; not recursive.
- `frontend/src/pages/__tests__/Search.backtest.test.tsx` — new: per-candidate state isolation; disabled only on clicked; failed state shown; no /backtest navigation.
- `frontend/src/pages/__tests__/Loop.identity.test.tsx` — Identity column removed; implementationRef still in tooltip.

---

## H. Lifecycle safety

- `Continuous Loop` lifecycle: **unchanged** (no edits to `loop-orchestrator-runner.ts`, `loop.routes.ts`, `loop.processed-event.ts`, or worker concurrency).
- Iteration boundaries: **unchanged** (Iteration 1 still uses the Run Combination SearchRun; Iteration 2+ still uses `HybridLoopGenerator`).
- Stop conditions: **unchanged**.
- BullMQ worker concurrency / Redis: **unchanged**.
- Evaluation/Ranking/Leaderboard core: **unchanged** (mapper fix only touches name persistence).
- `Backtest.tsx`: **untouched**.
- Shared-loop visibility: **preserved** (no per-user isolation added).

---

## Files saved by this audit

- `backend/scripts/audit-phase45.ts` — recent SearchRuns list
- `backend/scripts/audit-phase45-2.ts` — candidate components of `65d89c34`
- `backend/scripts/audit-phase45-3.ts` — first SV inspection
- `backend/scripts/audit-phase45-4.ts` — composite components by SV id
- `backend/scripts/audit-phase45-5.ts` — per-candidate SV + composite components
- `backend/scripts/audit-phase45-6.ts` — definition relation shape
- `backend/scripts/audit-phase45-7.ts` — list recent runs (alt)
- `backend/scripts/audit-phase45-8.ts` — family verification
- `backend/scripts/audit-phase45-9.ts` — full candidate detail
- `backend/scripts/audit-phase45-10.ts` — creation timestamps (SV vs Candidate)
- `backend/scripts/audit-phase45-list.ts` — list helper
- `backend/scripts/audit-phase45-realtime.ts` — **proof the live generator emits the correct 11 candidates with sentiment.news**
- `audit-phase45*.txt` — captured outputs

---

## Decision

Fix Plan B is **minimal, demo-safe, and root-cause-correct**. Awaiting user approval before applying.
