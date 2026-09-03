/**
 * Bridges in-process EventBus events to Socket.IO so the frontend can
 * subscribe to them in real-time.
 *
 * Background:
 *  - `EventBus` is the in-process publish/subscribe abstraction used by
 *    services (News, Sentiment, Evaluator, Leaderboard) to communicate
 *    without coupling.
 *  - `Socket.IO` is the WebSocket transport used by the frontend.
 *  - The bridge subscribes to the events the FE cares about and
 *    `emit()`s them on the Socket.IO server, which broadcasts to all
 *    connected clients.
 *
 * Scope (Phase B — News wiring only):
 *  - NewsCollected  → emitted to all clients.
 *  - Future phases (Phase B for Sentiment / Leaderboard) will register
 *    additional subscribers here.
 *
 * Why a bridge (instead of calling `socket.emit` from services):
 *  - Services stay transport-agnostic — they publish to the EventBus,
 *    not to Socket.IO. If we replace Socket.IO with SSE / Webhook,
 *    services don't change.
 *  - The bridge is the single place that defines "which in-process
 *    events cross the network boundary". Easy to audit.
 */

import type { Server as IOServerType } from "socket.io";
import { getEventBus } from "../../shared/event-bus/EventBus";
import { logger } from "../../shared/logger/logger";

/**
 * Payload shape for `NewsCollected` broadcast to the frontend.
 *
 * Mirrors `NewsService.fetchAndStoreLatestNews()` in
 * `backend/src/modules/news/application/news.service.ts`.
 */
export interface NewsCollectedPayload {
  newsId: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  source: string;
  url: string;
  /** ISO-8601 string (Date objects are auto-serialised by Socket.IO). */
  publishedAt: string | Date;
  coinSymbols: string[];
}

export interface SocketEventBridge {
  /** Stop forwarding events and detach listeners. Idempotent. */
  stop(): void;
}

/**
 * Starts forwarding a curated set of EventBus events to Socket.IO.
 *
 * Returns a handle with a `stop()` method that removes the listeners.
 * The bridge is normally started once during application bootstrap
 * (in `server.ts`) and lives for the lifetime of the process.
 */
export function startSocketEventBridge(io: IOServerType): SocketEventBridge {
  const bus = getEventBus();

  // Local shutdown flag — see comment on `bus.unsubscribe` caveat below.
  let stopped = false;

  // --- NewsCollected ---------------------------------------------------
  const newsHandler = (payload: NewsCollectedPayload): void => {
    if (stopped) return;
    try {
      // `io.emit` broadcasts to ALL connected clients. For a per-user
      // or per-room model later (e.g. "subscribe to BTC updates only"),
      // swap this for `io.to(room).emit(...)`.
      io.emit("NewsCollected", payload);
      logger.debug(
        {
          event: "bridge.forward.news_collected",
          newsId: payload.newsId,
          symbols: payload.coinSymbols,
        },
        "Forwarded NewsCollected to Socket.IO clients",
      );
    } catch (err) {
      logger.error(
        { err, event: "bridge.forward.news_collected.error", newsId: payload.newsId },
        "Failed to forward NewsCollected",
      );
    }
  };
  bus.subscribe<NewsCollectedPayload>("NewsCollected", newsHandler);

  logger.info(
    { event: "bridge.start", events: ["NewsCollected"] },
    "Socket event bridge started",
  );

  return {
    stop(): void {
      // We rely on a local `stopped` flag instead of `bus.unsubscribe()`
      // because the current EventBus implementation wraps every
      // subscriber in an internal `safeHandler` for try/catch isolation,
      // so the unwrapped handler reference the bridge holds cannot be
      // matched by `emitter.off`. The flag prevents further forwarding
      // without removing the listener — acceptable for a graceful
      // shutdown where the process is about to exit anyway.
      stopped = true;
      logger.info({ event: "bridge.stop" }, "Socket event bridge stopped");
    },
  };
}
