/**
 * Health endpoint smoke test.
 *
 * Verifies that:
 *  - GET /api/health returns HTTP 200,
 *  - the response body matches the agreed envelope
 *    ({ success: true, service: 'crypto-strategy-lab-backend', status: 'ok' }),
 *  - the response includes the supplemental fields expected by the
 *    implementation (env, uptimeSeconds, timestamp).
 *
 * Process env defaults are installed by `./setup.ts` (a Vitest
 * `setupFiles` entry) so that `loadEnv()` at module top level does
 * not throw.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import type { Application } from "express";

let app: Application;

beforeAll(() => {
  app = createApp();
});

describe("GET /api/health", () => {
  it("returns 200 with the expected envelope", async () => {
    const res = await request(app).get("/api/health").expect(200);

    expect(res.body).toMatchObject({
      success: true,
      service: "crypto-strategy-lab-backend",
      status: "ok",
    });

    expect(typeof res.body.env).toBe("string");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });

  it("exposes a root welcome response", async () => {
    const res = await request(app).get("/").expect(200);
    expect(res.body).toMatchObject({
      success: true,
      service: "crypto-strategy-lab-backend",
    });
  });

  it("returns 404 with the standard error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist").expect(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});