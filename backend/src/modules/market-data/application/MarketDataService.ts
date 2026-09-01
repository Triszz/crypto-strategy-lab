import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../domain/Candle";
import type { ChartConfig } from "../domain/ChartConfig";
import { type Timeframe } from "../domain/Timeframe";
import type { WsConnectionStatus } from "../domain/events";
import {
  CANDLE_CLOSED_EVENT_VERSION,
  MARKET_DATA_EVENTS,
} from "../domain/events";
import type { BinanceWsAdapter } from "../infrastructure/BinanceWsAdapter";
import { BackfillService } from "./BackfillService";
import { DefaultChartSeeder, type DefaultChartSeederResult } from "./DefaultChartSeeder";
import { ReconciliationService } from "./ReconciliationService";
import { SymbolSyncService } from "./SymbolSyncService";
import type { EventBus } from "../../../shared/event-bus/EventBus";
import { getEventBus } from "../../../shared/event-bus/EventBus";
import { candleKey } from "../domain/Candle";
import type { PostgresCandleRepository } from "../infrastructure/PostgresCandleRepository";

export interface MarketDataStartResult {
  symbols: Awaited<ReturnType<SymbolSyncService["syncSymbols"]>>;
  defaults: DefaultChartSeederResult;
  chartConfigs: ChartConfig[];
}

/**
 * Top-level orchestrator for the Market Data module. `start()` is
 * called once during boot and wires the full pipeline:
 *
 *   1. Refresh the symbols table from Binance.
 *   2. Seed default timeframes + chart panes if missing.
 *   3. Backfill any candles newer than what's already in the DB
 *      (incremental catch-up; preserves existing data).
 *   4. Connect the WebSocket adapter and subscribe to the 4 default
 *      streams so live updates flow as soon as the boot completes.
 *   5. Bridge WS events into the in-process EventBus for downstream
 *      consumers (Strategy, Search, Backtest, ...).
 *   6. Start gap reconciliation (reconnect-triggered + periodic).
 *
 * `stop()` tears down the WebSocket cleanly and removes the in-process
 * subscribers. Re-running `start()` is supported — useful for tests.
 */
export class MarketDataService {
  private wireDispose: (() => void) | null = null;
  private unsubscribeWsStatus: (() => void) | null = null;
  private reconnecting = false;

  constructor(
    private readonly symbolSync: SymbolSyncService,
    private readonly chartSeeder: DefaultChartSeeder,
    private readonly backfill: BackfillService,
    private readonly wsAdapter: BinanceWsAdapter,
    private readonly reconciliation: ReconciliationService,
    private readonly repo: PostgresCandleRepository,
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

    // On boot, only fetch candles that are missing since the last
    // run — keep existing data intact. If the DB is empty for a
    // chart, `backfillMissing` falls back to seeding the latest N.
    await this.backfill.backfillMissing(chartConfigs);

    // Wire WS -> EventBus *before* connecting so we never miss the
    // first "CandleClosed" emitted by the freshly opened stream.
    this.wireWsToEventBus();
    this.wireReconnectReconciliation();
    await this.wsAdapter.connect();
    for (const chart of chartConfigs) {
      await this.wsAdapter.subscribe(chart.symbol, chart.timeframe);
    }

    // Start the periodic reconciliation loop only after the WS is up.
    // First reconnect transition is ignored (boot backfill already did
    // the work), but the periodic timer provides the fallback net.
    this.reconciliation.startPeriodic();

    this.logger.info("market-data.start.complete");
    return { symbols, defaults, chartConfigs };
  }

  async stop(): Promise<void> {
    this.logger.info("market-data.stop");
    this.reconciliation.stopPeriodic();
    this.unwireWsStatus();
    this.unwire();
    try {
      await this.wsAdapter.disconnect();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        "market-data.stop.ws-error",
      );
    }
  }

  /**
   * Lazy WS subscribe used by `SocketGateway` when a client asks for
   * a stream we don't yet have. The ref-count guarantees we won't
   * double-subscribe upstream.
   */
  async ensureSubscribed(symbol: string, timeframe: Timeframe): Promise<void> {
    await this.wsAdapter.subscribe(symbol, timeframe);
  }

  async releaseSubscription(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<void> {
    await this.wsAdapter.unsubscribe(symbol, timeframe);
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

  private wireWsToEventBus(): void {
    if (this.wireDispose) return;

    const onClosed = (candle: Candle): void => {
      this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_CLOSED, candle);
    };
    const onUpdating = (candle: Candle): void => {
      this.eventBus.publish(MARKET_DATA_EVENTS.CANDLE_UPDATING, candle);
    };

    this.wsAdapter.on("CandleClosed", onClosed);
    this.wsAdapter.on("CandleUpdating", onUpdating);

    // Persist closed candles to the DB asynchronously — never block
    // the WS read loop on a slow `upsert`.
    const persist = async (candle: Candle): Promise<void> => {
      try {
        await this.repo.upsert(candle);
      } catch (err) {
        this.logger.error(
          {
            candleKey: candleKey(candle),
            err: (err as Error).message,
          },
          "market-data.persist.failed",
        );
      }
    };

    const onClosedPersist = (candle: Candle): void => {
      void persist(candle);
    };

    this.wsAdapter.on("CandleClosed", onClosedPersist);

    this.wireDispose = (): void => {
      this.wsAdapter.off("CandleClosed", onClosed);
      this.wsAdapter.off("CandleClosed", onClosedPersist);
      this.wsAdapter.off("CandleUpdating", onUpdating);
    };
  }

  /**
   * Bridge `wsAdapter.status` into the reconciliation service. We track
   * the edge `reconnecting → connected` so that the FIRST `connected`
   * after boot (which is just the initial open) is ignored — boot
   * backfill has already populated the DB. Subsequent transitions
   * (i.e. genuine reconnects) trigger a per-stream gap fill.
   *
   * See docs/Market Data Service.md §15.4 (Giải pháp 1).
   */
  private wireReconnectReconciliation(): void {
    if (this.unsubscribeWsStatus) return;

    const onStatus = (status: WsConnectionStatus): void => {
      if (status.state === "reconnecting") {
        this.reconnecting = true;
        return;
      }
      if (status.state === "connected" && this.reconnecting) {
        // Edge: reconnecting → connected. Fire-and-forget; errors are
        // logged inside `reconcileAll`.
        this.reconnecting = false;
        this.logger.info(
          { since: status.since },
          "market-data.reconcile.reconnect-triggered",
        );
        void this.reconciliation.reconcileAll("reconnect").then((results) => {
          const filled = results.filter((r) => !r.skipped);
          if (filled.length > 0) {
            this.logger.info(
              {
                streams: filled.length,
                totalFetched: filled.reduce((s, r) => s + r.fetched, 0),
                totalUpserted: filled.reduce((s, r) => s + r.upserted, 0),
              },
              "market-data.reconcile.reconnect-filled",
            );
          }
        });
      }
    };

    this.wsAdapter.on("status", onStatus);
    this.unsubscribeWsStatus = (): void => {
      this.wsAdapter.off("status", onStatus);
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