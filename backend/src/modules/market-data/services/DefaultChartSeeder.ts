import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../../shared/logger/logger";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import {
  DEFAULT_TIMEFRAMES,
  SUPPORTED_TIMEFRAMES,
  type Timeframe,
} from "../core/types";

type PrismaTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type ChartConfigRow = {
  chartIndex: number;
  pair: string;
  timeframe: { code: string };
  updatedAt: Date;
};

const TIMEFRAME_DEFINITIONS: Array<{
  code: Timeframe;
  label: string;
  seconds: number;
}> = [
  { code: "1m", label: "1 Minute", seconds: 60 },
  { code: "5m", label: "5 Minutes", seconds: 300 },
  { code: "15m", label: "15 Minutes", seconds: 900 },
  { code: "1h", label: "1 Hour", seconds: 3_600 },
  { code: "4h", label: "4 Hours", seconds: 14_400 },
  { code: "1d", label: "1 Day", seconds: 86_400 },
];

export interface DefaultChartSeederResult {
  timeframeCount: number;
  chartConfigs: Array<{
    chartIndex: number;
    symbol: string;
    timeframe: Timeframe;
  }>;
}

/**
 * Idempotent first-run bootstrapper.
 *   - Upserts the 6 supported timeframes (1m/5m/15m/1h/4h/1d).
 *   - Deactivates any timeframe row whose code isn't supported.
 *   - Seeds the 4 default chart panes (BTCUSDT × [1m,1h,4h,1d]) when
 *     the `chart_configs` table is empty.
 */
export class DefaultChartSeeder {
  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly logger: Logger,
  ) {}

  async seedIfEmpty(): Promise<DefaultChartSeederResult> {
    await this.ensureTimeframes();
    const configs = await this.ensureChartConfigs();
    return {
      timeframeCount: SUPPORTED_TIMEFRAMES.length,
      chartConfigs: configs,
    };
  }

  private async ensureTimeframes(): Promise<void> {
    await this.prisma.$transaction(async (tx: PrismaTx) => {
      for (const def of TIMEFRAME_DEFINITIONS) {
        await tx.timeframe.upsert({
          where: { code: def.code },
          update: { label: def.label, seconds: def.seconds, isActive: true },
          create: {
            code: def.code,
            label: def.label,
            seconds: def.seconds,
            isActive: true,
          },
        });
      }
    });

    const active = await this.prisma.timeframe.findMany({
      where: { isActive: true },
      select: { code: true },
    });
    const allowed = new Set<string>(TIMEFRAME_DEFINITIONS.map((d) => d.code));
    const stale = active.map((t) => t.code).filter((c) => !allowed.has(c));
    if (stale.length > 0) {
      await this.prisma.timeframe.updateMany({
        where: { code: { in: stale } },
        data: { isActive: false },
      });
    }
    this.logger.debug(
      { supported: TIMEFRAME_DEFINITIONS.length, deactivated: stale.length },
      "market-data.timeframes.seeded",
    );
  }

  private async ensureChartConfigs(): Promise<
    Array<{ chartIndex: number; symbol: string; timeframe: Timeframe }>
  > {
    const existing = await this.prisma.chartConfig.count();
    if (existing > 0) {
      this.logger.debug({ existing }, "market-data.chart-config.exists");
      const rows = (await this.prisma.chartConfig.findMany({
        include: { timeframe: { select: { code: true } } },
      })) as ChartConfigRow[];
      return rows.map((row) => ({
        chartIndex: row.chartIndex,
        symbol: row.pair,
        timeframe: row.timeframe.code as Timeframe,
      }));
    }

    const fallbackSymbol = await this.pickDefaultSymbol();
    if (!fallbackSymbol) {
      this.logger.warn(
        "no active symbol available; chart configs will be created on next boot",
      );
      return [];
    }

    const created: Array<{
      chartIndex: number;
      symbol: string;
      timeframe: Timeframe;
    }> = [];
    await this.prisma.$transaction(async (tx: PrismaTx) => {
      for (let i = 0; i < DEFAULT_TIMEFRAMES.length; i += 1) {
        const tf: Timeframe = DEFAULT_TIMEFRAMES[i] as Timeframe;
        const timeframeRow = await tx.timeframe.findUnique({
          where: { code: tf },
          select: { id: true },
        });
        if (!timeframeRow) continue;

        await tx.chartConfig.create({
          data: {
            chartIndex: i,
            pair: fallbackSymbol,
            timeframeId: timeframeRow.id,
          },
        });
        created.push({ chartIndex: i, symbol: fallbackSymbol, timeframe: tf });
      }
    });

    this.logger.info(
      { count: created.length, symbol: fallbackSymbol },
      "market-data.chart-config.seeded",
    );
    return created;
  }

  private async pickDefaultSymbol(): Promise<string> {
    const btc = await this.prisma.symbol.findFirst({
      where: { symbol: "BTCUSDT", isActive: true },
      select: { symbol: true },
    });
    if (btc) return btc.symbol;
    const row = await this.prisma.symbol.findFirst({
      where: { isActive: true },
      orderBy: { symbol: "asc" },
      select: { symbol: true },
    });
    if (row) return row.symbol;

    // Seed default active symbols if table is empty
    const defaultSymbols = [
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
      { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
      { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT" },
      { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT" },
    ];
    for (const s of defaultSymbols) {
      await this.prisma.symbol.upsert({
        where: { symbol: s.symbol },
        update: { isActive: true },
        create: { ...s, isActive: true },
      });
    }
    return "BTCUSDT";
  }
}
