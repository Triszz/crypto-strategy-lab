import type { NewsProviderAdapter } from "../domain/news.entity";

/**
 * Configuration entry for a registered news adapter.
 *
 * - `code`       : unique stable identifier (matches `providerCode`).
 * - `factory`    : lazy constructor; called only when the adapter is enabled,
 *                  so missing API keys do not crash app startup.
 * - `enabled`    : whether to include this adapter in the aggregator.
 *                  Resolved from env at startup, but can be flipped at runtime.
 * - `priority`   : lower runs first. Useful when you want a primary source
 *                  (e.g. paid CryptoCompare) to be tried before fallbacks.
 * - `weight`     : reserved for weighted dedup / blending (default 1).
 * - `requiresApiKey`: whether the factory needs an env-based secret.
 *                  Used to log a clear warning instead of throwing.
 */
export interface AdapterRegistration {
  code: string;
  factory: () => NewsProviderAdapter | null; // null = disabled (e.g. no key)
  enabled: boolean;
  priority: number;
  weight?: number;
  requiresApiKey?: boolean;
  /** Optional human-readable label for logs. */
  label?: string;
}

/**
 * Central, in-process registry for all `NewsProviderAdapter` implementations.
 *
 * Why a registry (and not a hard-coded switch in `adapter-factory`)?
 *
 *  1. Add/remove an adapter without touching `adapter-factory.ts`.
 *     Just import the adapter module once (side-effect import) — the
 *     adapter self-registers via `register()`.
 *
 *  2. Enable/disable adapters at runtime via env (NEWS_PROVIDERS) or via
 *     `setEnabled(code, true)` from any caller (e.g. an admin endpoint).
 *
 *  3. Inspect the full set of known adapters (for health endpoints,
 *     /admin/news/providers, tests, etc.).
 *
 *  4. Order adapters by priority — primary sources before fallbacks.
 *
 * The registry is a singleton (in-process). For multi-process deployments,
 * each process holds its own copy; in MVP this is fine because the
 * configuration comes from env vars which are identical across processes.
 */
export class AdapterRegistry {
  private static instance: AdapterRegistry | null = null;

  private readonly byCode = new Map<string, AdapterRegistration>();

  private constructor() {}

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Register an adapter. If the same code is registered twice, the second
   * call wins (useful for tests that want to swap an implementation).
   */
  public register(entry: AdapterRegistration): void {
    this.byCode.set(entry.code, entry);
  }

  /**
   * Unregister an adapter by code. Returns true if it existed.
   */
  public unregister(code: string): boolean {
    return this.byCode.delete(code);
  }

  /**
   * Enable or disable an adapter at runtime.
   * Returns true if the adapter exists, false otherwise.
   */
  public setEnabled(code: string, enabled: boolean): boolean {
    const entry = this.byCode.get(code);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }

  /**
   * Returns the registration metadata for a single adapter (or undefined).
   * The actual adapter instance is NOT instantiated here — call `resolve()`
   * or use `instantiateAll()`.
   */
  public get(code: string): AdapterRegistration | undefined {
    return this.byCode.get(code);
  }

  /**
   * Returns all registrations sorted by priority (ascending).
   * Includes both enabled and disabled entries.
   */
  public listAll(): AdapterRegistration[] {
    return Array.from(this.byCode.values()).sort(
      (a, b) => a.priority - b.priority,
    );
  }

  /**
   * Returns the codes of all enabled adapters, ordered by priority.
   * This is the canonical "what providers should we crawl right now?"
   * query.
   */
  public listEnabledCodes(): string[] {
    return this.listAll()
      .filter((e) => e.enabled)
      .map((e) => e.code);
  }

  /**
   * Instantiates every enabled adapter (skipping factories that return null,
   * e.g. when an API key is missing). Failures during construction are
   * caught and logged so one bad adapter cannot break the rest.
   *
   * @param onWarn callback used for logging; defaults to console.warn.
   */
  public instantiateAll(onWarn: (msg: string) => void = console.warn): NewsProviderAdapter[] {
    const enabled = this.listAll().filter((e) => e.enabled);
    const result: NewsProviderAdapter[] = [];

    for (const entry of enabled) {
      try {
        const adapter = entry.factory();
        if (adapter) {
          result.push(adapter);
        } else if (entry.requiresApiKey) {
          onWarn(
            `[AdapterRegistry] "${entry.code}" requires an API key that is not set; skipping.`,
          );
        }
      } catch (err) {
        onWarn(
          `[AdapterRegistry] Failed to instantiate "${entry.code}": ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * Test helper: wipe all registrations.
   */
  public static reset(): void {
    if (AdapterRegistry.instance) {
      AdapterRegistry.instance.byCode.clear();
    }
  }
}

/**
 * Convenience accessor.
 */
export const adapterRegistry = AdapterRegistry.getInstance();
