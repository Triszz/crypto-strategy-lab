import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../../shared/logger/logger";
import type { MarketDataProvider } from "../core/ports";

export interface SymbolSyncResult {
  total: number;
  upserted: number;
  skipped: number;
}

/**
 * Syncs the `symbols` table with the exchange's current symbol list.
 * Runs once at boot (before candle backfill) to ensure every candle
 * upsert can resolve a valid `symbolId` foreign key.
 *
 * Only TRADING symbols with USDT quote are kept — filters are applied
 * in `SymbolSyncService.syncSymbols`.
 */
export class SymbolSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: MarketDataProvider,
    private readonly logger: Logger,
  ) {}

  async syncSymbols(): Promise<SymbolSyncResult> {
    const symbols = await this.provider.fetchSymbols();
    
    // Filter: only TRADING symbols with USDT quote
    const filtered = symbols.filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        (s.isSpotTradingAllowed === undefined || s.isSpotTradingAllowed === true),
    );

    let upserted = 0;
    let skipped = 0;

    for (const sym of filtered) {
      try {
        await this.prisma.symbol.upsert({
          where: { symbol: sym.symbol },
          create: {
            symbol: sym.symbol,
            baseAsset: sym.baseAsset,
            quoteAsset: sym.quoteAsset,
          },
          update: {
            baseAsset: sym.baseAsset,
            quoteAsset: sym.quoteAsset,
          },
        });
        upserted++;
      } catch (err) {
        this.logger.warn(
          { symbol: sym.symbol, err: (err as Error).message },
          "symbol-sync.upsert-failed",
        );
        skipped++;
      }
    }

    this.logger.info(
      { total: filtered.length, upserted, skipped },
      "symbol-sync.complete",
    );

    return { total: filtered.length, upserted, skipped };
  }
}
