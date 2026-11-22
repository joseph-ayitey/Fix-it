// Maintenance issues: the heart of FixIt.
//
// Lifecycle (enforced here, not just in the UI):
//
//   open ──worker/landlord──▶ in_progress ──worker/landlord──▶ resolved ──▶ closed
//                                  ▲                               │       (once BOTH the tenant
//                                  └──landlord sends back (reason)─┤        has confirmed it works
//   open ◀──────────────────────────tenant reopens (reason)────────┘        AND the landlord has
//                                                                            approved the work)
//   Also: the tenant can withdraw an open issue; the worker or landlord can go straight from
//   open to resolved (quick fix); a landlord who marks it resolved themselves has approved it
//   by doing so; and a landlord may close it alone once the tenant hasn't replied for
//   RESOLVED_AUTO_CLOSE_DAYS, so silence can't keep an issue open forever.
//
//   "worker" = the worker currently assigned. Workers get assigned only by accepting the
//   landlord's job offer (models/offers.js).
//
// Who sees what:
//   - an issue: the landlord who owns the property, the tenant who reported it, and the
//     assigned worker. Anyone else gets a 404.
//   - timeline entries marked 'internal' (the landlord-worker thread: job offers, private
//     notes, prices): the landlord and the assigned worker only, never the tenant.
//
// Every change writes its timeline entry in the same transaction as the change itself.

import { iso, many, one, params, query, transaction } from "../db/index.js";
import { decodeCursor, DEFAULT_LIMIT, toPage } from "../utils/pagination.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors.js";
import { photoFilePath, removePhotos, storePhotos } from "../utils/photos.js";
import { nameFor, TRADES } from "../utils/people.js";
import { requirePropertyAccess } from "./properties.js";

export const CATEGORIES = ["plumbing", "electrical", "heating", "appliance", "structural", "pest", "security", "other"];
export const URGENCIES = ["low", "normal", "urgent"];
export const STATUSES = ["open", "in_progress", "resolved", "closed"];
export const ACTIVE_STATUSES = ["open", "in_progress"];
export const VISIBILITIES = ["shared", "internal"];
export const RESOLVED_AUTO_CLOSE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const isReporter = (issue, viewer) => viewer.role === "tenant" && issue.reported_by === viewer.id;
const isAssignedWorker = (issue, viewer) => viewer.role === "worker" && issue.assigned_worker_id === viewer.id;
const tenantSilentLongEnough = (issue) => Date.now() - new Date(issue.resolved_at).getTime() >= RESOLVED_AUTO_CLOSE_DAYS * DAY_MS;

/**
 * Status changes `viewer` may make on `issue` (a database row) right now. The API sends
 * this with every issue, so the UI shows exactly the buttons the server will accept.
 */
export function allowedTransitions(issue, viewer) {
  const t = [];
  if (viewer.role === "landlord" || isAssignedWorker(issue, viewer)) {
    if (issue.status === "open") t.push({ to: "in_progress", noteRequired: false }, { to: "resolved", noteRequired: false });
    if (issue.status === "in_progress") t.push({ to: "resolved", noteRequired: false });
  }
  if (viewer.role === "landlord" && issue.status === "resolved") {
    t.push({ to: "in_progress", noteRequired: true }); // send back: the work isn't acceptable
    if (!issue.tenant_confirmed_at && tenantSilentLongEnough(issue)) t.push({ to: "closed", noteRequired: false });
  }
  if (isReporter(issue, viewer)) {
    if (issue.status === "resolved") t.push({ to: "open", noteRequired: true }); // still broken
    if (issue.status === "open") t.push({ to: "closed", noteRequired: false }); // withdraw
  }
  return t;
}

/** May `viewer` confirm this resolved issue now? (tenant: it works; landlord: work approved) */
export function canConfirm(issue, viewer) {
  if (issue.status !== "resolved") return false;
  if (isReporter(issue, viewer)) return !issue.tenant_confirmed_at;
  if (viewer.role === "landlord") return !issue.landlord_confirmed_at;
  return false;
}

const SELECT = `
  SELECT i.*,
         p.label AS property_label, p.address_input AS property_address, p.city AS property_city, p.landlord_id,
         p.latitude AS property_latitude, p.longitude AS property_longitude,
         r.name  AS reporter_name,
         w.name  AS assignee_name, w.trade AS assignee_trade,
         (SELECT count(*) FROM issue_photos ph WHERE ph.issue_id = i.id)::int AS photo_count
  FROM issues i
  JOIN properties p ON p.id = i.property_id
  JOIN users r ON r.id = i.reported_by
  LEFT JOIN users w ON w.id = i.assigned_worker_id
`;

function toIssue(row, viewer) {
  return {
    id: row.id,
    property: {
      id: row.property_id,
      label: row.property_label,
      address: row.property_address,
      city: row.property_city,
      latitude: row.property_latitude,
      longitude: row.property_longitude,
    },
    reporter: { id: row.reported_by, name: nameFor(viewer, { id: row.reported_by, name: row.reporter_name, role: "tenant" }) },
    assignee: row.assigned_worker_id
      ? {
          id: row.assigned_worker_id,
          name: nameFor(viewer, { id: row.assigned_worker_id, name: row.assignee_name, role: "worker" }),
          trade: row.assignee_trade,
          tradeLabel: TRADES[row.assignee_trade] ?? null,
        }
      : null,
    assignedAt: iso(row.assigned_at),
    title: row.title,
    description: row.description,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    acknowledgedAt: iso(row.acknowledged_at),
    resolvedAt: iso(row.resolved_at),
    confirmations: { tenant: iso(row.tenant_confirmed_at), landlord: iso(row.landlord_confirmed_at) },
    closedAt: iso(row.closed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    photoCount: row.photo_count,
    allowedTransitions: allowedTransitions(row, viewer),
    canConfirm: canConfirm(row, viewer),
  };
}

/** Access rule as SQL: issues `viewer` may see. One rule, used everywhere. */
function visibleTo(viewer, p) {
  if (viewer.role === "landlord") return `p.landlord_id = ${p(viewer.id)}`;
  if (viewer.role === "worker") return `i.assigned_worker_id = ${p(viewer.id)}`;
  return `i.reported_by = ${p(viewer.id)}`;
}

/**
 * The issue row if `viewer` may see it, else 404. Pass a transaction client as `q`, and
 * `forUpdate` to lock the row until the transaction ends (so two people confirming at
 * the same moment can't both "close" it).
 */
export async function requireIssueAccess(viewer, id, q, { forUpdate = false } = {}) {
  const p = params();
  const row = await one(
    `${SELECT} WHERE i.id = ${p(id)} AND ${visibleTo(viewer, p)}${forUpdate ? " FOR UPDATE OF i" : ""}`,
    p.values,
    q,
  );
  if (!row) throw notFound("issue not found");
  return row;
}

/** Can `viewer` see timeline entries with this visibility? */
const seesVisibility = (viewer, visibility) => visibility === "shared" || viewer.role !== "tenant";

// Sort orders for the issue list. Each is a list of [SQL expression (for table alias a),
// direction]; the issue id comes last so the order is total (no ties), which cursor
// pagination needs.
const SORTS = {
  // Active before finished, urgent first, then longest-waiting first.
  priority: {
    keys: (a) => [
      `CASE WHEN ${a}.status IN ('open', 'in_progress') THEN 0 ELSE 1 END`,
      `CASE ${a}.urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`,
      `${a}.created_at`,
      `${a}.id`,
    ],
    dir: "ASC",
  },
  newest: { keys: (a) => [`${a}.created_at`, `${a}.id`], dir: "DESC" },
  updated: { keys: (a) => [`${a}.updated_at`, `${a}.id`], dir: "DESC" },
};

/**
 * One page of the issues `viewer` may see.
 * @param {{ status?, propertyId?, assignment?, urgency?, category?, q?, sort?, limit?, cursor? }} filters
 *   status: one of STATUSES, or "active" for open + in_progress
 * @returns {Promise<{ items: object[], page: { limit, nextCursor, hasMore } }>}
 */
export async function listIssuesFor(
  viewer,
  { status, propertyId, assignment, urgency, category, q, sort = "priority", limit = DEFAULT_LIMIT, cursor = null } = {},
) {
  const order = SORTS[sort] ?? SORTS.priority;
  const p = params();
  const where = [visibleTo(viewer, p)];

  if (status === "active") where.push(`i.status IN ('open', 'in_progress')`);
  else if (status) where.push(`i.status = ${p(status)}`);
  if (propertyId) where.push(`i.property_id = ${p(propertyId)}`);
  if (assignment === "unassigned") where.push("i.assigned_worker_id IS NULL");
  if (assignment === "assigned") where.push("i.assigned_worker_id IS NOT NULL");
  if (urgency) where.push(`i.urgency = ${p(urgency)}`);
  if (category) where.push(`i.category = ${p(category)}`);
  if (q) {
    const like = p(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(i.title ILIKE ${like} OR i.description ILIKE ${like})`);
  }

  const afterId = decodeCursor(cursor, sort);
  if (afterId) {
    if (!(await one(`SELECT 1 FROM issues WHERE id = $1`, [afterId]))) decodeCursor("invalid", sort); // throws 400
    // "Rows that sort after the cursor's row": compare the whole sort key as a tuple.
    where.push(`(${order.keys("i").join(", ")}) ${order.dir === "ASC" ? ">" : "<"} (SELECT ${order.keys("c").join(", ")} FROM issues c WHERE c.id = ${p(afterId)})`);
  }

  const rows = await many(
    `${SELECT} WHERE ${where.join(" AND ")}
     ORDER BY ${order.keys("i").map((k) => `${k} ${order.dir}`).join(", ")}
     LIMIT ${p(limit + 1)}`,
    p.values,
  );
  return toPage(rows, limit, sort, (r) => toIssue(r, viewer));
}

export async function getIssueFor(viewer, id) {
  const issue = toIssue(await requireIssueAccess(viewer, id), viewer);
  const tenantView = viewer.role === "tenant";

  const photosByEvent = new Map();
  const photos = await many(
    `SELECT ph.* FROM issue_photos ph JOIN issue_events e ON e.id = ph.event_id
     WHERE ph.issue_id = $1 ${tenantView ? "AND e.visibility = 'shared'" : ""} ORDER BY ph.id`,
    [id],
  );
  for (const ph of photos) {
    if (!photosByEvent.has(ph.event_id)) photosByEvent.set(ph.event_id, []);
    photosByEvent.get(ph.event_id).push({
      id: ph.id,
      url: `/api/issues/${id}/photos/${ph.id}`,
      originalName: ph.original_name,
      mimeType: ph.mime_type,
      sizeBytes: ph.size_bytes,
    });
  }

  const events = await many(
    `SELECT e.*, u.name AS actor_name, u.role AS actor_role, s.name AS subject_name, s.trade AS subject_trade
     FROM issue_events e
     JOIN users u ON u.id = e.actor_id
     LEFT JOIN users s ON s.id = e.subject_id
     WHERE e.issue_id = $1 ${tenantView ? "AND e.visibility = 'shared'" : ""}
     ORDER BY e.id`,
    [id],
  );
  issue.events = events.map((e) => ({
    id: e.id,
    type: e.type,
    visibility: e.visibility,
    actor: { id: e.actor_id, name: nameFor(viewer, { id: e.actor_id, name: e.actor_name, role: e.actor_role }), role: e.actor_role },
    // For assignments and offers: the worker it's about.
    subject: e.subject_id
      ? { id: e.subject_id, name: nameFor(viewer, { id: e.subject_id, name: e.subject_name, role: "worker" }), tradeLabel: TRADES[e.subject_trade] ?? null }
      : null,
    body: e.body,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    createdAt: iso(e.created_at),
    photos: photosByEvent.get(e.id) ?? [],
  }));

  // The landlord also sees the job offers made for this issue.
  if (viewer.role === "landlord") {
    const offers = await many(
      `SELECT o.*, w.name AS worker_name, w.trade AS worker_trade FROM job_offers o JOIN users w ON w.id = o.worker_id
       WHERE o.issue_id = $1 ORDER BY o.id DESC`,
      [id],
    );
    issue.offers = offers.map((o) => ({
      id: o.id,
      status: o.status,
      worker: { id: o.worker_id, name: o.worker_name, trade: o.worker_trade, tradeLabel: TRADES[o.worker_trade] ?? null },
      message: o.message,
      response: o.response,
      createdAt: iso(o.created_at),
      respondedAt: iso(o.responded_at),
    }));
  }
  return issue;
}

async function insertPhotos(client, issueId, eventId, uploaderId, stored) {
  for (const ph of stored) {
    await query(
      `INSERT INTO issue_photos (issue_id, event_id, uploader_id, stored_name, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [issueId, eventId, uploaderId, ph.storedName, ph.originalName, ph.mimeType, ph.sizeBytes],
      client,
    );
  }
}

/**
 * Write the photo files, then run the database work in a transaction. If the database
 * part fails, the files are deleted again so nothing is orphaned on disk.
 */
async function withStoredPhotos(files, dbWork) {
  const stored = await storePhotos(files);
  try {
    return await transaction((client) => dbWork(client, stored));
  } catch (err) {
    await removePhotos(stored);
    throw err;
  }
}

/** @param {Array} photoFiles multer files (may be empty); attached to the 'reported' event */
export async function createIssue(tenant, { propertyId, title, description, category, urgency }, photoFiles = []) {
  if (tenant.role !== "tenant") throw forbidden(`only tenants report issues (you're signed in as a ${tenant.role})`);
  await requirePropertyAccess(tenant, propertyId); // must be a current tenant of this property

  const id = await withStoredPhotos(photoFiles, async (client, stored) => {
    const { id } = await one(
      `INSERT INTO issues (property_id, reported_by, title, description, category, urgency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [propertyId, tenant.id, title, description, category, urgency ?? "normal"],
      client,
    );
    const event = await one(
      `INSERT INTO issue_events (issue_id, actor_id, type, to_status) VALUES ($1, $2, 'reported', 'open') RETURNING id`,
      [id, tenant.id],
      client,
    );
    await insertPhotos(client, id, event.id, tenant.id, stored);
    return id;
  });
  return getIssueFor(tenant, id);
}

/**
 * A comment needs text, photos, or both. `visibility: 'internal'` = the private
 * landlord-worker thread: only the landlord and the assigned worker may write there,
 * and the tenant never sees it.
 */
export async function addComment(viewer, id, { body, visibility = "shared" }, photoFiles = []) {
  const row = await requireIssueAccess(viewer, id);
  if (row.status === "closed") throw conflict("this issue is closed. Report a new one if the problem is back");
  if (!body && !photoFiles.length) throw badRequest("write a comment or attach a photo", [{ field: "body", message: "is required" }]);
  if (visibility === "internal" && viewer.role === "tenant") {
    throw forbidden("private notes are between the landlord and the worker");
  }

  await withStoredPhotos(photoFiles, async (client, stored) => {
    const event = await one(
      `INSERT INTO issue_events (issue_id, actor_id, type, body, visibility) VALUES ($1, $2, 'comment', $3, $4) RETURNING id`,
      [id, viewer.id, body ?? null, visibility],
      client,
    );
    await insertPhotos(client, id, event.id, viewer.id, stored);
    await markTouched(client, id, viewer);
  });
  return getIssueFor(viewer, id);
}

/** A photo's file, only if `viewer` can see the issue AND the timeline entry it's on. */
export async function getPhotoFor(viewer, issueId, photoId) {
  await requireIssueAccess(viewer, issueId);
  const ph = await one(
    `SELECT ph.*, e.visibility FROM issue_photos ph JOIN issue_events e ON e.id = ph.event_id WHERE ph.id = $1 AND ph.issue_id = $2`,
    [photoId, issueId],
  );
  if (!ph || !seesVisibility(viewer, ph.visibility)) throw notFound("photo not found");
  return { path: photoFilePath(ph.stored_name), mimeType: ph.mime_type, originalName: ph.original_name };
}

export async function changeStatus(viewer, id, { status, note }) {
  await transaction(async (client) => {
    const row = await requireIssueAccess(viewer, id, client, { forUpdate: true });
    if (row.status === status) throw conflict(`issue is already ${status.replace("_", " ")}`);

    const transition = allowedTransitions(row, viewer).find((t) => t.to === status);
    if (!transition) {
      throw forbidden(`a ${viewer.role} can't move this issue from ${row.status.replace("_", " ")} to ${status.replace("_", " ")}`);
    }
    if (transition.noteRequired && !note) {
      throw badRequest("please say what's still wrong, so the next person knows what to fix", [{ field: "note", message: "is required" }]);
    }

    await query(
      `UPDATE issues SET status = $2, updated_at = now(),
         -- Marking it resolved starts a fresh round of confirmations. A landlord who
         -- resolves it themselves has approved the work by doing so.
         resolved_at           = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 IN ('open', 'in_progress') THEN NULL ELSE resolved_at END,
         tenant_confirmed_at   = CASE WHEN $2 IN ('resolved', 'open', 'in_progress') THEN NULL ELSE tenant_confirmed_at END,
         landlord_confirmed_at = CASE WHEN $2 = 'resolved' AND $3 THEN now()
                                      WHEN $2 IN ('resolved', 'open', 'in_progress') THEN NULL
                                      ELSE landlord_confirmed_at END,
         closed_at             = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END
       WHERE id = $1`,
      [id, status, viewer.role === "landlord"],
      client,
    );
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, body, from_status, to_status) VALUES ($1, $2, 'status_change', $3, $4, $5)`,
      [id, viewer.id, note ?? null, row.status, status],
      client,
    );
    if (status === "closed") await cancelPendingOffers(client, id);
    await markTouched(client, id, viewer);
  });
  return getIssueFor(viewer, id);
}

/**
 * Tenant: "it works". Landlord: "the work is approved". The issue closes as soon as both
 * have confirmed, whichever comes second.
 */
export async function confirmFix(viewer, id, { note } = {}) {
  await transaction(async (client) => {
    const row = await requireIssueAccess(viewer, id, client, { forUpdate: true });
    if (row.status !== "resolved") throw conflict("only issues marked as fixed can be confirmed");
    if (!canConfirm(row, viewer)) {
      throw forbidden(
        viewer.role === "worker"
          ? "the tenant and the landlord confirm the fix, not the worker"
          : "you've already confirmed this, or it isn't yours to confirm",
      );
    }

    const column = viewer.role === "landlord" ? "landlord_confirmed_at" : "tenant_confirmed_at";
    const updated = await one(`UPDATE issues SET ${column} = now(), updated_at = now() WHERE id = $1 RETURNING *`, [id], client);
    await query(`INSERT INTO issue_events (issue_id, actor_id, type, body) VALUES ($1, $2, 'confirmed', $3)`, [id, viewer.id, note ?? null], client);

    if (updated.tenant_confirmed_at && updated.landlord_confirmed_at) {
      await query(`UPDATE issues SET status = 'closed', closed_at = now() WHERE id = $1`, [id], client);
      await query(
        `INSERT INTO issue_events (issue_id, actor_id, type, from_status, to_status) VALUES ($1, $2, 'status_change', 'resolved', 'closed')`,
        [id, viewer.id],
        client,
      );
      await cancelPendingOffers(client, id);
    }
    await markTouched(client, id, viewer);
  });
  return getIssueFor(viewer, id);
}

async function cancelPendingOffers(client, issueId) {
  await query(`UPDATE job_offers SET status = 'cancelled', responded_at = now() WHERE issue_id = $1 AND status = 'pending'`, [issueId], client);
}

/**
 * Bump updated_at, and record the first response from the landlord's side (the landlord
 * or the worker they sent). Either means "someone is on it".
 */
export async function markTouched(client, issueId, viewer) {
  const isResponder = viewer.role === "landlord" || viewer.role === "worker";
  await query(
    `UPDATE issues SET updated_at = now(),
       acknowledged_at = CASE WHEN acknowledged_at IS NULL AND $2 THEN now() ELSE acknowledged_at END
     WHERE id = $1`,
    [issueId, isResponder],
    client,
  );
}

/** Landlord takes the worker off an issue (e.g. they can't come after all). */
export async function unassignIssue(landlord, id, { note } = {}) {
  if (landlord.role !== "landlord") throw forbidden("only landlords manage workers");
  await transaction(async (client) => {
    const row = await requireIssueAccess(landlord, id, client, { forUpdate: true });
    if (!row.assigned_worker_id) throw conflict("nobody is assigned to this issue");
    await query(`UPDATE issues SET assigned_worker_id = NULL, assigned_at = NULL, updated_at = now() WHERE id = $1`, [id], client);
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, body, subject_id) VALUES ($1, $2, 'unassigned', $3, $4)`,
      [id, landlord.id, note ?? null, row.assigned_worker_id],
      client,
    );
  });
  return getIssueFor(landlord, id);
}

/** Headline numbers for the dashboard. */
export async function summaryFor(viewer) {
  // One query, counted by the database, instead of loading every issue.
  const p = params();
  const yourConfirmation =
    viewer.role === "landlord" ? "i.landlord_confirmed_at IS NULL" : viewer.role === "tenant" ? "i.tenant_confirmed_at IS NULL" : "false";
  const counts = await one(
    `SELECT
       count(*) FILTER (WHERE i.status IN ('open', 'in_progress'))::int AS active,
       count(*) FILTER (WHERE i.status IN ('open', 'in_progress') AND i.urgency = 'urgent')::int AS urgent,
       count(*) FILTER (WHERE i.status IN ('open', 'in_progress') AND i.acknowledged_at IS NULL)::int AS unacknowledged,
       count(*) FILTER (WHERE i.status IN ('open', 'in_progress') AND i.assigned_worker_id IS NULL)::int AS unassigned,
       count(*) FILTER (WHERE i.status = 'resolved')::int AS awaiting_confirmation,
       count(*) FILTER (WHERE i.status = 'resolved' AND ${yourConfirmation})::int AS needs_your_confirmation
     FROM issues i JOIN properties p ON p.id = i.property_id
     WHERE ${visibleTo(viewer, p)}`,
    p.values,
  );
  const summary = {
    active: counts.active,
    urgent: counts.urgent,
    unacknowledged: counts.unacknowledged,
    unassigned: counts.unassigned,
    awaitingConfirmation: counts.awaiting_confirmation,
    // Resolved issues waiting for YOUR confirmation (tenant: "it works"; landlord: approve).
    needsYourConfirmation: counts.needs_your_confirmation,
  };
  if (viewer.role === "worker") {
    summary.pendingOffers = (await one(`SELECT count(*)::int AS n FROM job_offers WHERE worker_id = $1 AND status = 'pending'`, [viewer.id])).n;
  }
  return summary;
}
