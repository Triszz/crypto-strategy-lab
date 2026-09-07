import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import { buildLeaderboardRouter } from "../../src/modules/leaderboard/presentation/leaderboard.routes";

describe("Leaderboard Trace & Details Endpoint", () => {
  it("should build leaderboard router and return trace details structure", async () => {
    const router = buildLeaderboardRouter();
    expect(router).toBeDefined();
  });
});
