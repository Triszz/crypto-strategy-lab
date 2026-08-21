-- Migration: Remove MarketDataProvider, Add Timeframe, ChartConfig
-- Generated: 2026-08-21

-- Step 1: Drop foreign key from Symbol to MarketDataProvider
ALTER TABLE "symbols" DROP CONSTRAINT IF EXISTS "symbols_provider_id_fkey";

-- Step 2: Drop column provider_id from symbols
ALTER TABLE "symbols" DROP COLUMN IF EXISTS "provider_id";

-- Step 3: Drop unique constraint (providerId, symbol) and add unique (symbol)
ALTER TABLE "symbols" DROP CONSTRAINT IF EXISTS "symbols_provider_id_symbol_key";
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_symbol_key" UNIQUE ("symbol");

-- Step 4: Drop MarketDataProvider table
DROP TABLE IF EXISTS "market_data_providers";

-- Step 5: Create Timeframe table
CREATE TABLE "timeframes" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "code" VARCHAR(8) NOT NULL UNIQUE,
    "label" VARCHAR(32) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

-- Step 6: Create ChartConfig table (references Timeframe)
CREATE TABLE "chart_configs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "chart_index" INTEGER NOT NULL,
    "pair" VARCHAR(32) NOT NULL DEFAULT 'BTCUSDT',
    "timeframe_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);

-- Step 7: Add foreign key for ChartConfig -> Timeframe
ALTER TABLE "chart_configs" ADD CONSTRAINT "chart_configs_timeframe_id_fkey" FOREIGN KEY ("timeframe_id") REFERENCES "timeframes"("id");

-- Step 8: Add unique constraint on chart_index
ALTER TABLE "chart_configs" ADD CONSTRAINT "chart_configs_chart_index_key" UNIQUE ("chart_index");

-- Step 9: Update Candle table - add timeframe_id, drop timeframe string, add FK
ALTER TABLE "candles" ADD COLUMN IF NOT EXISTS "timeframe_id" UUID;
ALTER TABLE "candles" ADD CONSTRAINT "candles_timeframe_id_fkey" FOREIGN KEY ("timeframe_id") REFERENCES "timeframes"("id");

-- Step 10: Drop old unique constraint and create new one
ALTER TABLE "candles" DROP CONSTRAINT IF EXISTS "candles_symbol_id_timeframe_open_time_key";
ALTER TABLE "candles" ADD CONSTRAINT "candles_symbol_id_timeframe_id_open_time_key" UNIQUE ("symbol_id", "timeframe_id", "open_time");

-- Step 11: Drop old timeframe column from candles
ALTER TABLE "candles" DROP COLUMN IF EXISTS "timeframe";

-- Step 12: Insert default timeframes (Binance supported)
INSERT INTO "timeframes" ("id", "code", "label", "seconds") VALUES
    (gen_random_uuid(), '1m', '1 Minute', 60),
    (gen_random_uuid(), '3m', '3 Minutes', 180),
    (gen_random_uuid(), '5m', '5 Minutes', 300),
    (gen_random_uuid(), '15m', '15 Minutes', 900),
    (gen_random_uuid(), '30m', '30 Minutes', 1800),
    (gen_random_uuid(), '1h', '1 Hour', 3600),
    (gen_random_uuid(), '2h', '2 Hours', 7200),
    (gen_random_uuid(), '4h', '4 Hours', 14400),
    (gen_random_uuid(), '6h', '6 Hours', 21600),
    (gen_random_uuid(), '8h', '8 Hours', 28800),
    (gen_random_uuid(), '12h', '12 Hours', 43200),
    (gen_random_uuid(), '1d', '1 Day', 86400),
    (gen_random_uuid(), '3d', '3 Days', 259200),
    (gen_random_uuid(), '1w', '1 Week', 604800),
    (gen_random_uuid(), '1M', '1 Month', 2592000);

-- Step 13: Insert default 4 chart configs (reference 5m timeframe by default)
INSERT INTO "chart_configs" ("id", "chart_index", "pair", "timeframe_id")
SELECT
    gen_random_uuid(),
    chart_index,
    pair,
    (SELECT id FROM "timeframes" WHERE code = timeframe_code)
FROM (VALUES
    (1, 'BTCUSDT', '5m'),
    (2, 'BTCUSDT', '15m'),
    (3, 'BTCUSDT', '1h'),
    (4, 'BTCUSDT', '4h')
) AS defaults(chart_index, pair, timeframe_code);
