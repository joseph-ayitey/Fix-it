// /api/team: see "Team" in openapi.yaml. These lists are small and bounded, so they come
// back as a single page (page.nextCursor is always null).

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findWorkers, listLandlordsFor, listWorkers, removeWorker } from "../models/team.js";
import { notFound } from "../utils/errors.js";
import { singlePage } from "../utils/pagination.js";
import { parseId } from "../utils/validate.js";

const DIRECTORY_LIMIT = 50;

const router = Router();
router.use(requireAuth);

// GET /api/team/workers: workers who have accepted the landlord's jobs
router.get("/workers", requireRole("landlord"), async (req, res) => {
  res.json(singlePage(await listWorkers(req.user)));
});

// DELETE /api/team/workers/:workerId: stop working with them (unassigns their active jobs)
router.delete("/workers/:workerId", requireRole("landlord"), async (req, res) => {
  const workerId = parseId(req.params.workerId);
  if (!workerId) throw notFound("that worker isn't on your team");
  res.json({ unassignedIssues: await removeWorker(req.user, workerId) });
});

// GET /api/team/landlords: the landlords a worker works for
router.get("/landlords", requireRole("worker"), async (req, res) => {
  res.json(singlePage(await listLandlordsFor(req.user)));
});

// GET /api/team/directory?trade=&city=: find workers by trade (no contact details)
router.get("/directory", requireRole("landlord"), async (req, res) => {
  const { trade, city } = req.query;
  res.json(singlePage(await findWorkers(req.user, { trade, city: city?.trim() || null }), DIRECTORY_LIMIT));
});

export default router;
