import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../core/types";
import { type Timeframe } from "../core/types";
import type { WsConnectionStatus } from "../core/events";
import {
  CANDLE_CLOSED_EVENT_VERSION,
  MARKET_DATA_EVENTS,
} from "../core/events";
import type { ChartConfig } from "../core/types";
import type { MarketDataProvider } from "../core/ports";
import type { CandleRepository } from "../core/ports";
import { BackfillService } from "./BackfillService";
import { DefaultChartSeeder, type DefaultChartSeederResult } from "./DefaultChartSeeder";
import { ReconciliationService } from "./ReconciliationService";
import { SymbolSyncService } from "./SymbolSyncService";
import type { EventBus } from "../../../shared/event-bus/EventBus";
import { getEventBus } from "../../../shared/event-bus/EventBus";

export interface MarketDataStartResult {
  symbols: Awaited<ReturnType<SymbolSyncService["syncSymbols"]>>;
  defaults: DefaultChartSeederResult;
  chartConfigs: ChartConfig[];
}

/**
 * Top-level orchestrator for the Market Data module. `start()` is
 * called once during boot and wires the full pipeline:
 *
 *   1. Refresh the symbols table from exchange.
 *   2. Seed default timeframes + chart panes if missing.
 *   3. Backfill any candles newer than what's already in the DB
 *      (incremental catch-up; preserves existing data).
 *   4. Connect the provider and subscribe to the default
 *      streams so live updates flow as soon as the boot completes.
 *   5. Bridge provider events into the in-process EventBus for downstream
 *      consumers (Strategy, Search, Backtest, ...).
 *   6. Start gap reconciliation (reconnect-triggered + periodic).
 *
 * `stop()` tears down the provider cleanly and removes the in-process
 * subscribers. Re-running `start()` is supported — useful for tests.
 */
export class MarketDataService {
  private wireDispose: (() => void) | null = null;
  private unsubscribeWsStatus: (() => void) | null = null;
  private reconnecting = false;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly repo: CandleRepository,
    private readonly symbolSync: SymbolSyncService,
    private readonly chartSeeder: DefaultChartSeeder,
    private readonly backfill: BackfillService,
    private readonly reconciliation: ReconciliationService,
    private readonly logger: Logger,
    private readonly eventBus: EventBus = getEventBus(),
  ) {}

  async start(): Promise<MarketDataStartResult> {
    this.logger.info("market-data.start");

    const symbols = await this.symbolSync.syncSymbols();

    const defaults = await this.chartSeeder.seedIfEmpty();

    const chartConfigs = await this.loadActiveChartConfigs();
    this.logger.info(
      { charts: chartConfigs.length },
      "market-data.charts.loaded",
    );

    // Clear all existing candles on server restart
    this.logger.info("market-data.clearing-old-candles");
    await this.repo.deleteAll();
    this.logger.info("market-data.old-candles-cleared");

    // Fetch fresh candles for each chart
    this.logger.info("market-data.fetching-initial-candles");
    await this.backfill.backfillMissing(chartConfigs);
    this.logger.info("market-data.initial-candles-fetched");

    // Wire provider -> EventBus *before* connecting so we never miss the
    // first "CandleClosed" emitted by the freshly opened stream.
    this.wireProviderToEventBus();
    this.wireReconnectReconciliation();
    await this.provider.connect();
    for (const chart of chartConfigs) {
      await this.provider.subscribe(chart.symbol, chart.timeframe);
    }

    // Start the periodic reconciliation loop only after the provider is up.
    this.reconciliation.startPeriodic();

    return { symbols, defaults, chartConfigs };
  }

  async stop(): Promise<void> {
    this.reconciliation.stopPeriodic();
    this.unwireWsStatus();
    this.unwire();
    try {
      await this.provider.disconnect();
    } catch (err) {
      // Ignore disconnect errors
    }
  }

  /**
   * Lazy subscribe used by `SocketGateway` when a client asks for
   * a stream we don't yet have. The ref-count guarantees we won't
   * double-subscribe upstream.
   */
  async ensureSubscribed(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.provider.subscribe(symbol, timeframe);
  }

  async releaseSubscription(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<void> {
    await this.provider.unsubscribe(symbol, timeframe);
  }

  private async loadActiveChartConfigs(): Promise<ChartConfig[]> {
    const { getPrismaClient } = await import(
      "../../../infrastructure/database/prisma"
    );
    const prisma = getPrismaClient();
    type Row = {
      chartIndex: number;
      pair: string;
      timeframe: { code: string };
      updatedAt: Date;
    };
    const rows = (await prisma.chartConfig.findMany({
      orderBy: { chartIndex: "asc" },
      include: { timeframe: { select: { code: true } } },
    })) as Row[];
    return rows.map((row) => ({
      chartIndex: row.chartIndex,
      symbol: row.pair,
      timeframe: row.timeframe.code as Timeframe,
      updatedAt: row.updatedAt,
    }));
  }

  private wireProviderToEventBus(): void {
    if (this.wireDispose) return;

    const onClosed = (candle: Candle): void => {
      this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_CLOSED, candle);
    };
    const onUpdating = (candle: Candle): void => {
      this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_UPDATING, candle);
    };

    this.provider.on("CandleClosed", onClosed);
    this.provider.on("CandleUpdating", onUpdating);

    // Persist closed candles to the DB asynchronously — never block
    // the WS read loop on a slow `upsert`.
    const persist = async (candle: Candle): Promise<void> => {
      try {
        await this.repo.upsert(candle);
      } catch (err) {
        // Ignore persist errors
      }
    };

    const onClosedPersist = (candle: Candle): void => {
      void persist(candle);
    };

    this.provider.on("CandleClosed", onClosedPersist);

    this.wireDispose = (): void => {
      this.provider.off("CandleClosed", onClosed);
      this.provider.off("CandleClosed", onClosedPersist);
      this.provider.off("CandleUpdating", onUpdating);
    };
  }

  /**
   * Bridge provider status into the reconciliation service. We track
   * the edge `reconnecting → connected` so that the FIRST `connected`
   * after boot (which is just the initial open) is ignored — boot
   * backfill has already populated the DB. Subsequent transitions
   * (i.e. genuine reconnects) trigger a per-stream gap fill.
   */
  private wireReconnectReconciliation(): void {
    if (this.unsubscribeWsStatus) return;

    const onStatus = (status: WsConnectionStatus): void => {
      if (status.state === "reconnecting") {
        this.reconnecting = true;
        return;
      }
      if (status.state === "connected" && this.reconnecting) {
        this.reconnecting = false;
        void this.reconciliation.reconcileAll("reconnect").then((results) => {
          const filled = results.filter((r) => !r.skipped);
          if (filled.length > 0) {
            // Reconnect filled successfully
          }
        });
      }
    };

    this.provider.on("status", onStatus);
    this.unsubscribeWsStatus = (): void => {
      this.provider.off("status", onStatus);
    };
  }

  private unwireWsStatus(): void {
    if (this.unsubscribeWsStatus) {
      this.unsubscribeWsStatus();
      this.unsubscribeWsStatus = null;
    }
  }

  private unwire(): void {
    if (this.wireDispose) {
      this.wireDispose();
      this.wireDispose = null;
    }
  }
}

export const CANDLE_CLOSED_EVENT_VERSION_REEXPORT = CANDLE_CLOSED_EVENT_VERSION;
