/**
 * Barrel file for the event-bridge layer.
 *
 * Currently exposes only the Socket.IO bridge. Future phases can add
 * a Redis pub/sub bridge here without touching module callers.
 */

export { startSocketEventBridge } from "./socket-bridge";
export type { NewsCollectedPayload, SocketEventBridge } from "./socket-bridge";
