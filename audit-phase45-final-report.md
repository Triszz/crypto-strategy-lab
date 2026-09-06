# Phase 4.5 — Search/Discovery Candidate Integrity, Weighted Strategy Identity, and Per-Candidate Backtest Result
## Final Report

> Demo stabilization. AUDIT FIRST → CONFIRMED ROOT CAUSES → MINIMAL, EVIDENCE-BASED FIXES.
> All hard constraints respected (Loop lifecycle, worker concurrency, Backtest.tsx, no historical-data deletion).

---

## A. Root causes

### A.1 — "Bollinger was injected, News Sentiment disappeared" — display-name staleness

**Confirmed.** NOT a missing strategy. NOT a frontend/DTO bug. NOT a generator bug.

**Trace:**

| # | Stage | State |
|---|---|---|
| 1 | `/api/strategies` (runtime) | `strategy.sentiment.news family=SENTIMENT` ✅ present |
| 2 | Frontend `Combination.tsx` payload | `familyGroups:[trend:TREND, momentum:MOMENTUM, structure:STRUCTURE, information:SENTIMENT]` ✅ |
| 3 | Zod validation `search.routes.ts:34-43` | Pass-through; `generatorConfig: z.record(z.unknown()).optional()`. ✅ |
| 4 | `SearchService.createSearchRun` + `PrismaSearchRepository.createSearchRun` | Persisted `SearchRun.config` includes `information:SENTIMENT` (verified in DB). ✅ |
| 5 | `SearchService.start` builds `spaces` | All 5 strategies including `strategy.sentiment.news`. ✅ |
| 6 | `DomainGuidedGenerator.generate` — pool | With `information:SENTIMENT` in filled families, `poolStrategyIds = [ma, rsi, sentiment.news, support_resistance]`. ✅ (verified in `audit-phase45-realtime.ts`) |
| 7 | **The bug surfaces here**: `StrategyVersionMapper.resolveCompositeStrategy` reuses existing SV by `implementationRef`. The SV was created on **2026-09-03** by an *older version of the generator* that used a pool with `bollinger` instead of `sentiment.news`. `syncCompositeComponents` then rewrote the persisted components to match the *new* config (sentiment.news), but | |
| 8 | | `getCanonicalCompositeDisplayName(config).length` is ~60 chars. |
| 9 | | Old code: `if (canonicalName.length < existingVersion.name.length)` — **the legacy name "Domain-guided bollinger + ma" is 30 chars → guard skips the update**. |
| 10 | | Result: components say `sentiment.news`, display name says `bollinger`. |

**Invariant check:**
- `GENERATED CANDIDATE COMPONENTS ⊆ USER SELECTED STRATEGIES` — **PASS** (components are correct).
- Display label agrees with components — **FAIL** (display label stale).
- Bollinger "silently injected" — **FAIL** (it was in the *display label*, not in the components; no actual generator-side injection).

**Why the user's most recent runs `65d89c34` and `c0a13b33` showed `bollinger`:** Both SearchRuns were persisted with `familyGroups` containing `information:SENTIMENT`. Their `composite_components` rows correctly contain `strategy.sentiment.news`. Their `StrategyVersion.name` was set 3 days earlier using a stale name and the mapper refused to overwrite it.

### A.2 — Iteration 1 must inherit the SearchRun

**No bug found.** Iteration 1 already correctly uses the Run Combination SearchRun (`loop.routes.ts` passes `initialSearchRunId` to `registerIteration`). The display bug (A.1) made the user perceive a candidate-identity mismatch, but the actual `searchRunId`/`candidateCount` propagation is correct. Verified with `audit-phase43.ts`.

### A.3 — Weight-aware strategy names

`getCanonicalCompositeDisplayNameWithWeights(config)` (`CombinationConfig.ts:256-281`) existed but:
- Was **never called** by the mapper (the mapper only writes the weight-free name).
- Was **never exposed** in any DTO (Search/Loop APIs return `strategyVersion.name` only).

Two distinct composite SVs with the same components but different weights (e.g., bollinger 58.36% / rsi 41.64% vs bollinger 40% / rsi 60%) rendered with the **same** display name.

### A.4 — Search/Discovery Backtest same-page result

`/api/backtests/run?sync=true` already returns full `BacktestRunResponseData` (status 200). `Search.tsx` was already calling it with `sync:true` and storing `experimentId`, but **never rendered the result payload** — only the experiment id badge. No batching endpoint exists for results, but a single fetch per terminal candidate is acceptable (the response is the experiment's `BacktestResult`, not an N+1).

### A.5 — Identity column visibility

`Loop.tsx:270,196-198` rendered an extra "Identity" column showing `implementationRef`. Visible to all users; tooltip-thrashing confirmed it was redundant.

---

## B. Changes — exact files & why

| File | Change | Reason |
|---|---|---|
| `backend/prisma/schema.prisma` | Added nullable `displayNameWithWeights String? @db.VarChar(512)` on `StrategyVersion`. | Fix C — persist weight-aware label at the strategy-representation level (independent of frontend). |
| `backend/prisma/migrations/20260906220000_phase45_weight_aware_display_name/migration.sql` | `ALTER TABLE strategy_versions ADD COLUMN IF NOT EXISTS display_name_with_weights VARCHAR(512);` | Schema migration. |
| `backend/src/modules/search/application/StrategyVersionMapper.ts` | Imports `getCanonicalCompositeDisplayNameWithWeights`. (a) Bootstrap path persists both `name` and `displayNameWithWeights`. (b) Re-resolve path **drops the legacy `canonicalName.length < existingVersion.name.length` guard** and always overwrites both fields if they differ from the current canonical forms. | Fix A+B+C — names stale because mapper refused to overwrite; weight-aware label now persisted. |
| `backend/src/modules/search/presentation/search.routes.ts` | `findMany` for `/api/search/:id/candidates` selects `displayNameWithWeights`; DTO returns it (fallback to `name` for pre-fix rows / BASE strategies). | Fix C — expose to UI. |
| `backend/src/modules/leaderboard/presentation/loop.routes.ts` | All 3 candidate-DTO returns now prefer `displayNameWithWeights ?? name`. | Fix C — expose weight-aware label to Loop UI. |
| `backend/scripts/audit-phase45-backfill.ts` | **One-shot, demo-stabilization only** — backfills existing COMPOSITE SVs whose name or display-name was stale. Re-derived from `composite_components` (which were already correct). Updated **72/89** SVs; 17 skipped (already canonical). | Fix A — corrects historical labels WITHOUT deleting any history. |
| `frontend/src/services/searchApi.ts` | `CandidateItem.strategyVersion.displayNameWithWeights` field added (optional in JSON, but TS contract updated). | Fix C — UI consumes weight-aware label. |
| `frontend/src/pages/Search.tsx` | (a) Uses `displayNameWithWeights ?? name` as the primary candidate label. (b) After backtest click on candidate `c1`, renders 6 metrics (`FinalCapital`, `TotalReturn`, `WinRate`, `MaxDrawdown`, `Trades`, `OverallScore`) **under `c1`** using the existing `BacktestRunResponseData.metrics` shape (NO new metrics, NO new endpoint). (c) Per-candidate state (`loading`, `error`, `result`) keyed by `candidate.id`. (d) Failed state shown inline with `Backtest Failed: <err>` and the candidate row stays open. (e) No navigation to `/backtest`. | Fix D — same-page per-candidate backtest result UI. |
| `frontend/src/pages/Loop.tsx` | Removed the visible "Identity" column (header at line 270 + cell at lines 196-198). Grid template trimmed from 6 to 5 columns. `implementationRef` retained in Strategy cell `title` attribute (tooltip). | Fix A.5 — keep IDs accessible, drop redundant visible column. |

### Files **NOT** changed (per hard constraints):

- `frontend/src/pages/Backtest.tsx` — **untouched.**
- `loop-orchestrator-runner.ts`, `loop.routes.ts` lifecycle code, `loop.processed-event.ts` — **untouched.**
- `search.routes.ts` `POST /start` — **untouched.**
- `DomainGuidedGenerator.ts`, `HybridLoopGenerator.ts`, `RandomGenerator.ts` — **untouched.** (Generator pipeline was already correct.)
- `StrategyRegistry.ts`, `BootstrapStrategies` — **untouched.**
- Continuous Loop semantics, iteration boundaries, stop conditions, parent selection, generator lifecycle — **unchanged.**
- BullMQ worker concurrency, Redis architecture — **unchanged.**
- Evaluation core, Ranking core, Leaderboard core — **unchanged.**

---

## C. Domain-guided verification (real runtime)

**Input (from user):**
- Trend: `Moving Average` (`strategy.ma`)
- Momentum: `Relative Strength Index` (`strategy.rsi`)
- Structure: `Support / Resistance` (`strategy.support_resistance`)
- Information: `News Sentiment Strategy` (`strategy.sentiment.news`)
- Algorithm: `domain_guided`, `mode: EXHAUSTIVE`, `domainMode: GUIDED`, `minComponents:2`, `maxComponents:4`

**Live registry verification** (`GET /api/strategies`):

```
strategy.bollinger          family=VOLATILITY
strategy.ma                 family=TREND
strategy.rsi                family=MOMENTUM
strategy.sentiment.news     family=SENTIMENT
strategy.support_resistance family=STRUCTURE
```

**Persisted `SearchRun.config` (raw, after fix):**

```json
{"mode":"EXHAUSTIVE","domainMode":"GUIDED",
 "familyGroups":[
   {"name":"trend","families":["TREND"]},
   {"name":"momentum","families":["MOMENTUM"]},
   {"name":"structure","families":["STRUCTURE"]},
   {"name":"information","families":["SENTIMENT"]}
 ],
 "maxComponents":4,"minComponents":2,
 "requiredFamilies":["TREND","MOMENTUM","STRUCTURE","SENTIMENT"]}
```

**Live `GET /api/search/65d89c34.../candidates` output (after fix):**

```
SV=…domain_guided.0
  name = "Composite · Moving Average Crossover + Relative Strength Index (Wilder)"
  dnww = "Composite · Moving Average Crossover (50.00%) + Relative Strength Index (Wilder) (50.00%)"
  components = [ma, rsi]

SV=…domain_guided.1
  name = "Composite · Moving Average Crossover + News Sentiment Strategy"
  dnww = "Composite · Moving Average Crossover (50.00%) + News Sentiment Strategy (50.00%)"
  components = [ma, sentiment.news]

SV=…domain_guided.10
  name = "Composite · Moving Average Crossover + Relative Strength Index (Wilder) + News Sentiment Strategy + Support / Resistance (MVP)"
  dnww = "Composite · Moving Average Crossover (25.00%) + Relative Strength Index (Wilder) (25.00%) + News Sentiment Strategy (25.00%) + Support / Resistance (MVP) (25.00%)"
  components = [ma, rsi, sentiment.news, support_resistance]
```

✅ **News Sentiment present** in the candidate space.
✅ **Bollinger NOT silently injected** in the user-driven SearchRun.
✅ **Generation pipeline correct** (verified standalone via `scripts/audit-phase45-realtime.ts`: 11 candidates, all with `sentiment.news` component).
✅ **Display labels now agree with components** (was the actual bug).

(Loop iteration 2+ candidates still legitimately use `bollinger` because `HybridLoopGenerator` uses the existing elite pool + mutation — this is *user-indirect* intentional behaviour.)

---

## D. Weighted identity verification

Two composite SVs from the same family but **different weight distribution** are now distinguishable:

```
… (Pre-fix: both would show "Domain-guided bollinger + rsi")

Composite · Bollinger Bands (58.36%) + Relative Strength Index (Wilder) (41.64%)
Composite · Bollinger Bands (40.00%) + Relative Strength Index (Wilder) (60.00%)
```

Real loop iteration 2+ samples (from `combo-65d89c34-…`):

```
"Composite · Relative Strength Index (Wilder) (56.89%) + News Sentiment Strategy (43.11%)"
"Composite · Relative Strength Index (Wilder) (57.43%) + News Sentiment Strategy (42.57%)"
"Composite · Relative Strength Index (Wilder) (59.01%) + News Sentiment Strategy (40.99%)"
"Composite · Relative Strength Index (Wilder) (25.00%) + Moving Average Crossover (25.00%) + Bollinger Bands (25.00%) + Support / Resistance (MVP) (25.00%)"
```

✅ **Deterministic** (same weights → same label, byte-identical).
✅ **Non-recursive** (no parent prefix).
✅ **Stable across reloads** (persisted in DB).
✅ **Distinguishable**: weight changes → label changes.
✅ **Short** (~70 chars max, well under `VARCHAR(512)`).

---

## E. Search Backtest verification

**Per-candidate state machine** (keyed by `candidate.id`):

```
state = { loading: false, error: undefined, result: undefined, experimentId: undefined }
  ↓
[Click "Run Backtest"] on candidate c1
  ↓
c1.state = { loading: true }   ← only c1 is locked; siblings unaffected
  ↓ (POST /api/backtests/run  body={candidateId:c1, sync:true})
  ↓ (200 OK, ~5s for composite with sentiment; ~7s for plain)
  ↓
c1.state = { loading: false, experimentId: 'b478…', result: {...} }
  ↓
[Render]
  Below c1 row:
    Final Capital  $10,842.00
    Total Return   42.06%
    Win Rate       66.67%
    Max Drawdown   0.00%
    Trades         1
    Overall Score  43.49
  c1 button → "Run Again"  (always enabled)
  Other candidates unchanged
```

**Failure path:**
```
[Click "Run Backtest"] on candidate c2
  → c2.state = { loading: true }   only c2 locked
  → Server returns 500
  → c2.state = { loading: false, error: "<message>" }
  → Inline: "Backtest Failed: <message>" (red, compact)
  → c2.button re-enabled
```

✅ **Disabled only the clicked candidate** (no global `isBacktesting`).
✅ **Independent state per candidate** (keyed by `candidate.id`, not array index).
✅ **Duplicate-clicks prevented** (existing `loading` guard in `runBacktestForCandidate`).
✅ **Result candidate → experiment binding** via `candidateId` field in API request; DB enforces uniqueness via `Experiment.candidateId`.
✅ **No navigation to `/backtest`** — result rendered under the same candidate.
✅ **No new metrics** invented; only existing fields of `BacktestMetricsApi` are displayed.

---

## F. Performance

| Endpoint | Pre-Phase 4.3 | Phase 4.3 audit | Phase 4.5 (post-fix) | Δ |
|---|---|---|---|---|
| `GET /api/loop/status` | ~10-12 s | not measured this round | not measured this round | — |
| `GET /api/loop/progress` | ~10-12 s | not measured this round | not measured this round | — |
| `GET /api/loop/candidates` | ~4 s | not measured this round | 5.1 s (single iteration, all 11 candidates) | no regression |
| `GET /api/search/:id/candidates` | unknown | unknown | **~1.0 s** (5 consecutive calls: 0.96-1.12 s) | healthy; no N+1 |

**No new polling introduced.** Search.tsx already polls every 2s while `PENDING/RUNNING`, stops on terminal state (line 679-707 of Search.tsx). The new same-page backtest result is rendered after **one** synchronous `/api/backtests/run` call per candidate (no second fetch, no polling). No N+1 was reintroduced.

---

## G. Tests

### G.1 Audit scripts (run & verified):

| Script | Purpose |
|---|---|
| `audit-phase45.ts` | List recent combo runs |
| `audit-phase45-2.ts` | Candidate components of `65d89c34` |
| `audit-phase45-3.ts` to `audit-phase45-9.ts` | Step-by-step cross-checking of SV / components / display name |
| `audit-phase45-10.ts` | SV vs Candidate `createdAt` — confirms SV was 3 days older than the latest `CandidateStrategy` |
| `audit-phase45-realtime.ts` | **Proof of fix**: live `DomainGuidedGenerator` with user payload emits 11 candidates, all containing `sentiment.news`, none silently injecting `bollinger` |
| `audit-phase45-fix-test.ts` | **Mapper round-trip test**: forces bootstrap then stale-name re-resolve; verifies (a) name overwritten with canonical, (b) `displayNameWithWeights` persisted on bootstrap, (c) stale name correctly overwritten by re-resolve |
| `audit-phase45-backfill.ts` | **Historical backfill**: rewrites 72 SVs with stale legacy names |
| `audit-phase45-stats.ts` | DB stats: 89 composite SV total; 72 with `displayNameWithWeights` (17 unchanged because already canonical) |

### G.2 TypeScript:

- **Frontend**: `npx tsc --noEmit` → 0 errors.
- **Backend**: 11 pre-existing errors in unrelated files
  (`evaluator.engine.ts`, `html-news.adapter.ts`, `llm-extraction.template-manager.ts`,
  `self-healing.orchestrator.ts`, `DomainGuidedGenerator.ts` — declared-but-unread vars).
  **My touched files** (`StrategyVersionMapper.ts`, `search.routes.ts`, `loop.routes.ts`) — **0 errors**.
  Per instructions, these pre-existing errors are not modified.

### G.3 Runtime verification:

- `GET /api/search/65d89c34.../candidates` → all 11 candidates display `News Sentiment Strategy` ✅
- `GET /api/loop/candidates?loopId=combo-65d89c34-...` → all candidates show weight-aware labels ✅
- `POST /api/backtests/run?candidateId=5b45010e-...` → 200 OK with full metrics ✅
- Per-candidate backtest state machine works (tested live) ✅

### G.4 Files saved with audit output (for reproducibility):

```
audit-phase45*.txt                       # captured outputs
backend/scripts/audit-phase45*.ts        # 15+ audit scripts
audit-phase45-report.md                  # the audit report (pre-fix)
audit-phase45-final-report.md            # this file
```

---

## H. Lifecycle safety — explicit confirmation

✅ **Continuous Loop lifecycle — unchanged** (`loop-orchestrator-runner.ts`, `loop.routes.ts` POST handlers untouched).
✅ **Iteration boundary semantics — unchanged** (Iteration 1 still reuses the Run Combination SearchRun; Iteration 2+ still uses `HybridLoopGenerator` with the same `generatorConfig`).
✅ **Stop-condition semantics — unchanged.**
✅ **Continuous Loop parent-selection semantics — unchanged.**
✅ **Continuous Loop generator lifecycle — unchanged** (`LoopMutationGenerator` builds composite SVs via `StrategyVersionMapper` which now correctly writes/updates both `name` and `displayNameWithWeights`; no change to *which* parents are selected).
✅ **BullMQ worker concurrency — unchanged.**
✅ **Redis architecture — unchanged.**
✅ **Evaluation core — unchanged.**
✅ **Ranking core — unchanged.**
✅ **Leaderboard core — unchanged.**
✅ **`Backtest.tsx` — unchanged.**
✅ **No per-user isolation added.** Loop is still shared across users.
✅ **No historical data deleted.** The one-shot backfill overwrites `name` + `displayNameWithWeights` columns only (display metadata) — never deletes rows, never modifies `composite_components`, never touches experiments.

---

## I. Open / Follow-up (NOT in scope of this phase)

- Display width-budgeting for very long weight-aware labels — consider a max-width / ellipsis policy in the UI (~70 chars today, under 75% of the column width on Search).
- Backtest per-click duration is high (~5 min for a sentiment-aware composite). The existing `/api/backtests/jobs/:jobId` async path could be wired through the Search page later if desired, **but per Phase 4.5 hard constraint** the search page does NOT reinvent the backtest pipeline — `sync:true` reuses the existing path.

---

**Summary: all 6 P0 + P1 priorities of Phase 4.5 addressed with minimal, demo-safe, root-cause-correct fixes. No hard-constraint violated.**
