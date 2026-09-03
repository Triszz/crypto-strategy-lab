-- Migration: add_saved_combinations
-- Created: 2026-09-03
-- Purpose: Create the saved_combinations table for Strategy Combination persistence.

-- ── Enum: CombinationOperator ────────────────────────────────────────────────
-- (created with PascalCase name to match what the Prisma client expects
--  when it serializes/deserializes enum values.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'CombinationOperator'
  ) THEN
    CREATE TYPE "CombinationOperator" AS ENUM ('AND', 'OR', 'MAJORITY_VOTE', 'WEIGHTED');
  END IF;
END
$$;

-- ── Table: saved_combinations ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "saved_combinations" (
  "id"          uuid         NOT NULL  DEFAULT gen_random_uuid(),
  "name"        varchar(255) NOT NULL,
  "description" varchar(1000),
  "operator"   "CombinationOperator" NOT NULL DEFAULT 'WEIGHTED',
  -- JSON array of CombinationComponent objects.
  --   { strategyId: string, weight: number, position: number, parameters?: {...} }
  "components"  json         NOT NULL  DEFAULT '[]',
  "tags"        text[]       NOT NULL  DEFAULT '{}',
  "owner_id"    varchar(64),
  "created_at"  timestamptz  NOT NULL  DEFAULT now(),
  "updated_at"  timestamptz  NOT NULL  DEFAULT now(),

  CONSTRAINT "saved_combinations_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "saved_combinations_owner_id_created_at_idx"
  ON "saved_combinations" ("owner_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "saved_combinations_created_at_idx"
  ON "saved_combinations" ("created_at" DESC);
