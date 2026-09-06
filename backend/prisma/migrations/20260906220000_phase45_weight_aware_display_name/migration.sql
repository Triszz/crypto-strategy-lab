-- Phase 4.5: add weight-aware display label for COMPOSITE StrategyVersions.
-- Distinct from `name` (Phase 3.4 stable family label) so two SVs with
-- identical components but different weights can be told apart in the UI.

ALTER TABLE strategy_versions
ADD COLUMN IF NOT EXISTS display_name_with_weights VARCHAR(512);

-- Backfill: compute weight-aware labels for all COMPOSITE StrategyVersions that
-- currently have NULL. This is a one-shot demo-stabilization backfill; it does
-- NOT modify historical composite components, only the display label.
-- (Implementation lives in TS / runtime path; the SQL is intentionally simple.)
