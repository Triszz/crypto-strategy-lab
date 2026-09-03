-- Migration: add_loop_iteration_tracking
-- Created: 2026-09-04
-- Purpose: extend LoopRunState + add LoopIteration + LoopProcessedEvent so the
-- Continuous Strategy Loop can:
--   - track per-iteration metadata (which parent produced which SearchRun),
--   - dedupe duplicate NewTopStrategyFound events on application restart.

-- ── Extend loop_run_states ──────────────────────────────────────────────────

ALTER TABLE "loop_run_states"
  ADD COLUMN IF NOT EXISTS "current_iteration"            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_iteration_search_run_id" uuid;

-- ── Create loop_iterations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "loop_iterations" (
  "id"                         uuid         NOT NULL DEFAULT gen_random_uuid(),
  "loop_id"                    varchar(64)  NOT NULL,
  "iteration_index"            integer      NOT NULL,
  "parent_strategy_version_id" uuid         NOT NULL,
  "search_run_id"              uuid,
  "candidate_count"            integer      NOT NULL DEFAULT 0,
  "status"                     varchar(32)  NOT NULL DEFAULT 'DONE',
  "created_at"                 timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT "loop_iterations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loop_iterations_loop_id_fkey"
    FOREIGN KEY ("loop_id") REFERENCES "loop_run_states"("loop_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "loop_iterations_loop_id_iteration_index_idx"
  ON "loop_iterations" ("loop_id", "iteration_index" DESC);

-- ── Create loop_processed_events ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "loop_processed_events" (
  "id"                     uuid         NOT NULL DEFAULT gen_random_uuid(),
  "dedupe_key"             varchar(255) NOT NULL,
  "strategy_version_id"    uuid         NOT NULL,
  "overall_score"          decimal(10,4) NOT NULL,
  "evaluated_at"           timestamptz  NOT NULL,
  "loop_id"                varchar(64),
  "created_at"             timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT "loop_processed_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loop_processed_events_dedupe_key_key" UNIQUE ("dedupe_key"),
  CONSTRAINT "loop_processed_events_loop_id_fkey"
    FOREIGN KEY ("loop_id") REFERENCES "loop_run_states"("loop_id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "loop_processed_events_loop_id_created_at_idx"
  ON "loop_processed_events" ("loop_id", "created_at" DESC);
