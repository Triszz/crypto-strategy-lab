/**
 * strategy · domain · StrategyRegistry (runtime)
 *
 * In-memory plugin registry that resolves a stable `implementationRef`
 * string (matching `StrategyVersion.implementationRef` in the database)
 * to a concrete Strategy factory. This is the *runtime* registry; it
 * is intentionally distinct from the Prisma `StrategyRegistry` table
 * (which is a feature-flag row per `StrategyDefinition`).
 *
 * Architectural invariant: the registry is the ONLY place that maps
 * "id" to "concrete class". Backtest / Search / Evaluation / Leaderboard
 * resolve strategies via `registry.resolve(ref)` without ever
 * branching on `if (ref === "MA")` etc.
 *
 * MUST stay infrastructure-free: no Prisma, no Express, no BullMQ, no
 * Socket.IO, no Binance SDK.
 *
 * Registry is a singleton (process-wide) by default, but the type is
 * exported so tests / future Application services can instantiate a
 * private registry for isolation.
 */
import type { Strategy } from "./Strategy";

export interface StrategyRegistry {
  /** Register a Strategy factory under `strategy.id`. */
  register(strategy: Strategy): void;
  /** Resolve a strategy by `id` (the same string stored in `implementationRef`). */
  resolve(id: string): Strategy | undefined;
  /** Whether the registry knows about `id`. */
  has(id: string): boolean;
  /** All registered strategy ids (sorted alphabetically for determinism). */
  list(): ReadonlyArray<string>;
  /** Remove all registrations. Useful for tests. */
  clear(): void;
}

class InMemoryStrategyRegistry implements StrategyRegistry {
  private readonly factories = new Map<string, Strategy>();

  public register(strategy: Strategy): void {
    if (!strategy || typeof strategy.id !== "string" || strategy.id.length === 0) {
      throw new Error("StrategyRegistry.register: strategy.id must be a non-empty string.");
    }
    if (this.factories.has(strategy.id)) {
      throw new Error(
        `StrategyRegistry.register: strategy "${strategy.id}" is already registered.`,
      );
    }
    this.factories.set(strategy.id, strategy);
  }

  public resolve(id: string): Strategy | undefined {
    return this.factories.get(id);
  }

  public has(id: string): boolean {
    return this.factories.has(id);
  }

  public list(): ReadonlyArray<string> {
    return Array.from(this.factories.keys()).sort();
  }

  public clear(): void {
    this.factories.clear();
  }
}

let singleton: StrategyRegistry | null = null;

/**
 * Returns the process-wide StrategyRegistry singleton. Bootstrapped
 * lazily; the first caller typically also calls `register(...)` for
 * every concrete strategy (see `./bootstrap.ts`).
 */
export function getStrategyRegistry(): StrategyRegistry {
  if (!singleton) {
    singleton = new InMemoryStrategyRegistry();
  }
  return singleton;
}

/** Replaces the process-wide StrategyRegistry. Intended for tests. */
export function setStrategyRegistry(registry: StrategyRegistry): void {
  singleton = registry;
}

/** Resets the process-wide StrategyRegistry. Intended for tests. */
export function resetStrategyRegistry(): void {
  if (singleton) singleton.clear();
  singleton = null;
}