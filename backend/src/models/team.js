// Workers from a landlord's point of view, and landlords from a worker's.
//
//   - The directory: landlords find workers by trade (findWorkers). It shows a short
//     name, trade, area and track record, never an email: contact happens through job
//     offers and the issue's private landlord-worker thread.
//   - "Your workers": the landlord_workers table, filled automatically when a worker
//     accepts one of the landlord's offers (models/offers.js).

import { iso, many, params, query, transaction } from "../db/index.js";
import { notFound } from "../utils/errors.js";
import { shortName, TRADES } from "../utils/people.js";

/** Landlord's view: workers who have accepted at least one of their jobs. */
export async function listWorkers(landlord) {
  const rows = await many(
    `SELECT u.id, u.name, u.email, u.trade, u.area, lw.added_at,
            (SELECT count(*) FROM issues i JOIN properties p ON p.id = i.property_id
              WHERE i.assigned_worker_id = u.id AND p.landlord_id = lw.landlord_id
                AND i.status IN ('open', 'in_progress'))::int AS active_jobs
     FROM landlord_workers lw JOIN users u ON u.id = lw.worker_id
     WHERE lw.landlord_id = $1 ORDER BY u.name, u.id`,
    [landlord.id],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email, // they've accepted a job from this landlord, so they're in contact
    trade: r.trade,
    area: r.area,
    addedAt: iso(r.added_at),
    activeJobs: r.active_jobs,
  }));
}

/** Worker's view: the landlords they work for. Names only. */
export async function listLandlordsFor(worker) {
  const rows = await many(
    `SELECT u.id, u.name, lw.added_at FROM landlord_workers lw JOIN users u ON u.id = lw.landlord_id
     WHERE lw.worker_id = $1 ORDER BY u.name, u.id`,
    [worker.id],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, addedAt: iso(r.added_at) }));
}

/**
 * The directory. Workers with the trade (all trades if none given); those whose area
 * mentions `city` first, then those who already work for this landlord, then by
 * experience. Workers who haven't set a trade yet don't appear.
 */
export async function findWorkers(landlord, { trade, city } = {}) {
  const p = params();
  const where = [`u.role = 'worker'`, `u.trade IS NOT NULL`];
  if (trade) where.push(`u.trade = ${p(trade)}`);
  const landlordId = p(landlord.id);
  const cityParam = p(city ? `%${city}%` : null);

  const rows = await many(
    `SELECT u.id, u.name, u.trade, u.area,
            EXISTS (SELECT 1 FROM landlord_workers lw WHERE lw.worker_id = u.id AND lw.landlord_id = ${landlordId}) AS works_for_you,
            (SELECT count(*) FROM issues i WHERE i.assigned_worker_id = u.id AND i.status = 'closed')::int AS completed_jobs,
            (SELECT count(*) FROM issues i WHERE i.assigned_worker_id = u.id AND i.status IN ('open', 'in_progress'))::int AS active_jobs,
            (${cityParam}::text IS NOT NULL AND u.area ILIKE ${cityParam}) AS in_area
     FROM users u
     WHERE ${where.join(" AND ")}
     ORDER BY in_area DESC, works_for_you DESC, completed_jobs DESC, u.name
     LIMIT 50`,
    p.values,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.works_for_you ? r.name : shortName(r.name),
    trade: r.trade,
    tradeLabel: TRADES[r.trade],
    area: r.area,
    worksForYou: r.works_for_you,
    completedJobs: r.completed_jobs,
    activeJobs: r.active_jobs,
    inArea: r.in_area,
  }));
}

/**
 * Stop working with a worker. Their active jobs on this landlord's properties become
 * unassigned and pending offers to them are cancelled, each with a timeline entry.
 * @returns {Promise<number>} how many active issues were unassigned
 */
export async function removeWorker(landlord, workerId) {
  return transaction(async (client) => {
    const { rowCount } = await query(`DELETE FROM landlord_workers WHERE landlord_id = $1 AND worker_id = $2`, [landlord.id, workerId], client);
    if (!rowCount) throw notFound("that worker isn't on your team");

    const active = await many(
      `UPDATE issues i SET assigned_worker_id = NULL, assigned_at = NULL, updated_at = now()
       FROM properties p
       WHERE p.id = i.property_id AND p.landlord_id = $1 AND i.assigned_worker_id = $2
         AND i.status IN ('open', 'in_progress')
       RETURNING i.id`,
      [landlord.id, workerId],
      client,
    );
    for (const { id } of active) {
      await query(
        `INSERT INTO issue_events (issue_id, actor_id, type, body, subject_id)
         VALUES ($1, $2, 'unassigned', 'Worker removed from the team', $3)`,
        [id, landlord.id, workerId],
        client,
      );
    }
    await query(
      `UPDATE job_offers SET status = 'cancelled', responded_at = now()
       WHERE landlord_id = $1 AND worker_id = $2 AND status = 'pending'`,
      [landlord.id, workerId],
      client,
    );
    return active.length;
  });
}

