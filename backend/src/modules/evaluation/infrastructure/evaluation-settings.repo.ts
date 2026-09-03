/**
 * Repository: reads evaluation configuration from the EvaluationSetting table.
 *
 * Caches results for 60 seconds to avoid hammering the DB on every evaluation
 * job (a worker may process hundreds of jobs per minute).
 *
 * Graceful degradation: if DB is unreachable, returns DEFAULT_CONFIG and logs
 * a warning — the system continues with safe defaults rather than crashing.
 */

import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { logger } from "../../../shared/logger/logger";
import {
  DEFAULT_CONFIG,
  EVAL_SETTING_KEYS,
  EvaluationConfig,
  EvaluationWeights,
} from "../domain/evaluation.types";

// ---------------------------------------------------------------------------
// Module-level cache (survives across multiple repo calls)
// ---------------------------------------------------------------------------
interface CacheEntry {
  config: EvaluationConfig;
  cachedAt: number;
}

let _cache: CacheEntry | null = null;
const TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeSettings(
  weights: Partial<EvaluationWeights>,
  threshold: number | undefined
): EvaluationConfig {
  return {
    weights: {
      return: weights.return ?? DEFAULT_CONFIG.weights.return,
      winRate: weights.winRate ?? DEFAULT_CONFIG.weights.winRate,
      drawdown: weights.drawdown ?? DEFAULT_CONFIG.weights.drawdown,
    },
    tradeCountThreshold: threshold ?? DEFAULT_CONFIG.tradeCountThreshold,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns cached evaluation configuration. Refreshes cache if older than 60s.
 *
 * @throws Never — degrades to DEFAULT_CONFIG on DB errors.
 */
export async function getEvaluationConfig(): Promise<EvaluationConfig> {
  const now = Date.now();

  if (_cache !== null && now - _cache.cachedAt < TTL_MS) {
    return _cache.config;
  }

  const prisma = getPrismaClient();

  try {
    const rows = await prisma.evaluationSetting.findMany({
      where: {
        key: {
          in: [EVAL_SETTING_KEYS.DEFAULT_WEIGHTS, EVAL_SETTING_KEYS.TRADE_COUNT_THRESHOLD],
        },
      },
    });

    let weights: Partial<EvaluationWeights> = {};
    let threshold: number | undefined;

    for (const row of rows) {
      if (row.key === EVAL_SETTING_KEYS.DEFAULT_WEIGHTS) {
        const val = row.value as Partial<EvaluationWeights>;
        weights = {
          return: val?.return,
          winRate: val?.winRate,
          drawdown: val?.drawdown,
        };
      } else if (row.key === EVAL_SETTING_KEYS.TRADE_COUNT_THRESHOLD) {
        const val = row.value as { threshold?: number };
        threshold = val?.threshold;
      }
    }

    const config = mergeSettings(weights, threshold);
    _cache = { config, cachedAt: now };

    logger.debug(
      { config, cachedAt: new Date(_cache.cachedAt).toISOString() },
      "[EvaluationSettingsRepo] Config loaded from DB, cache refreshed"
    );

    return config;
  } catch (err) {
    logger.warn(
      { err },
      "[EvaluationSettingsRepo] Failed to load config from DB; using DEFAULT_CONFIG"
    );
    return DEFAULT_CONFIG;
  }
}

/**
 * Clears the in-memory cache. Primarily useful in tests.
 */
export function clearEvaluationConfigCache(): void {
  _cache = null;
}
