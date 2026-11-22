import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  addComment,
  CATEGORIES,
  changeStatus,
  confirmFix,
  createIssue,
  getIssueFor,
  getPhotoFor,
  listIssuesFor,
  STATUSES,
  summaryFor,
  unassignIssue,
  URGENCIES,
  VISIBILITIES,
} from "../models/issues.js";
import { notFound } from "../utils/errors.js";
import { acceptPhotos } from "../utils/photos.js";
import { parseId, validate } from "../utils/validate.js";

function idParam(req, name = "id", what = "issue") {
  const id = parseId(req.params[name]);
  if (!id) throw notFound(`${what} not found`);
  return id;
}

const router = Router();
router.use(requireAuth);

// GET /api/issues?status=active|open|in_progress|resolved|closed&propertyId=&assignment=assigned|unassigned
router.get("/", async (req, res) => {
  const { status, propertyId, assignment } = validate(req.query, {
    status: { oneOf: ["active", ...STATUSES] },
    propertyId: { type: "integer" },
    assignment: { oneOf: ["assigned", "unassigned"] },
  });
  res.json(await listIssuesFor(req.user, { status, propertyId, assignment }));
});

// GET /api/issues/summary: dashboard counts
router.get("/summary", async (req, res) => {
  res.json(await summaryFor(req.user));
});

// POST /api/issues: tenant reports. Either JSON, or multipart/form-data with the same
// fields plus up to 5 image files in "photos". acceptPhotos ignores JSON requests.
router.post("/", requireRole("tenant"), acceptPhotos, async (req, res) => {
  const input = validate(req.body, {
    propertyId: { type: "integer", required: true },
    title: { required: true, min: 3, max: 120 },
    description: { required: true, min: 10, max: 5000 },
    category: { required: true, oneOf: CATEGORIES },
    urgency: { oneOf: URGENCIES },
  });
  const issue = await createIssue(req.user, input, req.files);
  res.status(201).location(`/api/issues/${issue.id}`).json(issue);
});

// GET /api/issues/:id: issue + full timeline
router.get("/:id", async (req, res) => {
  res.json(await getIssueFor(req.user, idParam(req)));
});

// POST /api/issues/:id/comments  { body, visibility? }, or multipart with body and/or
// "photos". visibility "internal" = private landlord-worker note, hidden from the tenant.
router.post("/:id/comments", acceptPhotos, async (req, res) => {
  const { body, visibility } = validate(req.body ?? {}, { body: { max: 5000 }, visibility: { oneOf: VISIBILITIES } });
  res.status(201).json(await addComment(req.user, idParam(req), { body, visibility: visibility ?? "shared" }, req.files));
});

// POST /api/issues/:id/confirm  { note? }: tenant "it works" / landlord "work approved".
// The issue closes once both have confirmed.
router.post("/:id/confirm", async (req, res) => {
  const { note } = validate(req.body ?? {}, { note: { max: 5000 } });
  res.json(await confirmFix(req.user, idParam(req), { note }));
});

// GET /api/issues/:id/photos/:photoId: the image itself, only for people who can see
// the issue. Never cached by shared caches, and never content-sniffed by the browser.
router.get("/:id/photos/:photoId", async (req, res) => {
  const photo = await getPhotoFor(req.user, idParam(req), idParam(req, "photoId", "photo"));
  res.set({
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
  });
  res.type(photo.mimeType).sendFile(photo.path, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { message: "photo file is missing" } });
  });
});

// PATCH /api/issues/:id/status  { status, note? }
router.patch("/:id/status", async (req, res) => {
  const input = validate(req.body, {
    status: { required: true, oneOf: STATUSES },
    note: { max: 5000 },
  });
  res.json(await changeStatus(req.user, idParam(req), input));
});

// DELETE /api/issues/:id/assignment: landlord takes the worker off the issue
router.delete("/:id/assignment", requireRole("landlord"), async (req, res) => {
  res.json(await unassignIssue(req.user, idParam(req)));
});

export default router;
