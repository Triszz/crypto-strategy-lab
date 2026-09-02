import type { Server as IOServerType } from "socket.io";
import { logger as defaultLogger, Logger } from "../../shared/logger/logger";
import { NewsService } from "./application/news.service";
import { RSSNewsAdapter } from "./infrastructure/rss-news.adapter";
import { PrismaNewsRepository } from "./infrastructure/prisma-news.repository";
import { getNewsCrawlerQueue, NewsCrawlerQueue } from "./infrastructure/news-crawler.queue";
import { startSocketEventBridge, SocketEventBridge } from "../../infrastructure/event-bridge";

/**
 * Composition root for the News module. Holds the long-lived singletons
 * (repository, adapter, service, crawler) so that both the HTTP routes
 * and the background queue share the same instances — this prevents
 * the "two NewsService instances, two EventBus subscribers" pitfall.
 *
 * Phase A.4 wiring:
 *  - `service` is the same instance used by `routes.ts` and the
 *    `NewsCrawlerQueue`. The crawler calls `service.fetchAndStoreLatestNews`
 *    via a thin function reference (no circular import).
 *  - `crawler` is started/stopped by `server.ts`.
 *
 * Phase B addition:
 *  - `socketBridge` forwards in-process `NewsCollected` events to all
 *    connected Socket.IO clients so the FE can update in real-time.
 *    `io` is passed in by `server.ts` after `initSocketServer()` has
 *    been called. Tests can pass `undefined` to skip the bridge.
 */

export interface NewsContainer {
  service: NewsService;
  crawler: NewsCrawlerQueue;
  socketBridge: SocketEventBridge;
}

/** Internal default no-op bridge used when `io` is undefined (tests). */
const noopBridge: SocketEventBridge = { stop: () => {} };

let container: NewsContainer | null = null;

export function buildNewsContainer(
  defaultSymbols: string[] = ["BTC", "ETH", "SOL"],
  logger: Logger = defaultLogger,
  /** Pass the Socket.IO server to enable `NewsCollected` forwarding. */
  io?: IOServerType,
): NewsContainer {
  if (container) return container;

  const repository = new PrismaNewsRepository();
  const adapter = new RSSNewsAdapter();
  const service = new NewsService(repository, adapter, undefined, logger);

  const crawler = getNewsCrawlerQueue(
    (symbol?: string) => service.fetchAndStoreLatestNews(symbol),
    defaultSymbols,
    logger,
  );

  const socketBridge = io ? startSocketEventBridge(io) : noopBridge;

  container = { service, crawler, socketBridge };
  return container;
}

/**
 * Test-only: clear cached container so the next `buildNewsContainer()`
 * call rebuilds with the new injected dependencies.
 */
export function resetNewsContainer(): void {
  if (container?.socketBridge) {
    container.socketBridge.stop();
  }
  container = null;
  NewsCrawlerQueue.resetInstance();
}
