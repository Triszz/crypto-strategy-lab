import { Server as IOServer, type Server as IOServerType } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { loadEnv } from "../../config/env";

let io: IOServerType | null = null;

/**
 * Attaches Socket.IO to an existing HTTP server. The factory is called
 * once during startup (in `server.ts`); modules publish realtime
 * updates through `getSocketServer()`, never by instantiating
 * socket.io directly.
 */
export function initSocketServer(httpServer: HttpServer): IOServerType {
  if (io) return io;
  const env = loadEnv();
  const corsOrigins = env.CORS_ORIGINS === "*"
    ? "*"
    : env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

  io = new IOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ["GET", "POST"],
    },
    // Keep the server connection snappy; ping every 25s, allow 60s
    // before declaring a client dead.
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {
      void socket;
    });
  });

  return io;
}

export function getSocketServer(): IOServerType {
  if (!io) {
    throw new Error(
      "Socket server has not been initialised. Call initSocketServer(httpServer) first.",
    );
  }
  return io;
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
}