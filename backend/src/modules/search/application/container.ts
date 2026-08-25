/**
 * search · application · container
 *
 * Composition root for the Search module. Centralises wiring so that:
 *   - `server.ts` stays free of business-logic adapters
 *   - Tests can substitute any layer (e.g. an in-memory repository)
 *
 * Responsibilities:
 *   - Create Prisma client
 *   - Build PrismaSearchRepository
 *   - Build StrategyVersionMapper
 *   - Build SearchService
 *   - Build HTTP router
 *
 * NOTE: This module is intentionally wired synchronously in server.ts.
 * The Search service does NOT start automatically — the caller must invoke
 * `service.createSearchRun()` + `service.start()` to begin a search.
 */
import type { Logger } from "../../../shared/logger/logger";
import { logger as rootLogger } from "../../../shared/logger/logger";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import { PrismaSearchRepository } from "./PrismaSearchRepository";
import { StrategyVersionMapper } from "./StrategyVersionMapper";
import { SearchService } from "./SearchService";
import { buildSearchRouter } from "../presentation/search.routes";

export interface SearchContainer {
  readonly repository: PrismaSearchRepository;
  readonly strategyVersionMapper: StrategyVersionMapper;
  readonly service: SearchService;
  readonly router: ReturnType<typeof buildSearchRouter>;
}

export interface SearchContainerOverrides {
  logger?: Logger;
}

/**
 * Build the Search module container.
 *
 * @param overrides  Optional logger override (injected for testability).
 */
export function buildSearchContainer(
  overrides: SearchContainerOverrides = {},
): SearchContainer {
  const log = overrides.logger ?? rootLogger;
  const prisma = getPrismaClient();

  const repository = new PrismaSearchRepository(prisma);
  const strategyVersionMapper = new StrategyVersionMapper(prisma, log);
  const service = new SearchService(repository, strategyVersionMapper, log);
  const router = buildSearchRouter({ service, logger: log });

  return { repository, strategyVersionMapper, service, router };
}
