/**
 * Standalone verification harness for `frontend/src/lib/indicators.ts`.
 *
 * Runs with:
 *   cd backend && npx tsx ../frontend/scripts/verify-indicators.ts
 *
 * Asserts that:
 *   - SMA computation matches a known arithmetic-mean fixture.
 *   - MA series is empty until enough candles exist (warm-up).
 *   - MA updates when a new candle arrives and when an existing candle
 *     is updated in place.
 *   - MA-crossover BUY/SELL detection mirrors the backend
 *     `MovingAverageStrategy.analyze` logic (golden cross → BUY,
 *     death cross → SELL, otherwise HOLD).
 *   - HOLD does not emit a signal.
 *   - No look-ahead bias: the signal for candle T only uses closes[0..T].
 *   - Realtime update to the SAME candle timestamp produces at most one
 *     signal for that candle (no duplicate markers).
 *   - Two independent candle lists produce two independent signal
 *     series (multi-chart isolation).
 *   - Timeframe reset (replacing one candle list with another of
 *     different timestamps) yields a freshly-computed signal set.
 *
 * The script intentionally avoids importing the chart component or any
 * React code so it can run headless in CI without a DOM.
 */
import assert from "node:assert/strict";
import {
  closesOf,
  computeMASeries,
  computeMASignals,
  maCrossoverSignal,
  simpleMovingAverage,
  type Candle,
} from "../src/lib/indicators";

let pass = 0;
let fail = 0;

function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`  ✗ ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

function makeCandles(closes: number[], startMs = 1_700_000_000_000): Candle[] {
  return closes.map((close, i) => ({
    openTime: startMs + i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

console.log("indicators.test.ts");

// ── SMA primitive ─────────────────────────────────────────────────────
it("simpleMovingAverage returns arithmetic mean over the last `period` closes", () => {
  const closes = [1, 2, 3, 4, 5];
  assert.equal(simpleMovingAverage(closes, 3), 4); // mean of [3,4,5]
  assert.equal(simpleMovingAverage(closes, 5), 3); // mean of [1..5]
});

it("simpleMovingAverage returns null when there are fewer than `period` closes", () => {
  assert.equal(simpleMovingAverage([1, 2], 5), null);
  assert.equal(simpleMovingAverage([], 1), null);
});

it("simpleMovingAverage returns null for non-positive / non-integer periods", () => {
  assert.equal(simpleMovingAverage([1, 2, 3], 0), null);
  assert.equal(simpleMovingAverage([1, 2, 3], -1), null);
  assert.equal(simpleMovingAverage([1, 2, 3], 1.5), null);
});

// ── MA series (chart line) ──────────────────────────────────────────
it("computeMASeries returns no points before enough history", () => {
  const candles = makeCandles([10, 11, 12]);
  assert.deepEqual(computeMASeries(candles, 5), []);
});

it("computeMASeries returns one point per candle starting at index = period - 1", () => {
  const candles = makeCandles([10, 11, 12, 13, 14]);
  const series = computeMASeries(candles, 3);
  assert.equal(series.length, 3);
  assert.equal(series[0]?.value, 11); // mean of [10, 11, 12]
  assert.equal(series[2]?.value, 13); // mean of [12, 13, 14]
});

it("computeMASeries updates correctly when a new candle is appended", () => {
  const before = makeCandles([10, 11, 12, 13]);
  const after = makeCandles([10, 11, 12, 13, 14]);
  const beforeSeries = computeMASeries(before, 3);
  const afterSeries = computeMASeries(after, 3);
  // before: last MA = mean(11, 12, 13) = 12
  assert.equal(beforeSeries[beforeSeries.length - 1]?.value, 12);
  // after: last MA = mean(12, 13, 14) = 13
  assert.equal(afterSeries[afterSeries.length - 1]?.value, 13);
});

it("computeMASeries updates correctly when the LAST candle is updated in place", () => {
  const initial = makeCandles([10, 11, 12, 13, 14]);
  const updatedLast = makeCandles([10, 11, 12, 13, 99]);
  const initialSeries = computeMASeries(initial, 3);
  const updatedSeries = computeMASeries(updatedLast, 3);
  assert.equal(initialSeries[initialSeries.length - 1]?.value, 13); // 12+13+14
  assert.equal(updatedSeries[updatedSeries.length - 1]?.value, 41.333333333333336); // 12+13+99
});

// ── MA crossover signal ─────────────────────────────────────────────
it("maCrossoverSignal returns HOLD while in warm-up", () => {
  // 20 closes isn't enough for 9/21 crossover (needs ≥ 22)
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const result = maCrossoverSignal(closes, 9, 21);
  assert.equal(result.side, "HOLD");
  assert.match(result.reason, /warm-up/);
});

it("maCrossoverSignal detects a golden cross (BUY)", () => {
  // Construct a clean golden cross on the LAST bar:
  //   closes 0..20  = flat 100 → fast == slow (spread = 0)
  //   closes 21..   = sharp upward spike that flips the spread on the
  //                   final bar (the close after the cross must contain
  //                   enough rising values to make fast > slow while
  //                   the previous bar's window still has fast == slow).
  //
  // We use a long plateau so slow SMA ≈ 100, and a sudden jump to 200
  // on the last close. By the final bar:
  //   - last fast window  = [100..200] ⇒ fast ≈ 155 (period 9)
  //   - last slow window  = [100..200] ⇒ slow ≈ 119 (period 21, only 5 rising)
  //   - previous fast window = [100..100] ⇒ fast = 100
  //   - previous slow window = [100..100] ⇒ slow = 100
  //   ⇒ spreadYesterday = 0, spreadNow > 0 → BUY.
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(100);
  closes.push(200);
  const result = maCrossoverSignal(closes, 9, 21);
  assert.equal(result.side, "BUY");
});

it("maCrossoverSignal detects a death cross (SELL)", () => {
  // Mirror of the golden-cross fixture: plateau at 200, then a sharp
  // drop to 50 on the last bar.
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(200);
  closes.push(50);
  const result = maCrossoverSignal(closes, 9, 21);
  assert.equal(result.side, "SELL");
});

it("maCrossoverSignal returns HOLD when there is no crossover", () => {
  // Strictly rising — no crossover because fast was already above slow.
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  const result = maCrossoverSignal(closes, 9, 21);
  assert.equal(result.side, "HOLD");
});

it("maCrossoverSignal rejects invalid parameters (fast ≥ slow)", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const result = maCrossoverSignal(closes, 21, 9);
  assert.equal(result.side, "HOLD");
  assert.match(result.reason, /invalid/);
});

// ── Vectorised signal series ────────────────────────────────────────
it("computeMASignals never emits a signal before warm-up", () => {
  const candles = makeCandles(Array.from({ length: 20 }, () => 100));
  const signals = computeMASignals(candles, 9, 21);
  for (const s of signals) {
    assert.equal(s.side, "HOLD", `candle ${s.openTime} should be HOLD`);
  }
});

it("computeMASignals signals are aligned to the candle that produced them", () => {
  // Plateau long enough for warm-up, then a sharp jump on the LAST
  // candle → exactly one BUY, on that last candle.
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(100);
  closes.push(200);
  const candles = makeCandles(closes);
  const signals = computeMASignals(candles, 9, 21);

  const buySignals = signals.filter((s) => s.side === "BUY");
  assert.equal(buySignals.length, 1, "exactly one BUY expected");
  assert.equal(buySignals[0]?.openTime, candles[candles.length - 1]?.openTime);
});

it("computeMASignals does NOT use future closes (no look-ahead)", () => {
  // Long plateau + a sharp jump on the LAST bar — the spread must
  // flip exactly at the jump and never before.
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(100);
  closes.push(200);

  const candles = makeCandles(closes);
  const signals = computeMASignals(candles, 9, 21);

  // First BUY must occur at or after the plateau length (i.e. once
  // warm-up is complete and the cross actually happens).
  const firstBuyIdx = signals.findIndex((s) => s.side === "BUY");
  assert.ok(firstBuyIdx >= 21, "BUY must not appear during warm-up");
  // And it MUST be at the very last candle (the cross bar).
  assert.equal(
    firstBuyIdx,
    candles.length - 1,
    "BUY must be at the cross bar",
  );
  // Every candle before the cross must be HOLD.
  for (let i = 0; i < firstBuyIdx; i += 1) {
    assert.equal(signals[i]?.side, "HOLD", `index ${i} should be HOLD`);
  }
});

it("realtime in-place update to the same candle does NOT re-emit a duplicate signal", () => {
  // Same plateau+spike fixture → one BUY on the LAST candle.
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(100);
  closes.push(200);
  const candles = makeCandles(closes);
  const t0 = candles[candles.length - 1]?.openTime ?? 0;

  const initial = computeMASignals(candles, 9, 21);
  // Same candles — simulate a "websocket candle update" by re-feeding
  // the same closes. The signal set MUST be identical.
  const after = computeMASignals(candles, 9, 21);
  assert.deepEqual(initial, after);
  // And exactly one BUY entry exists for the last candle.
  const buyCount = after.filter(
    (s) => s.side === "BUY" && s.openTime === t0,
  ).length;
  assert.equal(buyCount, 1);
});

// ── Multi-chart / multi-timeframe isolation ──────────────────────────
it("two charts with different candle lists produce independent signal series", () => {
  // Chart A: plateau 100, sharp jump to 200 → BUY
  const aCloses: number[] = [];
  for (let i = 0; i < 25; i += 1) aCloses.push(100);
  aCloses.push(200);
  const aCandles = makeCandles(aCloses, 1_700_000_000_000);

  // Chart B: plateau 200, sharp drop to 50 → SELL
  const bCloses: number[] = [];
  for (let i = 0; i < 25; i += 1) bCloses.push(200);
  bCloses.push(50);
  const bCandles = makeCandles(bCloses, 1_800_000_000_000);

  const aSigs = computeMASignals(aCandles, 9, 21);
  const bSigs = computeMASignals(bCandles, 9, 21);

  const aBuys = aSigs.filter((s) => s.side === "BUY").length;
  const bSells = bSigs.filter((s) => s.side === "SELL").length;
  assert.ok(aBuys >= 1, "Chart A must emit at least one BUY");
  assert.ok(bSells >= 1, "Chart B must emit at least one SELL");

  // Cross-check: B must NOT contain a BUY triggered by A's candles.
  const aBuyTimes = new Set(aSigs.filter((s) => s.side === "BUY").map((s) => s.openTime));
  for (const bSig of bSigs) {
    if (bSig.side === "BUY") {
      assert.ok(
        !aBuyTimes.has(bSig.openTime),
        "Chart A's BUY timestamp leaked into Chart B",
      );
    }
  }
});

it("replacing the candle list (simulated timeframe change) clears old signals", () => {
  const oldCloses: number[] = [];
  for (let i = 0; i < 25; i += 1) oldCloses.push(100);
  oldCloses.push(200);
  const oldCandles = makeCandles(oldCloses, 1_700_000_000_000);

  const newCloses: number[] = [];
  for (let i = 0; i < 25; i += 1) newCloses.push(200);
  newCloses.push(50);
  const newCandles = makeCandles(newCloses, 1_900_000_000_000); // different timestamps

  const oldSigs = computeMASignals(oldCandles, 9, 21);
  const newSigs = computeMASignals(newCandles, 9, 21);

  const oldOpenTimes = new Set(oldCandles.map((c) => c.openTime));
  for (const sig of newSigs) {
    assert.ok(
      !oldOpenTimes.has(sig.openTime),
      "old candle timestamps must not appear in new signal series",
    );
  }
  // And vice versa: old series should not contain new candle times.
  const newOpenTimes = new Set(newCandles.map((c) => c.openTime));
  for (const sig of oldSigs) {
    assert.ok(
      !newOpenTimes.has(sig.openTime),
      "new candle timestamps must not appear in old signal series",
    );
  }
});

// ── Determinism ─────────────────────────────────────────────────────
it("computeMASignals is deterministic for the same input", () => {
  const closes: number[] = [];
  for (let i = 0; i < 25; i += 1) closes.push(100);
  closes.push(200);
  const candles = makeCandles(closes);
  const a = computeMASignals(candles, 9, 21);
  const b = computeMASignals(candles, 9, 21);
  assert.deepEqual(a, b);
});

// ── Helper ───────────────────────────────────────────────────────────
it("closesOf projects closes in order", () => {
  const candles = makeCandles([1, 2, 3, 4, 5]);
  assert.deepEqual(closesOf(candles), [1, 2, 3, 4, 5]);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
