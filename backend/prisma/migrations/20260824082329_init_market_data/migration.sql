/*
  Warnings:

  - Made the column `timeframe_id` on table `candles` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "candles" DROP CONSTRAINT "candles_timeframe_id_fkey";

-- DropForeignKey
ALTER TABLE "chart_configs" DROP CONSTRAINT "chart_configs_timeframe_id_fkey";

-- AlterTable
ALTER TABLE "candles" ALTER COLUMN "timeframe_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "chart_configs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "pair" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "timeframes" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "candles_symbol_id_timeframe_id_open_time_idx" ON "candles"("symbol_id", "timeframe_id", "open_time" DESC);

-- AddForeignKey
ALTER TABLE "chart_configs" ADD CONSTRAINT "chart_configs_timeframe_id_fkey" FOREIGN KEY ("timeframe_id") REFERENCES "timeframes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candles" ADD CONSTRAINT "candles_timeframe_id_fkey" FOREIGN KEY ("timeframe_id") REFERENCES "timeframes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
