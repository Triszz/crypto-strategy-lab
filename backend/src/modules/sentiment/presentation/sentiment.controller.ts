import { Request, Response } from "express";
import { SentimentService } from "../application/sentiment.service";
import { ApiResponse } from "../../../shared/types";

export class SentimentController {
  constructor(private readonly sentimentService: SentimentService) {}

  public getSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const symbol = req.query.symbol as string | undefined;
      const summary = await this.sentimentService.getSentimentSummary(symbol);

      const response: ApiResponse<typeof summary> = {
        success: true,
        data: summary,
        meta: { timestamp: new Date().toISOString() },
      };
      res.json(response);
    } catch (err) {
      const response: ApiResponse<null> = {
        success: false,
        error: { code: "SENTIMENT_SUMMARY_ERROR", message: (err as Error).message },
      };
      res.status(500).json(response);
    }
  };
}
