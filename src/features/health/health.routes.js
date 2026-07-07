import express from "express";
import { config } from "../../core/config.js";
import { adminService } from "../admin/AdminService.js";

export const healthRouter = express.Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "ddato-drive",
    version: "0.1.0",
    port: config.port,
    dataDir: config.dataDir,
    storage: adminService.getStorageSummary(),
    uptimeSeconds: Math.round(process.uptime())
  });
});
