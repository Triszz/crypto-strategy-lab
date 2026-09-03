-- CreateEnum
CREATE TYPE "strategy_source" AS ENUM ('USER_PROMPT', 'WEB_IMPORT');

-- AlterTable
ALTER TABLE "backtest_results" ADD COLUMN     "calmar_ratio" DECIMAL(10,4),
ADD COLUMN     "profit_factor" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "saved_strategies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "version" VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    "description" VARCHAR(1000),
    "jsonDef" JSONB NOT NULL,
    "source" "strategy_source" NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_settings" (
    "id" UUID NOT NULL,
    "setting_key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_strategies_owner_id_created_at_idx" ON "saved_strategies"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "saved_strategies_created_at_idx" ON "saved_strategies"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_settings_setting_key_key" ON "evaluation_settings"("setting_key");
