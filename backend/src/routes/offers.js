import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { createOffer, listOffersForWorker, respondToOffer, withdrawOffer } from "../models/offers.js";
import { notFound } from "../utils/errors.js";
import { parseId, validate } from "../utils/validate.js";

const router = Router();
router.use(requireAuth);

function idParam(req) {
  const id = parseId(req.params.id);
  if (!id) throw notFound("offer not found");
  return id;
}

// GET /api/offers: worker's job offers (pending first, then the last 30 days' answers)
router.get("/", requireRole("worker"), async (req, res) => {
  res.json(await listOffersForWorker(req.user));
});

// POST /api/offers  { issueId, workerId, message? }: landlord offers an issue to a worker
router.post("/", requireRole("landlord"), async (req, res) => {
  const input = validate(req.body, {
    issueId: { type: "integer", required: true },
    workerId: { type: "integer", required: true },
    message: { max: 2000 },
  });
  res.status(201).json(await createOffer(req.user, input));
});

// POST /api/offers/:id/accept  { response? }  -> the issue, now assigned to you
router.post("/:id/accept", requireRole("worker"), async (req, res) => {
  const { response } = validate(req.body ?? {}, { response: { max: 2000 } });
  res.json(await respondToOffer(req.user, idParam(req), { accept: true, response }));
});

// POST /api/offers/:id/decline  { response? }  (a reason helps the landlord)
router.post("/:id/decline", requireRole("worker"), async (req, res) => {
  const { response } = validate(req.body ?? {}, { response: { max: 2000 } });
  await respondToOffer(req.user, idParam(req), { accept: false, response });
  res.status(204).end();
});

// POST /api/offers/:id/withdraw: landlord takes back an unanswered offer
router.post("/:id/withdraw", requireRole("landlord"), async (req, res) => {
  res.json(await withdrawOffer(req.user, idParam(req)));
});

export default router;
