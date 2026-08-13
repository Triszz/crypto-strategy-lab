/**
 * Vitest setup hook.
 *
 * Runs BEFORE any test module is evaluated. We use it to install the
 * minimum environment defaults so that `dotenv`-style imports (which
 * eagerly call `loadEnv()`) do not throw on the test machine.
 *
 * The defaults here are deliberately inert: the DATABASE_URL points
 * at a non-existent local Postgres so any module that tries to
 * connect at import time will fail LOUDLY, but tests that don't
 * touch the database will run normally.
 */
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "3000";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/csl_test";
process.env.REDIS_HOST ??= "localhost";
process.env.REDIS_PORT ??= "6379";
process.env.REDIS_PASSWORD ??= "";
process.env.REDIS_DB ??= "0";
process.env.BINANCE_REST_BASE_URL ??= "https://api.binance.com";
process.env.BINANCE_WS_BASE_URL ??= "wss://stream.binance.com:9443";
process.env.CRYPTOPANIC_API_KEY ??= "";
process.env.GEMINI_API_KEY ??= "";
process.env.CORS_ORIGINS ??= "*";