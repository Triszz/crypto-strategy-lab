import pino, { type Logger, type LoggerOptions } from "pino";
import { isProduction, loadEnv } from "../../config/env";

const env = loadEnv();

const options: LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    service: "crypto-strategy-lab-backend",
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: isProduction(env)
    ? { level: (label: string) => ({ level: label }) }
    : undefined,
  redact: {
    paths: [
      "DATABASE_URL",
      "REDIS_PASSWORD",
      "CRYPTOPANIC_API_KEY",
      "GEMINI_API_KEY",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
    ],
    censor: "[REDACTED]",
  },
};

export const logger: Logger = pino(options);

export type { Logger };