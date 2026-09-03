import type { Server as IOServerType } from "socket.io";
import { logger as defaultLogger, Logger } from "../../shared/logger/logger";
import { NewsService } from "./application/news.service";
import { buildNewsAdapter } from "./infrastructure/adapter-factory";
import { PrismaNewsRepository } from "./infrastructure/prisma-news.repository";
import { getNewsCrawlerQueue, NewsCrawlerQueue } from "./infrastructure/news-crawler.queue";
import { startSocketEventBridge, SocketEventBridge } from "../../infrastructure/event-bridge";
import { getOutboxWorker, NewsOutboxWorker } from "./infrastructure/news-outbox.worker";

/**
 * Composition root for the News module. Holds the long-lived singletons
 * (repository, adapter, service, crawler, outbox-worker) so that both the
 * HTTP routes and the background queue share the same instances.
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
 *
 * Phase C additions:
 *  - `buildNewsAdapter()` selects RSS or Cryptopanic based on `NEWS_PROVIDER`
 *    env variable (with graceful fallback if API key is missing).
 *  - `outboxWorker` polls `QueueJob` for PENDING outbox rows and publishes
 *    them via the EventBus, then marks them PUBLISHED or FAILED.
 */

export interface NewsContainer {
  service: NewsService;
  crawler: NewsCrawlerQueue;
  socketBridge: SocketEventBridge;
  outboxWorker: NewsOutboxWorker;
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
  const adapter = buildNewsAdapter(); // Phase C: factory-selected adapter
  const service = new NewsService(repository, adapter, logger);

  const crawler = getNewsCrawlerQueue(
    (symbol?: string) => service.fetchAndStoreLatestNews(symbol),
    defaultSymbols,
    logger,
  );

  const socketBridge = io ? startSocketEventBridge(io) : noopBridge;

  // Phase C.6: start the outbox worker
  const outboxWorker = getOutboxWorker(logger);

  container = { service, crawler, socketBridge, outboxWorker };
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
  if (container?.outboxWorker) {
    container.outboxWorker.stop();
  }
  container = null;
  NewsCrawlerQueue.resetInstance();
}
