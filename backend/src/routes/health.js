import { Router } from "express";
import { ping } from "../db/index.js";

/** GET /api/health -> { status, database, geocoding }. 503 if Postgres can't be reached. */
export default function healthRouter({ geocoder }) {
  const router = Router();
  router.get("/", async (_req, res) => {
    const geocoding = geocoder.disabled ? "disabled" : "enabled";
    try {
      await ping();
      res.json({ status: "ok", database: "up", geocoding });
    } catch {
      res.status(503).json({ status: "degraded", database: "down", geocoding });
    }
  });
  return router;
}
