// /api/issues: see "Issues" in openapi.yaml. By the time a handler runs, the contract
// validator has already checked the request (types, required fields, allowed values);
// validate() here only normalises it (trims text, turns "" into null).

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addComment,
  changeStatus,
  confirmFix,
  createIssue,
  getIssueFor,
  getPhotoFor,
  listIssuesFor,
  summaryFor,
  unassignIssue,
} from "../models/issues.js";
import { notFound } from "../utils/errors.js";
import { DEFAULT_LIMIT } from "../utils/pagination.js";
import { problem } from "../utils/problems.js";
import { parseId, validate } from "../utils/validate.js";

function idParam(req, name = "issueId", what = "issue") {
  const id = parseId(req.params[name]);
  if (!id) throw notFound(`${what} not found`);
  return id;
}

const router = Router();
router.use(requireAuth);

// GET /api/issues: filtered, sorted, cursor-paginated list
router.get("/", async (req, res) => {
  const q = req.query;
  res.json(
    await listIssuesFor(req.user, {
      status: q.status,
      propertyId: q.propertyId ? Number(q.propertyId) : null,
      assignment: q.assignment,
      urgency: q.urgency,
      category: q.category,
      q: q.q?.trim() || null,
      sort: q.sort ?? "priority",
      limit: q.limit ? Number(q.limit) : DEFAULT_LIMIT,
      cursor: q.cursor ?? null,
    }),
  );
});

// GET /api/issues/summary: dashboard counts
router.get("/summary", async (req, res) => {
  res.json(await summaryFor(req.user));
});

// POST /api/issues: tenant reports (JSON, or multipart with photos parsed in server.js)
router.post("/", requireRole("tenant"), async (req, res) => {
  const input = validate(req.body, {
    propertyId: { type: "integer", required: true },
    title: { required: true, min: 3, max: 120 },
    description: { required: true, min: 10, max: 5000 },
    category: { required: true },
    urgency: {},
  });
  const issue = await createIssue(req.user, input, req.files);
  res.status(201).location(`/api/issues/${issue.id}`).json(issue);
});

// GET /api/issues/:issueId: issue + timeline
router.get("/:issueId", async (req, res) => {
  res.json(await getIssueFor(req.user, idParam(req)));
});

// POST /api/issues/:issueId/comments: text and/or photos; visibility "internal" = private
router.post("/:issueId/comments", async (req, res) => {
  const { body, visibility } = validate(req.body ?? {}, { body: { max: 5000 }, visibility: {} });
  res.status(201).json(await addComment(req.user, idParam(req), { body, visibility: visibility ?? "shared" }, req.files));
});

// POST /api/issues/:issueId/confirm: tenant "it works" / landlord "work approved"
router.post("/:issueId/confirm", async (req, res) => {
  const { note } = validate(req.body ?? {}, { note: { max: 5000 } });
  res.json(await confirmFix(req.user, idParam(req), { note }));
});

// GET /api/issues/:issueId/photos/:photoId: the image, only for people who may see it.
// Never cached by shared caches, and never content-sniffed by the browser.
router.get("/:issueId/photos/:photoId", async (req, res) => {
  const photo = await getPhotoFor(req.user, idParam(req), idParam(req, "photoId", "photo"));
  res.set({
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  });
  res.type(photo.mimeType).sendFile(photo.path, (err) => {
    if (err && !res.headersSent) {
      res.status(404).type("application/problem+json").send(JSON.stringify(problem(404, { detail: "the photo file is missing" })));
    }
  });
});

// PATCH /api/issues/:issueId/status  { status, note? }
router.patch("/:issueId/status", async (req, res) => {
  const input = validate(req.body, { status: { required: true }, note: { max: 5000 } });
  res.json(await changeStatus(req.user, idParam(req), input));
});

// DELETE /api/issues/:issueId/assignment: landlord takes the worker off the issue
router.delete("/:issueId/assignment", requireRole("landlord"), async (req, res) => {
  res.json(await unassignIssue(req.user, idParam(req)));
});

export default router;
