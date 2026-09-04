import type { Logger } from "../../shared/logger/logger";
import { logger as rootLogger } from "../../shared/logger/logger";
import { getPrismaClient } from "../../infrastructure/database/prisma";
import { loadEnv } from "../../config/env";
import { BinanceProvider } from "./providers/binance/BinanceProvider";
import { PostgresCandleRepository } from "./storage/PostgresCandleRepository";
import { BackfillService } from "./services/BackfillService";
import { DefaultChartSeeder } from "./services/DefaultChartSeeder";
import { MarketDataService } from "./services/MarketDataService";
import { ReconciliationService } from "./services/ReconciliationService";
import { SymbolSyncService } from "./services/SymbolSyncService";
import { SocketGateway } from "./realtime/SocketGateway";
import { CandlePersister } from "./realtime/CandlePersister";
import { buildMarketDataRouter } from "./presentation/market-data.routes";

export interface MarketDataContainer {
  provider: BinanceProvider;
  repo: PostgresCandleRepository;
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
 * 
 * Now uses the Provider pattern - services depend on MarketDataProvider
 * interface instead of concrete Binance adapters.
 */
export function buildMarketDataContainer(
  overrides: MarketDataContainerOverrides = {},
): MarketDataContainer {
  const log = overrides.logger ?? rootLogger;
  const prisma = getPrismaClient();
  const env = loadEnv();

  // ✅ Instantiate provider (unified facade for REST + WebSocket)
  const provider = new BinanceProvider({ logger: log });
  
  // ✅ Repository stays the same
  const repo = new PostgresCandleRepository(prisma, log);

  // ✅ Services now depend on MarketDataProvider interface
  const backfillService = new BackfillService(
    provider,  // Pass interface
    repo,
    log,
    env.MAX_CANDLES_PER_CHART,
    env.MAX_CANDLES_PER_CHART,
  );

  const symbolSyncService = new SymbolSyncService(prisma, provider, log);
  
  // Use existing DefaultChartSeeder from application folder
  const defaultChartSeeder = new DefaultChartSeeder(prisma, log);

  const reconciliationService = new ReconciliationService(
    provider,  // Pass interface
    repo,
    log,
    {
      intervalMs: overrides.reconcileIntervalMs ?? env.RECONCILE_INTERVAL_MS,
      enabled: overrides.reconcileOnReconnect ?? env.RECONCILE_ON_RECONNECT,
    },
  );

  // ✅ MarketDataService constructor reordered to match new signature
  const service = new MarketDataService(
    provider,           // 1st - provider interface
    repo,               // 2nd - repository interface
    symbolSyncService,  // 3rd
    defaultChartSeeder, // 4th
    backfillService,    // 5th
    reconciliationService, // 6th
    log,                // 7th
  );

  const persister = new CandlePersister(repo);
  
  // ✅ SocketGateway now uses provider
  const socketGateway = new SocketGateway(provider, service);

  const router = buildMarketDataRouter({
    repo,
    backfill: backfillService,
    logger: log,
  });

  return {
    provider,
    repo,
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
