-- Migration: loop_iteration_correctness
-- Created: 2026-09-05
-- Purpose: Phase 3 — bring Continuous Strategy Loop into line with the spec
-- (1 SearchRun = 1 iteration; loop-local best strategy; no cross-loop
-- pollution; hybrid candidate generation).
--
-- Adds per-iteration evaluation tracking to `loop_iterations`, real
-- `max_iterations` + `candidate_count_per_iteration` + hybrid ratios to
-- `loop_run_states`, loop-local best strategy attribution, and an
-- `in_flight_search_run_id` so the orchestrator can ignore spurious
-- `NewTopStrategyFound` events while a SearchRun is still running.

-- ── Extend loop_run_states ──────────────────────────────────────────────────

ALTER TABLE "loop_run_states"
  ADD COLUMN IF NOT EXISTS "max_iterations"                  integer     NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "candidate_count_per_iteration"   integer     NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "mutation_ratio"                  decimal(4,3) NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS "crossover_ratio"                 decimal(4,3) NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS "exploration_ratio"               decimal(4,3) NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS "elite_pool_size"                 integer     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "best_strategy_version_id"        uuid,
  ADD COLUMN IF NOT EXISTS "best_strategy_symbol_id"         uuid,
  ADD COLUMN IF NOT EXISTS "best_strategy_timeframe"         varchar(8),
  ADD COLUMN IF NOT EXISTS "best_total_return"               decimal(10,4),
  ADD COLUMN IF NOT EXISTS "best_win_rate"                   decimal(6,4),
  ADD COLUMN IF NOT EXISTS "stop_reason"                     varchar(64),
  ADD COLUMN IF NOT EXISTS "initial_parent_strategy_version_id" uuid,
  ADD COLUMN IF NOT EXISTS "in_flight_search_run_id"         uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loop_run_states_best_strategy_version_id_fkey'
  ) THEN
    ALTER TABLE "loop_run_states"
      ADD CONSTRAINT "loop_run_states_best_strategy_version_id_fkey"
      FOREIGN KEY ("best_strategy_version_id") REFERENCES "strategy_versions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loop_run_states_best_strategy_symbol_id_fkey'
  ) THEN
    ALTER TABLE "loop_run_states"
      ADD CONSTRAINT "loop_run_states_best_strategy_symbol_id_fkey"
      FOREIGN KEY ("best_strategy_symbol_id") REFERENCES "symbols"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "loop_run_states_status_updated_at_idx"
  ON "loop_run_states" ("status", "updated_at" DESC);

-- ── Extend loop_iterations ──────────────────────────────────────────────────

ALTER TABLE "loop_iterations"
  ADD COLUMN IF NOT EXISTS "evaluated_count"          integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "best_score_in_iteration"  decimal(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "best_strategy_version_id" uuid,
  ADD COLUMN IF NOT EXISTS "completed_at"             timestamptz,
  ADD COLUMN IF NOT EXISTS "is_initial"               boolean    NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loop_iterations_best_strategy_version_id_fkey'
  ) THEN
    ALTER TABLE "loop_iterations"
      ADD CONSTRAINT "loop_iterations_best_strategy_version_id_fkey"
      FOREIGN KEY ("best_strategy_version_id") REFERENCES "strategy_versions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "loop_iterations_search_run_id_idx"
  ON "loop_iterations" ("search_run_id");
