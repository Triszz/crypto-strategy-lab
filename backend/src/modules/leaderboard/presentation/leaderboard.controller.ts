import { Request, Response } from "express";
import { LeaderboardService } from "../application/leaderboard.service";
import { ApiResponse } from "../../../shared/types";
import { LeaderboardFilterOptions } from "../domain/leaderboard.entity";

export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  public getTopK = async (req: Request, res: Response): Promise<void> => {
    try {
      const symbol = req.query.symbol as string | undefined;
      const symbolId = req.query.symbolId as string | undefined;
      const timeframe = req.query.timeframe as string | undefined;
      const strategyType = req.query.strategyType as string | undefined;
      const sortBy = req.query.sortBy as LeaderboardFilterOptions["sortBy"];
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const items = await this.leaderboardService.getTopK({
        symbol,
        symbolId,
        timeframe,
        strategyType,
        sortBy,
        limit,
      });

      const response: ApiResponse<typeof items> = {
        success: true,
        data: items,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "LEADERBOARD_FETCH_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };

  public getHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { strategyVersionId } = req.params;
      if (!strategyVersionId) {
        const response: ApiResponse<null> = {
          success: false,
          error: { code: "MISSING_PARAM", message: "strategyVersionId is required" },
        };
        res.status(400).json(response);
        return;
      }
      const history = await this.leaderboardService.getRankHistory(strategyVersionId);

      const response: ApiResponse<typeof history> = {
        success: true,
        data: history,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "LEADERBOARD_HISTORY_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };
}
