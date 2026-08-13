-- CreateEnum
CREATE TYPE "strategy_type" AS ENUM ('BASE', 'COMPOSITE');

-- CreateEnum
CREATE TYPE "strategy_family" AS ENUM ('TREND', 'MOMENTUM', 'STRUCTURE', 'VOLATILITY', 'SENTIMENT');

-- CreateEnum
CREATE TYPE "sentiment_class" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "position_type" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "trade_side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "experiment_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "candidate_status" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "search_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "log_level" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "worker_status" AS ENUM ('IDLE', 'BUSY', 'OFFLINE', 'ERROR');

-- CreateTable
CREATE TABLE "market_data_providers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "base_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symbols" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "base_asset" VARCHAR(16) NOT NULL,
    "quote_asset" VARCHAR(16) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "symbols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candles" (
    "id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "timeframe" VARCHAR(8) NOT NULL,
    "open_time" BIGINT NOT NULL,
    "close_time" BIGINT NOT NULL,
    "open" DECIMAL(24,10) NOT NULL,
    "high" DECIMAL(24,10) NOT NULL,
    "low" DECIMAL(24,10) NOT NULL,
    "close" DECIMAL(24,10) NOT NULL,
    "volume" DECIMAL(32,10) NOT NULL,
    "quote_volume" DECIMAL(32,10) NOT NULL,
    "trades" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" "strategy_family" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_definitions" (
    "id" UUID NOT NULL,
    "type" "strategy_type" NOT NULL,
    "family" "strategy_family" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "indicator_type_id" UUID,
    "implementation_ref" VARCHAR(255) NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composite_components" (
    "composite_version_id" UUID NOT NULL,
    "component_version_id" UUID NOT NULL,
    "weight" DECIMAL(6,4) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "composite_components_pkey" PRIMARY KEY ("composite_version_id","component_version_id")
);

-- CreateTable
CREATE TABLE "strategy_registry" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "strategy_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_algorithms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "implementation_ref" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_algorithms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_runs" (
    "id" UUID NOT NULL,
    "algorithm_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "timeframe" VARCHAR(8) NOT NULL,
    "max_candidates" INTEGER NOT NULL,
    "from_time" BIGINT,
    "to_time" BIGINT,
    "status" "search_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_by" VARCHAR(64),
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_strategies" (
    "id" UUID NOT NULL,
    "search_run_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "candidate_status" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "symbol_id" UUID NOT NULL,
    "timeframe" VARCHAR(8) NOT NULL,
    "from_time" BIGINT NOT NULL,
    "to_time" BIGINT NOT NULL,
    "initial_capital" DECIMAL(24,8) NOT NULL DEFAULT 10000,
    "position_size" DECIMAL(24,8) NOT NULL,
    "position_type" "position_type" NOT NULL DEFAULT 'LONG',
    "status" "experiment_status" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_results" (
    "id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "timeframe" VARCHAR(8) NOT NULL,
    "from_time" BIGINT NOT NULL,
    "to_time" BIGINT NOT NULL,
    "initial_capital" DECIMAL(24,8) NOT NULL,
    "final_capital" DECIMAL(24,8) NOT NULL,
    "total_return" DECIMAL(10,4) NOT NULL,
    "annual_return" DECIMAL(10,4),
    "win_rate" DECIMAL(6,4) NOT NULL,
    "max_drawdown" DECIMAL(10,4) NOT NULL,
    "num_trades" INTEGER NOT NULL,
    "num_winning_trades" INTEGER NOT NULL,
    "num_losing_trades" INTEGER NOT NULL,
    "sharpe_ratio" DECIMAL(10,4),
    "sortino_ratio" DECIMAL(10,4),
    "overall_score" DECIMAL(10,4) NOT NULL,
    "equity_curve" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_metrics" (
    "id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "metric_code" VARCHAR(64) NOT NULL,
    "metric_value" DECIMAL(20,8) NOT NULL,
    "metric_group" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" UUID NOT NULL,
    "experiment_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "side" "trade_side" NOT NULL,
    "position" "position_type" NOT NULL,
    "entry_time" BIGINT NOT NULL,
    "entry_price" DECIMAL(24,10) NOT NULL,
    "exit_time" BIGINT,
    "exit_price" DECIMAL(24,10),
    "quantity" DECIMAL(24,10) NOT NULL,
    "profit_loss" DECIMAL(24,8),
    "profit_loss_pct" DECIMAL(10,4),
    "entry_reason" TEXT,
    "exit_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "timeframe" VARCHAR(8) NOT NULL,
    "total_return" DECIMAL(10,4) NOT NULL,
    "win_rate" DECIMAL(6,4) NOT NULL,
    "max_drawdown" DECIMAL(10,4) NOT NULL,
    "num_trades" INTEGER NOT NULL,
    "overall_score" DECIMAL(10,4) NOT NULL,
    "rank" INTEGER NOT NULL,
    "last_evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_history" (
    "id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "overall_score" DECIMAL(10,4) NOT NULL,
    "snapshot_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataset_label" VARCHAR(64),

    CONSTRAINT "ranking_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_providers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "base_url" TEXT NOT NULL,
    "requires_api_key" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "url" TEXT NOT NULL,
    "source" VARCHAR(255) NOT NULL,
    "author" VARCHAR(255),
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "crawled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_coins" (
    "news_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,

    CONSTRAINT "news_coins_pkey" PRIMARY KEY ("news_id","symbol_id")
);

-- CreateTable
CREATE TABLE "sentiment_providers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "model_version" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiments" (
    "id" UUID NOT NULL,
    "news_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "classification" "sentiment_class" NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "confidence" DECIMAL(4,3),
    "analyzed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" UUID NOT NULL,
    "job_id" VARCHAR(64) NOT NULL,
    "queue_name" VARCHAR(64) NOT NULL,
    "job_type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(32) NOT NULL DEFAULT 'WAITING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_statuses" (
    "id" UUID NOT NULL,
    "worker_id" VARCHAR(64) NOT NULL,
    "host" VARCHAR(255),
    "status" "worker_status" NOT NULL DEFAULT 'IDLE',
    "current_job_id" UUID,
    "last_heartbeat" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_processed" INTEGER NOT NULL DEFAULT 0,
    "total_failed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL,
    "level" "log_level" NOT NULL,
    "source_module" VARCHAR(64) NOT NULL,
    "event_code" VARCHAR(64),
    "message" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_data_providers_code_key" ON "market_data_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "symbols_provider_id_symbol_key" ON "symbols"("provider_id", "symbol");

-- CreateIndex
CREATE INDEX "candles_symbol_id_timeframe_open_time_idx" ON "candles"("symbol_id", "timeframe", "open_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "candles_symbol_id_timeframe_open_time_key" ON "candles"("symbol_id", "timeframe", "open_time");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_types_code_key" ON "indicator_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_definition_id_version_key" ON "strategy_versions"("definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_registry_definition_id_key" ON "strategy_registry"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "search_algorithms_code_key" ON "search_algorithms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "backtest_results_experiment_id_key" ON "backtest_results"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_metrics_experiment_id_metric_code_key" ON "evaluation_metrics"("experiment_id", "metric_code");

-- CreateIndex
CREATE INDEX "trades_experiment_id_entry_time_idx" ON "trades"("experiment_id", "entry_time");

-- CreateIndex
CREATE INDEX "leaderboard_entries_overall_score_idx" ON "leaderboard_entries"("overall_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_entries_strategy_version_id_symbol_id_timeframe_key" ON "leaderboard_entries"("strategy_version_id", "symbol_id", "timeframe");

-- CreateIndex
CREATE INDEX "ranking_history_strategy_version_id_snapshot_at_idx" ON "ranking_history"("strategy_version_id", "snapshot_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_history_strategy_version_id_snapshot_at_key" ON "ranking_history"("strategy_version_id", "snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_providers_code_key" ON "news_providers"("code");

-- CreateIndex
CREATE INDEX "news_published_at_idx" ON "news"("published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "news_provider_id_external_id_key" ON "news"("provider_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sentiment_providers_code_key" ON "sentiment_providers"("code");

-- CreateIndex
CREATE INDEX "sentiments_classification_idx" ON "sentiments"("classification");

-- CreateIndex
CREATE UNIQUE INDEX "sentiments_news_id_provider_id_key" ON "sentiments"("news_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_jobs_job_id_key" ON "queue_jobs"("job_id");

-- CreateIndex
CREATE INDEX "queue_jobs_status_queue_name_idx" ON "queue_jobs"("status", "queue_name");

-- CreateIndex
CREATE UNIQUE INDEX "worker_statuses_worker_id_key" ON "worker_statuses"("worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_statuses_current_job_id_key" ON "worker_statuses"("current_job_id");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at" DESC);

-- CreateIndex
CREATE INDEX "system_logs_source_module_created_at_idx" ON "system_logs"("source_module", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "market_data_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candles" ADD CONSTRAINT "candles_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "strategy_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_indicator_type_id_fkey" FOREIGN KEY ("indicator_type_id") REFERENCES "indicator_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composite_components" ADD CONSTRAINT "composite_components_composite_version_id_fkey" FOREIGN KEY ("composite_version_id") REFERENCES "strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composite_components" ADD CONSTRAINT "composite_components_component_version_id_fkey" FOREIGN KEY ("component_version_id") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_registry" ADD CONSTRAINT "strategy_registry_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "strategy_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_algorithm_id_fkey" FOREIGN KEY ("algorithm_id") REFERENCES "search_algorithms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_strategies" ADD CONSTRAINT "candidate_strategies_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_strategies" ADD CONSTRAINT "candidate_strategies_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_metrics" ADD CONSTRAINT "evaluation_metrics_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_history" ADD CONSTRAINT "ranking_history_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "news_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_coins" ADD CONSTRAINT "news_coins_news_id_fkey" FOREIGN KEY ("news_id") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_coins" ADD CONSTRAINT "news_coins_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentiments" ADD CONSTRAINT "sentiments_news_id_fkey" FOREIGN KEY ("news_id") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sentiments" ADD CONSTRAINT "sentiments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sentiment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_statuses" ADD CONSTRAINT "worker_statuses_current_job_id_fkey" FOREIGN KEY ("current_job_id") REFERENCES "queue_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- POSTGRESQL EXTENSIONS
-- ============================================================
-- Per docs/Database.md § EXTENSIONS.
--  - uuid-ossp: enables uuid_generate_v4() (compatibility).
--  - pgcrypto:   enables gen_random_uuid(), crypt(), etc.
--  - btree_gin:  enables composite GIN indexes over scalar columns.
-- Note: UUID generation is performed at the application layer via
-- Prisma's @default(uuid()). These extensions are included for
-- general database capability, not as a second UUID default source.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================
-- MISSING SECONDARY INDEXES
-- ============================================================
-- Prisma cannot emit indexes that are not declared in schema.prisma.
-- These indexes are documented in docs/Database.md § Index Summary.

-- candles: global time-window scans
CREATE INDEX "candles_open_time_idx" ON "candles" ("open_time" DESC);

-- leaderboard_entries: filtered leaderboard queries
CREATE INDEX "leaderboard_entries_symbol_id_timeframe_overall_score_idx"
  ON "leaderboard_entries" ("symbol_id", "timeframe", "overall_score" DESC);

-- news: provider-scoped news feed
CREATE INDEX "news_provider_id_published_at_idx"
  ON "news" ("provider_id", "published_at" DESC);

-- queue_jobs: scheduled job scans
CREATE INDEX "queue_jobs_scheduled_at_idx" ON "queue_jobs" ("scheduled_at");

-- sentiments: news-keyed lookups
CREATE INDEX "sentiments_news_id_idx" ON "sentiments" ("news_id");

-- ============================================================
-- CHECK CONSTRAINTS
-- ============================================================
-- Prisma cannot express PostgreSQL CHECK constraints. These are
-- documented in docs/Database.md and enforced at the database layer
-- for defense in depth.

-- candles: OHLC integrity
ALTER TABLE "candles"
  ADD CONSTRAINT "candles_ohlc_check"
  CHECK ("low" <= "open" AND "low" <= "close" AND "high" >= "open" AND "high" >= "close");

-- candles: timeframe allow-list
ALTER TABLE "candles"
  ADD CONSTRAINT "candles_tf_check"
  CHECK ("timeframe" IN ('1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'));

-- composite_components: weight range [0, 1]
ALTER TABLE "composite_components"
  ADD CONSTRAINT "composite_components_weight_check"
  CHECK ("weight" >= 0 AND "weight" <= 1);

-- search_runs: max_candidates must be positive
ALTER TABLE "search_runs"
  ADD CONSTRAINT "search_runs_max_candidates_check"
  CHECK ("max_candidates" > 0);

-- experiments: time window sanity
ALTER TABLE "experiments"
  ADD CONSTRAINT "experiments_timecheck"
  CHECK ("from_time" < "to_time");

-- trades: exit must be after entry when present
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_exit_after_entry"
  CHECK ("exit_time" IS NULL OR "exit_time" > "entry_time");

-- sentiments: score range [-1, 1]
ALTER TABLE "sentiments"
  ADD CONSTRAINT "sentiments_score_check"
  CHECK ("score" >= -1 AND "score" <= 1);

-- sentiments: confidence range [0, 1] (nullable)
ALTER TABLE "sentiments"
  ADD CONSTRAINT "sentiments_confidence_check"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- ============================================================
-- TRIGGERS / HELPER FUNCTIONS
-- ============================================================
-- Two PostgreSQL triggers from docs/Database.md § "Triggers / Business
-- Rules". Both are PL/pgSQL and cannot be expressed in Prisma.

-- 1) Composite component integrity
CREATE OR REPLACE FUNCTION "check_composite_components"()
RETURNS TRIGGER AS $$
DECLARE
  comp_type_str TEXT;
BEGIN
  SELECT sd.type::TEXT INTO comp_type_str
    FROM "strategy_definitions" sd
    JOIN "strategy_versions" sv ON sv."definition_id" = sd.id
   WHERE sv.id = NEW."composite_version_id";

  IF comp_type_str IS DISTINCT FROM 'COMPOSITE' THEN
    RAISE EXCEPTION 'composite_components.parent must be a COMPOSITE strategy version';
  END IF;

  IF NEW."composite_version_id" = NEW."component_version_id" THEN
    RAISE EXCEPTION 'composite strategy cannot include itself';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_check_composite_components"
BEFORE INSERT OR UPDATE ON "composite_components"
FOR EACH ROW EXECUTE FUNCTION "check_composite_components"();

-- 2) Experiment immutability after DONE
CREATE OR REPLACE FUNCTION "lock_finished_experiment"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'DONE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'experiment % is immutable after DONE', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_lock_finished_experiment"
BEFORE UPDATE ON "experiments"
FOR EACH ROW EXECUTE FUNCTION "lock_finished_experiment"();
