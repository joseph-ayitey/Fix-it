// Job offers: how a worker gets assigned to an issue.
//
//   landlord "Find a worker" -> offer (pending) -> worker accepts  -> assigned, can see the job
//                                                -> worker declines -> landlord offers someone else
//                                     landlord withdraws -> nobody assigned
//
// Why offers instead of assigning directly: a worker agrees to every job, and before
// accepting they see what the job is (category, urgency, description, area) but not the
// exact address or the tenant. The offer messages are part of the private landlord-worker
// thread on the issue's timeline; the tenant only sees "a plumber was assigned".
//
// Rules the database enforces too: at most ONE pending offer per issue at a time
// (unique partial index job_offers_one_pending_per_issue).

import { iso, many, one, PG, query, transaction } from "../db/index.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors.js";
import { ACTIVE_STATUSES, getIssueFor, markTouched, requireIssueAccess } from "./issues.js";

export async function createOffer(landlord, { issueId, workerId, message }) {
  if (landlord.role !== "landlord") throw forbidden(`only landlords offer jobs (you're signed in as a ${landlord.role})`);

  await transaction(async (client) => {
    const issue = await requireIssueAccess(landlord, issueId, client, { forUpdate: true });
    if (!ACTIVE_STATUSES.includes(issue.status)) throw conflict("only open or in-progress issues can be offered to a worker");
    if (issue.assigned_worker_id) throw conflict("a worker is already assigned. Unassign them first to offer the job to someone else");

    const worker = await one(`SELECT id, role, trade FROM users WHERE id = $1`, [workerId], client);
    if (!worker || worker.role !== "worker") throw badRequest("that's not a worker account", [{ field: "workerId", message: "is not a worker" }]);

    try {
      await query(
        `INSERT INTO job_offers (issue_id, landlord_id, worker_id, message) VALUES ($1, $2, $3, $4)`,
        [issueId, landlord.id, workerId, message ?? null],
        client,
      );
    } catch (err) {
      if (err.code === PG.UNIQUE_VIOLATION) throw conflict("this issue already has an offer waiting for an answer. Withdraw it first");
      throw err;
    }
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, body, subject_id, visibility) VALUES ($1, $2, 'offer_sent', $3, $4, 'internal')`,
      [issueId, landlord.id, message ?? null, workerId],
      client,
    );
    await markTouched(client, issueId, landlord); // the landlord is acting on it
  });
  return getIssueFor(landlord, issueId);
}

export async function withdrawOffer(landlord, offerId) {
  const issueId = await transaction(async (client) => {
    const offer = await one(`SELECT * FROM job_offers WHERE id = $1 AND landlord_id = $2 FOR UPDATE`, [offerId, landlord.id], client);
    if (!offer) throw notFound("offer not found");
    if (offer.status !== "pending") throw conflict(`this offer was already ${offer.status}`);
    await query(`UPDATE job_offers SET status = 'withdrawn', responded_at = now() WHERE id = $1`, [offerId], client);
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, subject_id, visibility) VALUES ($1, $2, 'offer_withdrawn', $3, 'internal')`,
      [offer.issue_id, landlord.id, offer.worker_id],
      client,
    );
    return offer.issue_id;
  });
  return getIssueFor(landlord, issueId);
}

/**
 * The worker answers. Accepting assigns them to the issue (if it still needs someone),
 * adds them to the landlord's workers, and tells the tenant a worker is coming.
 */
export async function respondToOffer(worker, offerId, { accept, response }) {
  if (worker.role !== "worker") throw forbidden("only workers answer job offers");

  const issueId = await transaction(async (client) => {
    const offer = await one(`SELECT * FROM job_offers WHERE id = $1 AND worker_id = $2 FOR UPDATE`, [offerId, worker.id], client);
    if (!offer) throw notFound("offer not found");
    if (offer.status !== "pending") throw conflict(`this offer was already ${offer.status}`);

    if (!accept) {
      await query(`UPDATE job_offers SET status = 'declined', response = $2, responded_at = now() WHERE id = $1`, [offerId, response ?? null], client);
      await query(
        `INSERT INTO issue_events (issue_id, actor_id, type, body, subject_id, visibility) VALUES ($1, $2, 'offer_declined', $3, $2, 'internal')`,
        [offer.issue_id, worker.id, response ?? null],
        client,
      );
      return null;
    }

    const issue = await one(`SELECT status, assigned_worker_id FROM issues WHERE id = $1 FOR UPDATE`, [offer.issue_id], client);
    if (!ACTIVE_STATUSES.includes(issue.status) || issue.assigned_worker_id) {
      await query(`UPDATE job_offers SET status = 'cancelled', responded_at = now() WHERE id = $1`, [offerId], client);
      throw conflict("this job no longer needs a worker");
    }

    await query(`UPDATE job_offers SET status = 'accepted', response = $2, responded_at = now() WHERE id = $1`, [offerId, response ?? null], client);
    await query(`UPDATE issues SET assigned_worker_id = $2, assigned_at = now() WHERE id = $1`, [offer.issue_id, worker.id], client);
    await query(
      `INSERT INTO landlord_workers (landlord_id, worker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [offer.landlord_id, worker.id],
      client,
    );
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, body, subject_id, visibility) VALUES ($1, $2, 'offer_accepted', $3, $2, 'internal')`,
      [offer.issue_id, worker.id, response ?? null],
      client,
    );
    // The shared entry the tenant sees: "<landlord> assigned Pau V. (Plumber)".
    await query(
      `INSERT INTO issue_events (issue_id, actor_id, type, subject_id) VALUES ($1, $2, 'assigned', $3)`,
      [offer.issue_id, offer.landlord_id, worker.id],
      client,
    );
    await markTouched(client, offer.issue_id, worker);
    return offer.issue_id;
  });

  return issueId ? getIssueFor(worker, issueId) : null;
}

/**
 * Worker's inbox. Pending offers show what the job is, but not the exact address or
 * the tenant: those come with accepting.
 */
export async function listOffersForWorker(worker) {
  const rows = await many(
    `SELECT o.*, i.title, i.category, i.urgency, i.description, i.status AS issue_status,
            p.city, l.name AS landlord_name,
            (SELECT count(*) FROM issue_photos ph JOIN issue_events e ON e.id = ph.event_id
              WHERE ph.issue_id = i.id AND e.visibility = 'shared')::int AS photo_count
     FROM job_offers o
     JOIN issues i ON i.id = o.issue_id
     JOIN properties p ON p.id = i.property_id
     JOIN users l ON l.id = o.landlord_id
     WHERE o.worker_id = $1 AND (o.status = 'pending' OR o.responded_at > now() - interval '30 days')
     ORDER BY o.status = 'pending' DESC, CASE i.urgency WHEN 'urgent' THEN 0 ELSE 1 END, o.created_at DESC
     LIMIT 50`,
    [worker.id],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    response: r.response,
    createdAt: iso(r.created_at),
    respondedAt: iso(r.responded_at),
    landlord: { id: r.landlord_id, name: r.landlord_name },
    issue: {
      id: r.issue_id,
      title: r.title,
      category: r.category,
      urgency: r.urgency,
      description: r.description,
      city: r.city,
      photoCount: r.photo_count,
      status: r.issue_status,
    },
  }));
}

