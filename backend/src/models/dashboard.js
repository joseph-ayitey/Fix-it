// Dashboard data (decision record 0004): statistics and the activity feed, scoped by the
// same visibility rule as every other issue query. Everything is aggregated in SQL, so
// the responses stay small however many issues there are.

import { iso, many, one, params } from "../db/index.js";
import { decodeCursor, toPage } from "../utils/pagination.js";
import { nameFor, TRADES } from "../utils/people.js";
import { CATEGORIES, visibleTo } from "./issues.js";

const ACTIVE = "('open', 'in_progress')";
const round1 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);

/** The issues `viewer` may see, as a CTE named `v`, plus its parameter builder. */
function visibleIssues(viewer) {
  const p = params();
  const cte = `WITH v AS (SELECT i.* FROM issues i JOIN properties p ON p.id = i.property_id WHERE ${visibleTo(viewer, p)})`;
  return { p, cte };
}

export async function statsFor(viewer) {
  const counts = (() => {
    const { p, cte } = visibleIssues(viewer);
    return one(
      `${cte}
       SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'open')::int AS open,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              count(*) FILTER (WHERE status = 'closed')::int AS closed,
              count(*) FILTER (WHERE status IN ${ACTIVE} AND urgency = 'low')::int AS low,
              count(*) FILTER (WHERE status IN ${ACTIVE} AND urgency = 'normal')::int AS normal,
              count(*) FILTER (WHERE status IN ${ACTIVE} AND urgency = 'urgent')::int AS urgent
       FROM v`,
      p.values,
    );
  })();

  const byCategory = (() => {
    const { p, cte } = visibleIssues(viewer);
    const cats = p(CATEGORIES);
    // unnest() lists every category, so ones with no issues still appear (as zeros).
    return many(
      `${cte}
       SELECT c.category,
              count(v.id) FILTER (WHERE v.status IN ${ACTIVE})::int AS active,
              count(v.id)::int AS total
       FROM unnest(${cats}::text[]) WITH ORDINALITY AS c(category, position)
       LEFT JOIN v ON v.category = c.category
       GROUP BY c.category, c.position
       ORDER BY c.position`,
      p.values,
    );
  })();

  const responseTimes = (() => {
    const { p, cte } = visibleIssues(viewer);
    return one(
      `${cte}
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM acknowledged_at - created_at) / 3600)
                FILTER (WHERE acknowledged_at IS NOT NULL) AS median_response,
              count(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS responded,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at - created_at) / 3600)
                FILTER (WHERE closed_at IS NOT NULL) AS median_close,
              count(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed
       FROM v WHERE created_at > now() - interval '90 days'`,
      p.values,
    );
  })();

  const weekly = (() => {
    const { p, cte } = visibleIssues(viewer);
    // 12 weeks, Monday-based, in UTC, oldest first; generate_series makes empty weeks appear.
    return many(
      `${cte}
       SELECT to_char(w.week_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS week_start,
              (SELECT count(*) FROM v WHERE v.created_at >= w.week_start AND v.created_at < w.week_start + interval '7 days')::int AS reported,
              (SELECT count(*) FROM v WHERE v.closed_at >= w.week_start AND v.closed_at < w.week_start + interval '7 days')::int AS closed
       FROM generate_series(date_trunc('week', now(), 'UTC') - interval '11 weeks', date_trunc('week', now(), 'UTC'), interval '1 week') AS w(week_start)
       ORDER BY w.week_start`,
      p.values,
    );
  })();

  const [c, cats, rt, weeks] = await Promise.all([counts, byCategory, responseTimes, weekly]);
  return {
    total: c.total,
    byStatus: { open: c.open, in_progress: c.in_progress, resolved: c.resolved, closed: c.closed },
    byUrgency: { low: c.low, normal: c.normal, urgent: c.urgent },
    byCategory: cats.map((r) => ({ category: r.category, active: r.active, total: r.total })),
    responseTimes: {
      windowDays: 90,
      medianHoursToFirstResponse: round1(rt.median_response),
      medianHoursToClose: round1(rt.median_close),
      respondedCount: rt.responded,
      closedCount: rt.closed,
    },
    weekly: weeks.map((w) => ({ weekStart: w.week_start, reported: w.reported, closed: w.closed })),
  };
}

const EXCERPT = 140;

/** The newest timeline events on issues `viewer` may see. Tenants never see private ones. */
export async function activityFor(viewer, { limit = 20, cursor = null } = {}) {
  const p = params();
  const where = [visibleTo(viewer, p)];
  if (viewer.role === "tenant") where.push(`e.visibility = 'shared'`);
  const afterId = decodeCursor(cursor, "activity");
  if (afterId) where.push(`e.id < ${p(afterId)}`);

  const rows = await many(
    `SELECT e.id, e.type, e.visibility, e.created_at, e.body, e.to_status,
            e.actor_id, u.name AS actor_name, u.role AS actor_role,
            e.subject_id, s.name AS subject_name, s.trade AS subject_trade,
            i.id AS issue_id, i.title, i.urgency, i.status,
            coalesce(p.label, p.address_input) AS property_label,
            (SELECT count(*) FROM issue_photos ph WHERE ph.event_id = e.id)::int AS photo_count
     FROM issue_events e
     JOIN issues i ON i.id = e.issue_id
     JOIN properties p ON p.id = i.property_id
     JOIN users u ON u.id = e.actor_id
     LEFT JOIN users s ON s.id = e.subject_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.id DESC
     LIMIT ${p(limit + 1)}`,
    p.values,
  );

  return toPage(rows, limit, "activity", (r) => ({
    id: r.id,
    type: r.type,
    visibility: r.visibility,
    createdAt: iso(r.created_at),
    actor: { id: r.actor_id, name: nameFor(viewer, { id: r.actor_id, name: r.actor_name, role: r.actor_role }), role: r.actor_role },
    subject: r.subject_id
      ? { id: r.subject_id, name: nameFor(viewer, { id: r.subject_id, name: r.subject_name, role: "worker" }), tradeLabel: TRADES[r.subject_trade] ?? null }
      : null,
    toStatus: r.to_status,
    excerpt: r.body ? (r.body.length > EXCERPT ? `${r.body.slice(0, EXCERPT)}…` : r.body) : null,
    photoCount: r.photo_count,
    issue: { id: r.issue_id, title: r.title, urgency: r.urgency, status: r.status, propertyLabel: r.property_label },
  }));
}
