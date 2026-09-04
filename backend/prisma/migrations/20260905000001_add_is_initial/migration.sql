-- Migration: add_is_initial
-- Created: 2026-09-05
-- Purpose: Phase 3 — add is_initial flag to loop_iterations so the
-- runner can distinguish the initial Run Combination SearchRun from
-- subsequent loop-generated iterations.

ALTER TABLE "loop_iterations"
  ADD COLUMN IF NOT EXISTS "is_initial" boolean NOT NULL DEFAULT false;

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
