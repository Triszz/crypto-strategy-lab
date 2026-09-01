import { Router } from "express";
import { BacktestController } from "./backtest.controller";

export const backtestRouter: Router = Router();
const controller = new BacktestController();

backtestRouter.post("/run", (req, res) => controller.runBacktest(req, res));
backtestRouter.get("/jobs/:jobId", (req, res) => controller.getJobStatus(req, res));
backtestRouter.get("/:id/trades", (req, res) => controller.getTradesByExperimentId(req, res));
backtestRouter.get("/:id", (req, res) => controller.getBacktestById(req, res));
backtestRouter.get("/", (req, res) => controller.listBacktests(req, res));
