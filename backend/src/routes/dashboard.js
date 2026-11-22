// /api/dashboard: see "Dashboard" in openapi.yaml and decision record 0004.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { activityFor, statsFor } from "../models/dashboard.js";

const router = Router();
router.use(requireAuth);

// GET /api/dashboard/stats: counts, response times, 12-week trend
router.get("/stats", async (req, res) => {
  res.json(await statsFor(req.user));
});

// GET /api/dashboard/activity?limit=&cursor=: newest events first
router.get("/activity", async (req, res) => {
  const { limit, cursor } = req.query;
  res.json(await activityFor(req.user, { limit: limit ? Number(limit) : 20, cursor: cursor ?? null }));
});

export default router;
