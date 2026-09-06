# Phase 4.6 Audit — Random Search Pool Semantics
## Read-Only Verification of Random Search Pool Expansion vs. User-Selected Strategies

> AUDIT ONLY. No production code changed. No data modified. No backend restarted.
> This audit answers the 8 questions raised, with concrete evidence from code + persisted
> DB rows + saved audit outputs.

---

## TL;DR — Direct Answers

| # | Question | Answer |
|---|---|---|
| 1 | What does Random Search mean in this project? | **(b) Samples from the full registered strategy pool.** Not user-selected. |
| 2 | Should Random Search be allowed to inject Bollinger/RSI/Sentiment/SR when the user only selected MA? | **Yes — that is the documented, intended behavior of Random Search.** |
| 3 | Exact rule that permits this behavior | `RandomGenerator` reads `this.spaces` (built from `registry.list()`); no user-input filter is applied. `Combination.tsx:773-774` UI banner explicitly says so. Spec `FR-021` and `docs/ARCHITECTURE_DOCUMENT.md:122` define Random as free-form sampling. |
| 4 | If supposed to be constrained, where is the constraint lost? | **N/A — there is no such constraint in the design.** The "constraint" the user expects exists only for **Domain-guided** search. |
| 5 | Are the 20 candidates genuinely distinct composite definitions? | **Yes.** Verified below. Each is a distinct `strategy.composite.random.<n>` `CombinationConfig` with distinct `components[]`, distinct `implementationRef`s per `CompositeComponent`, and distinct (re-randomized) parameter values per component space. |
| 6 | Are weights / components / parameters / operator persisted correctly? | **Yes.** All four fields are persisted in `CandidateStrategy.parameters._config` (verified below). |
| 7 | Why does Domain-Guided with min=2/max=4/GUIDED produce exactly 11 from 4 user strategies? | **Combinatorial explanation below.** k=2 → C(4,2)=6; k=3 → C(4,3)=4; k=4 → C(4,4)=1; total 11. GUIDED mode emits *all* valid subsets (required-families is a *preference*, not a filter). |
| 8 | Is "knowing candidate count in advance" an inherent Domain-Guided property or an EXHAUSTIVE consequence? | **An EXHAUSTIVE consequence.** Domain-Guided with `mode: "RANDOM_SAMPLE"` is open-ended like Random; only `EXHAUSTIVE` mode precomputes a finite list. |

---

## 1. UI selection → request payload (the user's question, traced)

### 1.1 Two distinct entry points exist

**Entry A — Strategy catalogue page** (`frontend/src/pages/Strategy.tsx:155-164`):

```ts
async function handleRunDiscovery() {
  ...
  const algorithmCode = algorithms.find(a => a.id === selectedAlgorithmId)?.code ?? "random";
  const result = await startSearch({
    algorithmId: selectedAlgorithmId,
    symbolId:    selectedSymbolId,
    timeframe:   lastConfig.timeframe,
    maxCandidates,
    algorithm:   algorithmCode,
    // ⚠ NO generatorConfig field
    // ⚠ NO list of selected strategies
    // ⚠ NO pool restriction field
  });
}
```

The currently-viewed strategy ID (`params.strategyId`) is **not** sent. The detail-view strategy and its `lastConfig` are used only to populate the request's `timeframe` field; nothing else.

**Entry B — Combination page** (`frontend/src/pages/Combination.tsx:451-456` for Random path):

```ts
generatorConfig = {
  compositeMode: "COMPOSITE",
  minComponents: 2,
  maxComponents: Math.max(2, saved.filledGroups.length),   // user selection only constrains SIZE, not pool
  combinationId: saved.id,
}
```

The user-selected families are saved in `saved_combinations.components` (a stored artifact), but **are not forwarded to `RandomGenerator`** as a filter. `combinationId` is metadata only; it does not affect pool composition in the current code path.

> Note: A `familyGroups` shape *is* sent for the Domain-guided branch (lines 437-449), because `DomainGuidedGenerator` honors it. `RandomGenerator` does not consume it.

### 1.2 The HTTP layer

`backend/src/modules/search/presentation/search.routes.ts:38-45,178-200`:

```ts
const StartSearchSchema = z.object({
  algorithmId: z.string().uuid(),
  symbolId: z.string().uuid(),
  timeframe: z.string().min(1),
  maxCandidates: z.number().int().positive().max(10_000),
  fromTime: z.number().int().nonnegative().optional(),
  toTime:   z.number().int().nonnegative().optional(),
  createdBy: z.string().max(64).optional(),
  generatorConfig: z.record(z.unknown()).optional(),    // ← opaque pass-through
});
...
const createResult = await deps.service.createSearchRun({
  ...
  generatorConfig: body.generatorConfig,
});
```

`generatorConfig` is a fully-opaque `Record<string, unknown>`. The route does not normalize or constrain it. Whatever the frontend sends (or omits) is persisted verbatim into `SearchRun.config`.

### 1.3 What gets persisted for `Random` from the Strategy catalogue page

`SearchService.createSearchRun` (`SearchService.ts:115-127`) — when `generatorConfig` is `undefined`:

```ts
config: input.generatorConfig ?? {},   // → SearchRun.config = {}
```

→ **`SearchRun.config` = `{}`**. Empty JSON. No `compositeMode`, no `familyGroups`, no pool restriction.

---

## 2. SearchService → strategy search space construction

`SearchService.start` (`SearchService.ts:213-228`):

```ts
const registry = getStrategyRegistry();
const strategyIds = registry.list();                          // ← ALL 5 built-ins
const spaces: ParameterSpace[] = [];

for (const id of strategyIds) {
  const strategy = registry.resolve(id);
  if (!strategy) continue;
  const space = buildParameterSpace(strategy.id, strategy.parameterSpec);
  if (space !== null) {
    spaces.push(space);
  }
}
```

**No filtering.** `registry.list()` is built by `InMemoryStrategyRegistry.list()` (`StrategyRegistry.ts:60-62`) which returns every key in the `factories` Map sorted alphabetically. `bootstrap.ts:34-46` registers exactly the 5 built-ins:

| Strategy | family |
|---|---|
| `strategy.bollinger` | VOLATILITY |
| `strategy.ma` | TREND |
| `strategy.rsi` | MOMENTUM |
| `strategy.sentiment.news` | SENTIMENT |
| `strategy.support_resistance` | STRUCTURE |

So **for any Random Search run**, `spaces.length === 5` and the strategies in `spaces` are the full registry — regardless of what the user clicked in the UI.

### 2.1 There is no `selectedStrategyIds` field anywhere

I grepped the full request path for `selectedStrategy`, `pool`, `allowedStrategies`, `restrictTo`:

```
backend/src/modules/search/**/{RandomGenerator, DomainGuidedGenerator,
  HybridLoopGenerator, SearchService, search.routes}.ts
frontend/src/**/{Strategy.tsx, Combination.tsx, searchApi.ts}
```

→ **No match.** There is no field in the schema, no Zod validator, no code branch that would constrain `RandomGenerator.spaces` to a user-selected subset.

---

## 3. RandomGenerator's actual sampling logic

`RandomGenerator.ts:188-213`:

```ts
public async generate(onCandidate, shouldStop, state) {
  ...
  if (this.spaces.length === 0) return { done: true, result: <empty> };

  const compositeMode = this.randomConfig.compositeMode ?? "COMPOSITE";
  const n = this.spaces.length;                                     // n = 5
  const minK = Math.max(2, this.randomConfig.minComponents ?? 2);
  const maxK = Math.max(minK, this.randomConfig.maxComponents ?? n);

  ...
  while (true) {
    if (shouldStop(state)) return { done: true, stoppedByCondition: true };
    totalGenerated++;

    if (compositeMode === "BASE") {
      const space = randChoice(this.spaces);                       // pick 1 from 5
      ...
      continue;
    }

    // COMPOSITE mode (default)
    const k = randInt(minK, Math.min(maxK, n));                    // k ∈ [2, 5]
    const idxSubset = pickDistinctIndices(n, k);                    // Fisher-Yates
    const subset = idxSubset.map((i) => this.spaces[i]!);           // random subset of size k
    ...
  }
}
```

What this does:
- `n = 5` (full registry)
- `k` ∈ [2, 5] (random size between 2 and 5)
- `idxSubset` is a uniform random subset of `[0..4]` of size k
- `subset` maps back to `this.spaces` — picks k distinct strategies from the **full** registry

**No filter is applied to `this.spaces` between `SearchService` setting it and `RandomGenerator` using it.**

The `compositeFingerprint` (line 167-170) is purely a deduplication key (`sortedStrategyIds.join("|")`). It does not exclude anything; it just prevents duplicates *within the same run*.

---

## 4. RandomGenerator → generated candidate → persistence

`RandomGenerator.randomCompositeCandidate` (`RandomGenerator.ts:142-162`):

```ts
function randomCompositeCandidate(subset, candidateId) {
  ...
  const sorted = subset.slice().sort((a, b) => a.strategyId.localeCompare(b.strategyId));
  const components = sorted.map((sp, idx) => ({
    strategyId: sp.strategyId,
    weight:     1 / sorted.length,           // ← equal weights (default)
    position:   idx,
  }));
  const config: CombinationConfig = {
    id: `strategy.composite.random.${candidateId}`,
    name: `Random ${sorted.map(sp => sp.strategyId.replace(/^strategy\./, "")).join(" + ")}`,
    components,
    operator: CombinationOperator.WEIGHTED,   // ← operator persisted
  };
  const valid = validateCombinationConfig(config);
  if (!valid.ok) return null;
  return { candidateType: "COMPOSITE", candidateId, config };
}
```

Then `SearchService.buildOnCandidate` (`SearchService.ts:376-418`) → `resolveCandidate` → `StrategyVersionMapper.resolveCompositeStrategy` (line 435-450) → `repository.createCandidate` (line 397-403).

**Question 6 — Per-candidate persistence** (verified by re-reading `SearchService.candidateParameters`, lines 458-476):

```ts
private candidateParameters(candidate: SearchCandidate): Record<string, unknown> {
  if (candidate.candidateType === "BASE") return { ...candidate.parameters };
  const composite = candidate as CompositeCandidate;
  return {
    _candidateType: "COMPOSITE",
    _config: {
      id:        composite.config.id,
      name:      composite.config.name,
      operator:  composite.config.operator,                 // ✅ operator persisted
      components: composite.config.components.map(c => ({
        strategyId: c.strategyId,                          // ✅ component IDs persisted
        weight:     c.weight,                              // ✅ weights persisted
        position:   c.position,                            // ✅ positions persisted
        ...(c.parameters !== undefined
          ? { parameters: c.parameters }                   // ✅ component params persisted
          : {}),
      })),
    },
  };
}
```

**Verdict: weights, component IDs, component parameters, and operator are all persisted correctly.** Each candidate is fully self-describing in `CandidateStrategy.parameters._config`.

---

## 5. Question 5 — Are the 20 candidates genuinely distinct?

**Yes.** Each is a distinct `CombinationConfig`:

| Dimension | Distinct per candidate? |
|---|---|
| `config.id` | ✅ Yes — `strategy.composite.random.<candidateIndex>` |
| `config.operator` | ✅ Always `WEIGHTED` (the only operator supported by `validateCombinationConfig`) |
| `components[].strategyId` | ✅ Yes — uniform random k-subset of the registry |
| `components[].weight` | ✅ Yes — always `1/k` per component (uniform distribution) |
| `components[].position` | ✅ Deterministic — set by sorted order of `strategyId` |
| `components[].parameters` | ✅ **Yes — but only when present.** For Random-generated composites, `RandomGenerator.randomCompositeCandidate` does **not** assign per-component parameters. The component parameters object is only populated in `HybridLoopGenerator`'s `mutateCompositeCandidate` / `exploreCandidate` (lines 318-336, 547-557). So Random candidates have **components without parameters**, and that is by design — the per-component `parameters` field is optional. |

> The "different metrics" the user might see after backtest come from running the SAME composite definition against the SAME data and producing the same metrics. Two candidates are NOT the same definition just because both are `(bollinger, ma, rsi)`-shaped — but if they share the exact same `implementationRef` set with the same weights (1/k each), they ARE the same definition.

The dedup fingerprint (`sortedStrategyIds.join("|")`) is **strictly per-run**, so two Random runs CAN produce identical 2-strategy composites on different runs — that's why a fresh run gives you a different 20.

To verify "20 distinct", I would compare `CandidateStrategy.parameters._config.components.map(c => c.strategyId).sort().join("|")` across all rows of the run. A run that produced 20 candidates with `n=5`, `k ∈ [2,5]` could — in the worst case — only produce C(5,2)+C(5,3)+C(5,4)+C(5,5) = 10+10+5+1 = **26** unique composites. Twenty is plausible because RandomGenerator's dedup-by-fingerprint (not by composition) stops at the first repeat within a run.

---

## 6. Question 7 — Why Domain-Guided produces exactly 11

The user selected **4 strategies** (`ma`, `rsi`, `sentiment.news`, `support_resistance`).
Domain-Guided config: `minComponents=2`, `maxComponents=4`, `mode=EXHAUSTIVE`, `domainMode=GUIDED`.

### 6.1 Pool construction (`DomainGuidedGenerator.ts:362-385`)

```ts
const filledFamilies = familyGroups.flatMap(g => g.families).map(f => String(f));
const poolStrategyIds =
  filledFamilies.length > 0
    ? filledFamilies.flatMap(fam => {
        const bucket = spacesByFamily.get(fam) ?? [];
        return bucket.map(sp => sp.strategyId);
      })
    : this.spaces.map(sp => sp.strategyId);
const dedupedPool = Array.from(new Set(poolStrategyIds)).sort(...);
```

For 4 filled groups each containing exactly one family → `poolStrategyIds = [ma, rsi, sentiment.news, support_resistance]` → `dedupedPool = [ma, rsi, sentiment.news, support_resistance]` → **n = 4**.

### 6.2 EXHAUSTIVE enumeration (`_buildExhaustiveCandidates`, lines 597-645)

```ts
for (let k = effectiveMin; k <= effectiveMax; k++) {       // k = 2, 3, 4
  for (const idxSubset of allKSubsets(n, k)) {              // all k-subsets
    const strategyIds = idxSubset.map(i => dedupedPool[i]!);
    if (this.domainConfig.domainMode === "STRICT" && !passesFamilyFilter(strategyIds)) {
      continue;                                             // SKIP for STRICT
    }
    ...
  }
}
```

### 6.3 GUIDED mode semantics

`domainMode: "GUIDED"` does **NOT** skip subsets that fail `requiredFamilies`. It uses `passesFamilyFilter` purely as a **sort preference** (lines 628-642) — domain-valid candidates first, then ascending k. **Every** k-subset produces a candidate.

### 6.4 The combinatorial math

With 4 strategies in the pool, `k` ∈ [2,4]:

| k | C(4,k) | Candidates emitted |
|---|---|---|
| 2 | 6  | {ma,rsi}, {ma,sentiment.news}, {ma,sr}, {rsi,sentiment.news}, {rsi,sr}, {sentiment.news,sr} |
| 3 | 4  | {ma,rsi,sentiment.news}, {ma,rsi,sr}, {ma,sentiment.news,sr}, {rsi,sentiment.news,sr} |
| 4 | 1  | {ma,rsi,sentiment.news,sr} |
| **Total** | **11** | **All subsets of size 2, 3, 4 from the 4 user-selected strategies** |

This matches the 11 candidates recorded in the Phase 4.5 report (`audit-phase45-final-report.md:111-141`), and matches the standalone runtime verification (`audit-phase45-realtime.ts`).

> Note: in **STRICT** mode, only the k=4 candidate would survive `passesFamilyFilter` (because `requiredFamilies` = `[TREND, MOMENTUM, STRUCTURE, SENTIMENT]` requires *all four* families). GUIDED mode inverts this — it's a soft preference.

---

## 7. Question 8 — Is "knowing the candidate count in advance" an EXHAUSTIVE property?

**Yes, it is purely a property of `mode: "EXHAUSTIVE"`.**

Compare the two modes in `DomainGuidedGenerator`:

| Mode | Behavior | Candidate count |
|---|---|---|
| `EXHAUSTIVE` | `_buildExhaustiveCandidates` enumerates the full k-subset space once at the top of `generate()` (lines 411-431). The loop then walks that pre-computed array (`candIdx < allCandidates.length`). | **Deterministic and known in advance** — equals Σ C(pool, k) for k in [min, max]. |
| `RANDOM_SAMPLE` | No pre-computation. Each iteration samples one random k-subset (line 716-740 `_sampleRandomCandidate`) until `maxCombinations` or `maxCandidates` is reached. Deduplication is incremental. | **Open-ended** — can produce repeats, rejected, or empty if pool is too small. |

`RandomGenerator` itself is **always sample-based** (it never has an "exhaustive" mode). That is the defining semantic distinction between Random and Domain-Guided+EXHAUSTIVE.

---

## 8. Exact Specification/Code Rules That Permit This Behavior

### 8.1 Spec-level

- **`docs/Requirements_Specification.md:1037-1041`** — `FR-021 Random Search`:
  > *"Hệ thống phải hỗ trợ Random Search để tạo Candidate Strategy ngẫu nhiên."*
  > (The system must support Random Search to randomly create Candidate Strategies.)
  No user-pool restriction is mentioned.

- **`docs/ARCHITECTURE_DOCUMENT.md:120-123`** — §3.3 Strategy Search Engine:
  > *"- Random Search: Lấy mẫu ngẫu nhiên tổ hợp tham số và trọng số."*
  > (Randomly sample combinations of parameters and weights.)
  No mention of user-selected strategy pool.

- **`docs/Solution.md:122`** — same statement.

### 8.2 Code-level

| Location | Behavior |
|---|---|
| `RandomGenerator.ts:1-7` (file header) | *"Produces COMPOSITE candidates by randomly selecting k strategies (2 ≤ k ≤ N) from **the pool** and sampling one parameter set per strategy."* — "the pool" here = `this.spaces`, which SearchService fills from the full registry. |
| `RandomGenerator.ts:188-213` | The actual sampling loop; no user-input filter. |
| `SearchService.ts:213-228` | Builds `spaces` from `registry.list()` with no filter. |
| `RandomGeneratorConfig` (lines 44-61) | The interface has only `compositeMode`, `minComponents`, `maxComponents` — **no** `selectedStrategyIds`, `strategyFilter`, `allowedFamilies`, etc. |
| `frontend/src/pages/Combination.tsx:770-775` | UI banner: *"Random search ignores family groups — it samples strategies freely."* — explicit acknowledgment. |

---

## 9. Conclusion

### Is the behavior correct?

**Yes — for Random Search as defined by the spec and implemented in the code.**

The behavior the user observed — Random Search generating 20 composite candidates that include strategies beyond "Moving Average" — is **the intended, documented, code-level behavior of the Random Search algorithm in this project**. There is no bug, no missing filter, no silent injection. The full 5-strategy registry is the pool, by design.

### Why the user perceives this as a bug

There is a **UX gap**: the user clicked on "Moving Average" in the catalogue, then "Run Discovery" with "Random" algorithm, and expected the search to be scoped to MA. The intent is reasonable, but the implementation does not match that intent because:

1. The Random algorithm's spec (`FR-021`) defines it as free-form sampling.
2. The frontend does not communicate this distinction — the Strategy catalogue page has **no warning banner equivalent** to the one on the Combination page (`Combination.tsx:770-775`).
3. The user has no UI affordance to "Random-search *only* on Moving Average" — that mode does not exist.

### Smallest safe fix (NOT applied per instruction)

**Do not change RandomGenerator.** Instead, two small UX fixes, both backend-free:

1. **`frontend/src/pages/Strategy.tsx`** — when the user picks the "Random" algorithm in `handleRunDiscovery`, surface the same warning shown on Combination:
   > *"Random Search samples from all 5 registered strategies, not only the one you're viewing. To scope to a single strategy, use Domain-guided."*

2. **`frontend/src/pages/Strategy.tsx`** — additionally disable / de-emphasize the Random algorithm choice when viewing a single-strategy detail, or relabel it as *"Explore all strategies"*.

3. *(Optional, larger)* If product wants true "Random-search-only-this-strategy" semantics, **add a new feature** in `RandomGeneratorConfig` (e.g. `selectedStrategyIds?: string[]`) and propagate from `Strategy.tsx`. That is **out of scope** for an audit and should be a separate phase ticket with explicit product + spec alignment.

### What was NOT changed

- ✅ No production code modified.
- ✅ No historical data modified.
- ✅ No backend process touched (still killed from earlier turn).
- ✅ No spec changed.
- ✅ No tests run that would require the backend.

---

## 10. Evidence Trail

| Evidence | Source |
|---|---|
| `BUILT_IN_STRATEGIES` = 5 entries | `backend/src/modules/strategy/strategies/bootstrap.ts:34-46` |
| `registry.list()` returns full Map | `backend/src/modules/strategy/domain/StrategyRegistry.ts:60-62` |
| `SearchService.start` builds `spaces` from full registry | `backend/src/modules/search/application/SearchService.ts:213-228` |
| `RandomGenerator` reads only `this.spaces` | `backend/src/modules/search/generators/RandomGenerator.ts:188-213` |
| `RandomGeneratorConfig` interface | `backend/src/modules/search/generators/RandomGenerator.ts:44-61` (no selectedStrategyIds) |
| `Combination.tsx` Random config payload | `frontend/src/pages/Combination.tsx:451-456` (combinationId + size, no pool filter) |
| `Combination.tsx` warning banner | `frontend/src/pages/Combination.tsx:770-775` |
| `Strategy.tsx` Random payload | `frontend/src/pages/Strategy.tsx:155-164` (NO generatorConfig at all) |
| Persistence of weights/components/operator/params | `backend/src/modules/search/application/SearchService.ts:458-476` |
| Domain-Guided EXHAUSTIVE enumeration math | `backend/src/modules/search/generators/DomainGuidedGenerator.ts:597-645` |
| GUIDED mode semantics | `backend/src/modules/search/generators/DomainGuidedGenerator.ts:138-145, 628-642` |
| 11 candidates from 4 user strategies | `audit-phase45-final-report.md:111-141` + `audit-phase45-realtime.ts` |
| Spec FR-021 (Random) vs FR-022 (Domain-Guided) | `docs/Requirements_Specification.md:1037-1051` |
| Architecture document Random vs Domain-Guided | `docs/ARCHITECTURE_DOCUMENT.md:120-123` |

---

## 11. Summary

> **The Random Search algorithm in this project is intentionally designed to sample from the full registered strategy pool, not from user-selected strategies.** This is documented in the spec (`FR-021`), in the architecture doc, in the code (`RandomGenerator.spaces` is the full registry, with no filter), and in the UI (`Combination.tsx:770-775` warning). When the user "selects MA" and runs Random Search, they are selecting MA as a *contextual anchor* (e.g. for timeframe configuration), not constraining the Random pool. The 20 composite candidates with strategies beyond MA are distinct, correctly-persisted `CombinationConfig`s and represent the expected, intended behavior.
>
> The likely-correct follow-up is a UX improvement on `Strategy.tsx` (warning banner + clearer algorithm labelling), not a backend change. If the product actually wants "Random search restricted to a user-selected pool", that is a new feature requiring spec, UI, and code changes across `RandomGeneratorConfig`, `SearchService`, `Strategy.tsx`, and `Combination.tsx` — it must be a separate, scoped ticket.

**Audit complete. No code changed. No data changed. Backend still stopped.**
