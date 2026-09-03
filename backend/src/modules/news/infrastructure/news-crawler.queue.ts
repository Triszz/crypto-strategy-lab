import { logger as defaultLogger, Logger } from "../../../shared/logger/logger";
import { NewsItem } from "../domain/news.entity";

/**
 * Status mirrors the lifecycle of a single crawl job. The shape mirrors
 * `BacktestJobProgress` so the FE can reuse a single polling helper.
 */
export type NewsCrawlStatus = "WAITING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface NewsCrawlProgress {
  jobId: string;
  symbols: string[];
  status: NewsCrawlStatus;
  startedAt: string;
  finishedAt?: string;
  totalSaved: number;
  totalFetched: number;
  errors: { symbol: string; message: string }[];
}

export type NewsCrawlFn = (symbol?: string) => Promise<NewsItem[]>;

/**
 * Periodic news crawler.
 *
 * Phase A.4 in `News_Module_Analysis.md`. Runs as a singleton:
 *  - `start(intervalMs)` registers `setInterval` and fires one initial
 *    crawl immediately so the dashboard is populated without waiting
 *    a full period.
 *  - Each tick adds a job to `jobProgressMap`, processes it on
 *    `setImmediate`, and updates status as it goes.
 *  - `crawlNow(symbols?)` exposes the same path for ad-hoc triggers
 *    (admin, tests).
 *  - `stop()` clears the interval. Used by graceful shutdown.
 *
 * The queue intentionally mirrors the shape of `BacktestQueue` (in
 * the backtest module) so the codebase has one mental model for
 * background jobs. We deliberately do NOT use BullMQ/Redis yet:
 *  - For MVP we run a single backend process, so an in-memory map is
 *    sufficient and zero-config.
 *  - Migrating to BullMQ later is a localised change: only this file
 *    talks to the map; swapping it for a `Queue` from BullMQ would not
 *    touch the rest of the module.
 */
export class NewsCrawlerQueue {
  private static instance: NewsCrawlerQueue | null = null;
  private readonly jobProgressMap: Map<string, NewsCrawlProgress> = new Map();
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  private constructor(
    private readonly crawlFn: NewsCrawlFn,
    private readonly defaultSymbols: string[],
    private readonly logger: Logger = defaultLogger,
  ) {}

  public static getInstance(
    crawlFn?: NewsCrawlFn,
    defaultSymbols?: string[],
    logger?: Logger,
  ): NewsCrawlerQueue {
    if (!NewsCrawlerQueue.instance) {
      if (!crawlFn) {
        throw new Error(
          "NewsCrawlerQueue.getInstance() requires crawlFn on first call",
        );
      }
      NewsCrawlerQueue.instance = new NewsCrawlerQueue(
        crawlFn,
        defaultSymbols ?? ["BTC", "ETH", "SOL"],
        logger,
      );
    }
    return NewsCrawlerQueue.instance;
  }

  /**
   * For tests: drop the cached singleton so the next `getInstance()`
   * call re-initialises with fresh dependencies.
   */
  public static resetInstance(): void {
    NewsCrawlerQueue.instance = null;
  }

  /**
   * Starts the periodic crawler. Idempotent — calling twice is a no-op.
   * `intervalMs` defaults to 5 minutes. Pass `0` to run only one
   * initial crawl and skip the periodic timer (useful in tests, or
   * when env disables the cron).
   */
  public start(intervalMs: number = 5 * 60 * 1000): void {
    if (this.running) {
      this.logger.debug("News crawler already running; start() ignored");
      return;
    }
    this.running = true;
    this.logger.info(
      {
        event: "news.crawler.start",
        intervalMs,
        periodic: intervalMs > 0,
        symbols: this.defaultSymbols,
      },
      "News crawler started",
    );

    // Kick off an immediate run so /news has data without waiting a
    // full interval on first start.
    void this.crawlNow();

    if (intervalMs > 0) {
      this.intervalHandle = setInterval(() => {
        void this.crawlNow();
      }, intervalMs);
      // Don't keep the process alive just for the crawler.
      this.intervalHandle.unref?.();
    } else {
      this.logger.debug(
        { event: "news.crawler.start.periodic_disabled" },
        "Periodic crawl disabled (interval=0); only initial run scheduled",
      );
    }
  }

  public stop(): void {
    if (!this.running) return;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    this.logger.info(
      { event: "news.crawler.stop" },
      "News crawler stopped",
    );
  }

  /**
   * Enqueue an ad-hoc crawl. Returns the jobId so the caller can poll
   * `getJobStatus(jobId)`. The actual work happens on the next tick
   * (mirrors `BacktestQueue.addJob`).
   */
  public crawlNow(symbols?: string[]): string {
    const jobId = `news-crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const progress: NewsCrawlProgress = {
      jobId,
      symbols: symbols && symbols.length > 0 ? symbols : [...this.defaultSymbols],
      status: "WAITING",
      startedAt: new Date().toISOString(),
      totalSaved: 0,
      totalFetched: 0,
      errors: [],
    };
    this.jobProgressMap.set(jobId, progress);

    setImmediate(() => {
      void this.processJob(jobId);
    });

    return jobId;
  }

  public getJobStatus(jobId: string): NewsCrawlProgress | null {
    return this.jobProgressMap.get(jobId) ?? null;
  }

  /** Most recent jobs first. Capped for safety. */
  public getRecentJobs(limit: number = 20): NewsCrawlProgress[] {
    return Array.from(this.jobProgressMap.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  private async processJob(jobId: string): Promise<void> {
    const job = this.jobProgressMap.get(jobId);
    if (!job) return;

    job.status = "RUNNING";
    this.logger.info(
      { event: "news.crawler.job.start", jobId, symbols: job.symbols },
      `News crawl job ${jobId} started`,
    );

    let totalSaved = 0;
    let totalFetched = 0;

    for (const symbol of job.symbols) {
      try {
        const items = await this.crawlFn(symbol);
        totalFetched += items.length;
        totalSaved += items.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job.errors.push({ symbol, message });
        this.logger.error(
          { event: "news.crawler.job.symbol_error", jobId, symbol, err: message },
          `Crawl failed for symbol ${symbol}`,
        );
      }
    }

    job.totalSaved = totalSaved;
    job.totalFetched = totalFetched;
    job.status = job.errors.length === job.symbols.length ? "FAILED" : "COMPLETED";
    job.finishedAt = new Date().toISOString();

    this.logger.info(
      {
        event: "news.crawler.job.done",
        jobId,
        status: job.status,
        totalFetched,
        totalSaved,
        errorCount: job.errors.length,
        durationMs: new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
      },
      `News crawl job ${jobId} ${job.status}`,
    );
  }
}

/**
 * Convenience accessor. Mirrors `getBacktestQueue()`.
 */
export function getNewsCrawlerQueue(
  crawlFn?: NewsCrawlFn,
  defaultSymbols?: string[],
  logger?: Logger,
): NewsCrawlerQueue {
  return NewsCrawlerQueue.getInstance(crawlFn, defaultSymbols, logger);
}
