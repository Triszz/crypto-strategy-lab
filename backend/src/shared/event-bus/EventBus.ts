import { EventEmitter } from "node:events";
import { logger } from "../logger/logger";

/**
 * Thin abstraction over Node's EventEmitter so that modules depend on
 * an interface, not a concrete implementation. Modules must NOT
 * instantiate EventEmitter directly.
 *
 * The full event catalog (event names + payload schemas) will be
 * defined in a later task. For now we expose a generic publish /
 * subscribe mechanism.
 */
export interface EventBus {
  publish<T>(eventName: string, payload: T): void;
  subscribe<T>(eventName: string, handler: (payload: T) => void): void;
  /** Remove a previously registered handler. */
  unsubscribe(eventName: string, handler: (payload: unknown) => void): void;
  /** Tear down all internal listeners. Mostly used by tests. */
  dispose(): void;
}

const DEFAULT_MAX_LISTENERS = 50;

class NodeEventEmitterBus implements EventBus {
  private readonly emitter: EventEmitter;

  constructor(maxListeners = DEFAULT_MAX_LISTENERS) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(maxListeners);
  }

  public publish<T>(eventName: string, payload: T): void {
    try {
      this.emitter.emit(eventName, payload);
    } catch (err) {
      // Subscriber exceptions must NEVER bubble into the publisher
      // (see NFR-018: event failure isolation).
      logger.error({ err, eventName }, "Unhandled exception inside event subscriber");
    }
  }

  public subscribe<T>(eventName: string, handler: (payload: T) => void): void {
    // Wrap so a throwing handler does not affect other handlers.
    const safeHandler = (payload: T): void => {
      try {
        handler(payload);
      } catch (err) {
        logger.error({ err, eventName }, "Event handler threw");
      }
    };
    this.emitter.on(eventName, safeHandler as (...args: unknown[]) => void);
  }

  public unsubscribe(eventName: string, handler: (payload: unknown) => void): void {
    this.emitter.off(eventName, handler as (...args: unknown[]) => void);
  }

  public dispose(): void {
    this.emitter.removeAllListeners();
  }
}

let singleton: EventBus | null = null;

/** Returns a process-wide EventBus instance. */
export function getEventBus(): EventBus {
  if (!singleton) {
    singleton = new NodeEventEmitterBus();
  }
  return singleton;
}

/** Replaces the process-wide EventBus. Intended for tests only. */
export function setEventBus(bus: EventBus): void {
  singleton = bus;
}

/** Resets the process-wide EventBus. Intended for tests only. */
export function resetEventBus(): void {
  if (singleton) singleton.dispose();
  singleton = null;
}