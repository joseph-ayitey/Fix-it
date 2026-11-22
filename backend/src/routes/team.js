import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findWorkers, listLandlordsFor, listWorkers, removeWorker } from "../models/team.js";
import { TRADES } from "../utils/people.js";
import { forbidden, notFound } from "../utils/errors.js";
import { parseId, validate } from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

// GET /api/team: landlord -> { workers } (who has accepted their jobs); worker -> { landlords }
router.get("/", async (req, res) => {
  if (req.user.role === "landlord") return res.json({ workers: await listWorkers(req.user) });
  if (req.user.role === "worker") return res.json({ landlords: await listLandlordsFor(req.user) });
  throw forbidden("teams are for landlords and workers");
});

// GET /api/team/directory?trade=&city=: landlord finds workers by trade (no contact details)
router.get("/directory", requireRole("landlord"), async (req, res) => {
  const { trade, city } = validate(req.query, { trade: { oneOf: Object.keys(TRADES) }, city: { max: 200 } });
  res.json(await findWorkers(req.user, { trade, city }));
});

// DELETE /api/team/:workerId: stop working with them (unassigns their active jobs)
router.delete("/:workerId", requireRole("landlord"), async (req, res) => {
  const workerId = parseId(req.params.workerId);
  if (!workerId) throw notFound("that worker isn't on your team");
  res.json({ unassignedIssues: await removeWorker(req.user, workerId) });
});

export default router;
