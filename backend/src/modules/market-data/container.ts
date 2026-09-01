import type { Logger } from "../../shared/logger/logger";
import { logger as rootLogger } from "../../shared/logger/logger";
import { getPrismaClient } from "../../infrastructure/database/prisma";
import { loadEnv } from "../../config/env";
import { BinanceRestAdapter } from "./infrastructure/BinanceRestAdapter";
import { BinanceWsAdapter } from "./infrastructure/BinanceWsAdapter";
import { PostgresCandleRepository } from "./infrastructure/PostgresCandleRepository";
import { BackfillService } from "./application/BackfillService";
import { DefaultChartSeeder } from "./application/DefaultChartSeeder";
import { MarketDataService } from "./application/MarketDataService";
import { ReconciliationService } from "./application/ReconciliationService";
import { SymbolSyncService } from "./application/SymbolSyncService";
import { SocketGateway } from "./realtime/SocketGateway";
import { CandlePersister } from "./realtime/CandlePersister";
import { buildMarketDataRouter } from "./presentation/market-data.routes";

export interface MarketDataContainer {
  repo: PostgresCandleRepository;
  restAdapter: BinanceRestAdapter;
  wsAdapter: BinanceWsAdapter;
  backfillService: BackfillService;
  symbolSyncService: SymbolSyncService;
  defaultChartSeeder: DefaultChartSeeder;
  reconciliationService: ReconciliationService;
  service: MarketDataService;
  socketGateway: SocketGateway;
  persister: CandlePersister;
  router: ReturnType<typeof buildMarketDataRouter>;
}

export interface MarketDataContainerOverrides {
  logger?: Logger;
  reconcileIntervalMs?: number;
  reconcileOnReconnect?: boolean;
}

/**
 * Composition root for the Market Data module. Centralising wiring
 * here keeps `server.ts` free of adapter details and lets tests
 * substitute any layer (e.g. an in-memory repository).
 */
export function buildMarketDataContainer(
  overrides: MarketDataContainerOverrides = {},
): MarketDataContainer {
  const log = overrides.logger ?? rootLogger;
  const prisma = getPrismaClient();
  const env = loadEnv();

  const repo = new PostgresCandleRepository(prisma, log);
  const restAdapter = new BinanceRestAdapter({ logger: log });
  const wsAdapter = new BinanceWsAdapter({ logger: log });

  const backfillService = new BackfillService(
    restAdapter,
    repo,
    log,
    env.MAX_CANDLES_PER_CHART, // initialCandles (used on empty-DB fallback)
    env.MAX_CANDLES_PER_CHART, // retention cap applied after each boot fill
  );
  const symbolSyncService = new SymbolSyncService(prisma, restAdapter, log);
  const defaultChartSeeder = new DefaultChartSeeder(prisma, log);

  const reconciliationService = new ReconciliationService(
    restAdapter,
    repo,
    wsAdapter,
    log,
    {
      intervalMs: overrides.reconcileIntervalMs ?? env.RECONCILE_INTERVAL_MS,
      enabled: overrides.reconcileOnReconnect ?? env.RECONCILE_ON_RECONNECT,
    },
  );

  const service = new MarketDataService(
    symbolSyncService,
    defaultChartSeeder,
    backfillService,
    wsAdapter,
    reconciliationService,
    repo,
    log,
  );

  const persister = new CandlePersister(repo, log);
  const socketGateway = new SocketGateway(wsAdapter, service);

  const router = buildMarketDataRouter({
    repo,
    backfill: backfillService,
    logger: log,
  });

  return {
    repo,
    restAdapter,
    wsAdapter,
    backfillService,
    symbolSyncService,
    defaultChartSeeder,
    reconciliationService,
    service,
    socketGateway,
    persister,
    router,
  };
}
