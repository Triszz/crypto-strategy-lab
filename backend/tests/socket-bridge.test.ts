import { describe, it, expect, vi, beforeEach } from "vitest";
import { startSocketEventBridge } from "../src/infrastructure/event-bridge/socket-bridge";
import { getEventBus, resetEventBus } from "../src/shared/event-bus/EventBus";

/**
 * Unit tests for the Socket.IO event bridge.
 *
 * Validates the bridge:
 *  - Forwards `NewsCollected` events from the in-process EventBus
 *    to `io.emit`.
 *  - Preserves the payload shape (FE sees the same fields the service
 *    published).
 *  - `stop()` removes the listener so subsequent publishes don't fire.
 *
 * Uses a minimal mock for `io` — we only need `emit` to be observable.
 */

interface FakeIO {
  emit: ReturnType<typeof vi.fn>;
}

describe("SocketEventBridge", () => {
  let io: FakeIO;

  beforeEach(() => {
    resetEventBus();
    io = { emit: vi.fn() };
  });

  it("forwards NewsCollected payload to io.emit on the same event name", () => {
    const bus = getEventBus();
    const bridge = startSocketEventBridge(io as never);

    const payload = {
      newsId: "n-123",
      title: "BTC surges past 70K",
      summary: "Bullish momentum continues",
      content: null,
      source: "Test",
      url: "https://example.com/n-123",
      publishedAt: new Date("2026-09-02T10:00:00Z"),
      coinSymbols: ["BTC"],
    };

    bus.publish("NewsCollected", payload);

    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(io.emit).toHaveBeenCalledWith("NewsCollected", payload);

    bridge.stop();
  });

  it("does not forward unrelated events", () => {
    const bus = getEventBus();
    const bridge = startSocketEventBridge(io as never);

    bus.publish("SomeOtherEvent", { foo: "bar" });
    bus.publish("SentimentAnalyzed", { newsId: "n-1" });

    expect(io.emit).not.toHaveBeenCalled();

    bridge.stop();
  });

  it("stop() detaches the listener so further publishes are silent", () => {
    const bus = getEventBus();
    const bridge = startSocketEventBridge(io as never);

    bus.publish("NewsCollected", { newsId: "first" });
    expect(io.emit).toHaveBeenCalledTimes(1);

    bridge.stop();

    bus.publish("NewsCollected", { newsId: "second" });
    // Still 1 — second event was not forwarded.
    expect(io.emit).toHaveBeenCalledTimes(1);
  });

  it("swallows io.emit failures without throwing into the publisher", () => {
    const bus = getEventBus();
    const failingIo = { emit: vi.fn(() => { throw new Error("socket closed"); }) };
    const bridge = startSocketEventBridge(failingIo as never);

    // The publisher must NOT throw, even if the bridge's handler throws.
    expect(() => {
      bus.publish("NewsCollected", { newsId: "n-1" });
    }).not.toThrow();

    bridge.stop();
  });
});
