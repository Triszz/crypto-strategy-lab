import { getEventBus, type EventBus } from "../../../shared/event-bus/EventBus";
import {
  MARKET_DATA_EVENTS,
  type CandleClosedEventPayload,
} from "../domain/events";
import type { CandleRepository } from "../domain/CandleRepository.port";

/**
 * Persists `CandleClosed` events emitted onto the in-process EventBus
 * to the `candles` table. Lives separately from `BinanceWsAdapter`
 * so other transports (e.g. a CSV loader, alternate exchange adapter)
 * can produce the same events without duplicating persistence logic.
 */
export class CandlePersister {
  private dispose: (() => void) | null = null;

  constructor(
    private readonly repo: CandleRepository,
    private readonly bus: EventBus = getEventBus(),
  ) {}

  start(): void {
    if (this.dispose) return;
    this.bus.subscribe<CandleClosedEventPayload>(
      MARKET_DATA_EVENTS.CANDLE_CLOSED,
      (candle) => {
        void this.persist(candle);
      },
    );
    this.dispose = (): void => {
      this.bus.unsubscribe(MARKET_DATA_EVENTS.CANDLE_CLOSED, () => undefined);
    };
  }

  stop(): void {
    if (this.dispose) {
      this.dispose();
      this.dispose = null;
    }
  }

  private async persist(c: CandleClosedEventPayload): Promise<void> {
    try {
      await this.repo.upsert({
        symbol: c.symbol,
        timeframe: c.timeframe as never,
        openTime: c.candle.openTime,
        closeTime: c.candle.closeTime,
        open: c.candle.open,
        high: c.candle.high,
        low: c.candle.low,
        close: c.candle.close,
        volume: c.candle.volume,
        quoteVolume: c.candle.quoteVolume,
        trades: c.candle.trades,
      });
    } catch (err) {
      // Silently ignore persistence errors to reduce log noise
    }
  }
}
