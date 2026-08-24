import type { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { ChartConfig } from "../domain/ChartConfig";
import type { Timeframe } from "../domain/Timeframe";

type Row = {
  chartIndex: number;
  pair: string;
  timeframe: { code: string };
  updatedAt: Date;
};

/**
 * Read-only helper used by the REST surface to materialise the current
 * 4 chart panes. Kept in its own file so it can be overridden by
 * tests via the router dependency injection.
 */
export async function loadActiveChartConfigs(
  prisma: PrismaClient = getPrismaClient(),
): Promise<ChartConfig[]> {
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
