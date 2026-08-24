import { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "../../../shared/logger/logger";
import type { Candle } from "../domain/Candle";
import type {
  CandleQuery,
  CandleRepository,
} from "../domain/CandleRepository.port";
import type { Timeframe } from "../domain/Timeframe";
import { getPrismaClient } from "../../../infrastructure/database/prisma";

interface SymbolTimeframeIds {
  symbolId: string;
  timeframeId: string;
}

type SymbolRow = { id: string; symbol: string };
type TimeframeRow = { id: string; code: string };
type CandleRow = Awaited<ReturnType<PrismaClient["candle"]["findMany"]>>[number];

const MAX_QUERY_LIMIT = 1_000;

/**
 * Prisma-backed implementation of `CandleRepository`. The repository
 * keeps two in-memory caches (`symbolCache`, `timeframeCache`) so a
 * hot loop of `upsertBatch` doesn't issue a lookup per candle.
 */
export class PostgresCandleRepository implements CandleRepository {
  private readonly symbolCache = new Map<string, string>();
  private readonly timeframeCache = new Map<Timeframe, string>();
  private pendingResolve:
    | Promise<{
        symbols: SymbolRow[];
        timeframes: TimeframeRow[];
      }>
    | null = null;

  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _logger: Logger,
  ) {
    // Kept on the constructor for symmetry with sibling adapters, but
    // the repository currently relies on Prisma's own logging pipe
    // (configured in `infrastructure/database/prisma.ts`).
    void _logger;
  }

  async upsert(candle: Candle): Promise<void> {
    const ids = await this.resolveIds(candle.symbol, candle.timeframe);
    await this.prisma.candle.upsert({
      where: {
        symbolId_timeframeId_openTime: {
          symbolId: ids.symbolId,
          timeframeId: ids.timeframeId,
          openTime: BigInt(candle.openTime),
        },
      },
      create: this.toRow(candle, ids),
      update: this.toUpdateRow(candle),
    });
  }

  async upsertBatch(candles: Candle[]): Promise<number> {
    if (candles.length === 0) return 0;

    const distinctPairs = new Map<string, { symbol: string; timeframe: Timeframe }>();
    for (const c of candles) {
      const key = `${c.symbol}@${c.timeframe}`;
      if (!distinctPairs.has(key)) {
        distinctPairs.set(key, { symbol: c.symbol, timeframe: c.timeframe });
      }
    }
    for (const { symbol, timeframe } of distinctPairs.values()) {
      await this.resolveIds(symbol, timeframe);
    }

    const data = candles.map((c) => {
      const ids = this.requireIds(c.symbol, c.timeframe);
      return this.toRow(c, ids);
    });

    const result = await this.prisma.candle.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async query(q: CandleQuery): Promise<Candle[]> {
    const ids = await this.resolveIds(q.symbol, q.timeframe);
    const where: Prisma.CandleWhereInput = {
      symbolId: ids.symbolId,
      timeframeId: ids.timeframeId,
    };
    if (q.fromMs !== undefined || q.toMs !== undefined) {
      const openTime: Prisma.BigIntFilter = {};
      if (q.fromMs !== undefined) openTime.gte = BigInt(q.fromMs);
      if (q.toMs !== undefined) openTime.lt = BigInt(q.toMs);
      where.openTime = openTime;
    }

    const limit = Math.min(q.limit ?? 500, MAX_QUERY_LIMIT);

    const rows = await this.prisma.candle.findMany({
      where,
      orderBy: { openTime: "asc" },
      take: limit,
    });
    return rows.map((row) => this.fromRow(row, q.symbol, q.timeframe));
  }

  async getLatestOpen(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<Candle | null> {
    const ids = await this.resolveIds(symbol, timeframe);
    const row = await this.prisma.candle.findFirst({
      where: { symbolId: ids.symbolId, timeframeId: ids.timeframeId },
      orderBy: { openTime: "desc" },
    });
    return row ? this.fromRow(row, symbol, timeframe) : null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async resolveIds(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<SymbolTimeframeIds> {
    const cachedSym = this.symbolCache.get(symbol);
    const cachedTf = this.timeframeCache.get(timeframe);
    if (cachedSym && cachedTf) {
      return { symbolId: cachedSym, timeframeId: cachedTf };
    }

    if (!this.pendingResolve) {
      this.pendingResolve = this.loadIdMaps().finally(() => {
        this.pendingResolve = null;
      });
    }
    const { symbols, timeframes } = await this.pendingResolve;

    let symbolId = this.symbolCache.get(symbol);
    if (!symbolId) {
      const existing = symbols.find((s) => s.symbol === symbol.toUpperCase());
      if (!existing) {
        throw new Error(
          `Symbol "${symbol}" not found in DB. Run SymbolSyncService first.`,
        );
      }
      this.symbolCache.set(symbol, existing.id);
      symbolId = existing.id;
    }
    let timeframeId = this.timeframeCache.get(timeframe);
    if (!timeframeId) {
      const existing = timeframes.find((t) => t.code === timeframe);
      if (!existing) {
        throw new Error(`Timeframe "${timeframe}" not found in DB.`);
      }
      this.timeframeCache.set(timeframe, existing.id);
      timeframeId = existing.id;
    }
    if (!symbolId || !timeframeId) {
      throw new Error("resolveIds returned undefined IDs");
    }
    return { symbolId, timeframeId };
  }

  private requireIds(symbol: string, timeframe: Timeframe): SymbolTimeframeIds {
    const symbolId = this.symbolCache.get(symbol);
    const timeframeId = this.timeframeCache.get(timeframe);
    if (!symbolId || !timeframeId) {
      throw new Error(`Missing IDs for ${symbol}@${timeframe}; call resolveIds first`);
    }
    return { symbolId, timeframeId };
  }

  private async loadIdMaps(): Promise<{
    symbols: SymbolRow[];
    timeframes: TimeframeRow[];
  }> {
    const [symbols, timeframes] = await Promise.all([
      this.prisma.symbol.findMany({ select: { id: true, symbol: true } }),
      this.prisma.timeframe.findMany({
        select: { id: true, code: true },
      }),
    ]);
    return { symbols, timeframes };
  }

  private toRow(
    candle: Candle,
    ids: SymbolTimeframeIds,
  ): Prisma.CandleUncheckedCreateInput {
    return {
      symbolId: ids.symbolId,
      timeframeId: ids.timeframeId,
      openTime: BigInt(candle.openTime),
      closeTime: BigInt(candle.closeTime),
      open: new Prisma.Decimal(candle.open),
      high: new Prisma.Decimal(candle.high),
      low: new Prisma.Decimal(candle.low),
      close: new Prisma.Decimal(candle.close),
      volume: new Prisma.Decimal(candle.volume),
      quoteVolume: new Prisma.Decimal(candle.quoteVolume),
      trades: candle.trades,
    };
  }

  private toUpdateRow(candle: Candle): Prisma.CandleUpdateInput {
    return {
      closeTime: BigInt(candle.closeTime),
      open: new Prisma.Decimal(candle.open),
      high: new Prisma.Decimal(candle.high),
      low: new Prisma.Decimal(candle.low),
      close: new Prisma.Decimal(candle.close),
      volume: new Prisma.Decimal(candle.volume),
      quoteVolume: new Prisma.Decimal(candle.quoteVolume),
      trades: candle.trades,
    };
  }

  private fromRow(
    row: CandleRow,
    symbol: string,
    timeframe: Timeframe,
  ): Candle {
    return {
      symbol,
      timeframe,
      openTime: Number(row.openTime),
      closeTime: Number(row.closeTime),
      open: this.toNum(row.open),
      high: this.toNum(row.high),
      low: this.toNum(row.low),
      close: this.toNum(row.close),
      volume: this.toNum(row.volume),
      quoteVolume: this.toNum(row.quoteVolume),
      trades: row.trades,
    };
  }

  private toNum(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value);
    if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }
}
