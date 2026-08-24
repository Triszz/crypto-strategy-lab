import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../../shared/logger/logger";
import { getPrismaClient } from "../../../infrastructure/database/prisma";
import type { BinanceRestAdapter } from "../infrastructure/BinanceRestAdapter";

export interface SymbolSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  deactivated: number;
}

/**
 * Synchronises the local `symbols` table against the Binance
 * `/exchangeInfo` endpoint. Only USDT-quoted, spot-tradable rows are
 * stored. Existing rows are kept active unless they disappear from the
 * upstream feed.
 *
 * Uses individual upserts (not a long-running transaction) so it works
 * correctly behind Supabase PgBouncer in "transaction" pooling mode.
 */
export class SymbolSyncService {
  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly rest: BinanceRestAdapter,
    private readonly logger: Logger,
  ) {}

  async syncSymbols(): Promise<SymbolSyncResult> {
    const info = await this.rest.fetchExchangeInfo();

    const filtered = info.symbols.filter(
      (s) =>
        s.quoteAsset === "USDT" &&
        s.status === "TRADING" &&
        (s.isSpotTradingAllowed ?? true),
    );
    this.logger.info(
      { total: info.symbols.length, kept: filtered.length },
      "market-data.symbols.fetched",
    );

    // Load existing symbols once
    const existing = await this.prisma.symbol.findMany({
      select: { id: true, symbol: true, isActive: true },
    });
    const existingMap = new Map(existing.map((s) => [s.symbol, s]));
    const upstream = new Set(filtered.map((s) => s.symbol));

    let inserted = 0;
    let reactivated = 0;

    // Process in chunks of 50 to avoid overwhelming the connection pool
    const CHUNK = 50;
    for (let i = 0; i < filtered.length; i += CHUNK) {
      const chunk = filtered.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map((s) =>
          this.upsertSymbol(s.symbol, s.baseAsset, s.quoteAsset).then(
            (wasNew) => {
              if (wasNew) inserted++;
              else {
                const row = existingMap.get(s.symbol);
                if (row && !row.isActive) reactivated++;
              }
            },
          ),
        ),
      );
    }

    // Deactivate symbols that are no longer on Binance
    const toDeactivate = existing.filter(
      (row) => row.isActive && !upstream.has(row.symbol),
    );
    let deactivated = 0;
    if (toDeactivate.length > 0) {
      // Batch deactivate in chunks
      for (let i = 0; i < toDeactivate.length; i += CHUNK) {
        const chunk = toDeactivate.slice(i, i + CHUNK);
        const result = await this.prisma.symbol.updateMany({
          where: { id: { in: chunk.map((r) => r.id) } },
          data: { isActive: false },
        });
        deactivated += result.count;
      }
    }

    this.logger.info(
      {
        fetched: filtered.length,
        inserted,
        reactivated,
        deactivated,
      },
      "market-data.symbols.synced",
    );

    return {
      fetched: filtered.length,
      inserted,
      updated: reactivated,
      deactivated,
    };
  }

  /**
   * Single upsert — atomic INSERT ON CONFLICT UPDATE, no explicit transaction
   * needed. Each call is a short round-trip and works fine behind PgBouncer.
   */
  private async upsertSymbol(
    symbol: string,
    baseAsset: string,
    quoteAsset: string,
  ): Promise<boolean> {
    try {
      await this.prisma.symbol.upsert({
        where: { symbol },
        create: { symbol, baseAsset, quoteAsset, isActive: true },
        update: {
          baseAsset,
          quoteAsset,
          isActive: true,
        },
      });
      return true; // inserted or updated
    } catch (err) {
      // Defensive: if a concurrent upsert won, that's fine
      this.logger.warn(
        { err: (err as Error).message, symbol },
        "symbol.upsert.failed",
      );
      return false;
    }
  }
}
