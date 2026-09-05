import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  BINANCE_REST_BASE_URL: z.string().url().default("https://api.binance.com"),
  BINANCE_WS_BASE_URL: z.string().default("wss://stream.binance.com:9443"),

  CRYPTOPANIC_API_KEY: z.string().optional().default(""),
  NEWSDATA_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  SENTIMENT_ANALYZER: z.string().optional().default("lexicon"),

  // News crawler — comma-separated list of adapter codes to enable.
  // Supported: newsdata, cryptocompare, coindesk, cointelegraph, btcmagazine, rss.
  // newsdata (primary): get free key at https://newsdata.io (200 credits/day).
  // Leave blank to auto-enable all configured sources.
  // Example: NEWS_PROVIDERS=cryptocompare,coindesk,cointelegraph
  NEWS_PROVIDERS: z.string().optional().default(""),

  // CryptoCompare free-tier API key (https://min-api.cryptocompare.com/).
  // Required only if "cryptocompare" is in NEWS_PROVIDERS.
  CRYPTOCOMPARE_API_KEY: z.string().optional().default(""),

  // News crawler — how often (ms) to run the periodic crawl.
  // Default: 5 minutes. Set to 0 to disable the periodic run.
  NEWS_CRAWL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(5 * 60 * 1000),

  CORS_ORIGINS: z.string().optional().default("*"),

  // Reconciliation tuning (see docs/Market Data Service.md §15)
  RECONCILE_ON_RECONNECT: z.coerce.boolean().default(true),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  // Retention cap per (symbol, timeframe) — applied on boot to keep
  // the candles table bounded. See docs/Market Data Service.md §6.3.
  MAX_CANDLES_PER_CHART: z.coerce.number().int().positive().default(100),
});

export type RawEnv = z.infer<typeof RawEnvSchema>;

let cached: RawEnv | null = null;

export function loadEnv(): RawEnv {
  if (cached) return cached;

  const parsed = RawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` + `See backend/.env.example for the required variables.`,
    );
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(env: RawEnv = loadEnv()): boolean {
  return env.NODE_ENV === "production";
}
