// GET /dashboard/stats and /dashboard/activity (decision record 0004).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { query } from "../src/db/index.js";

const ctx = startServer();

let landlord;
let tenant;
let otherTenant;
let worker;
let property;

before(async () => {
  landlord = await ctx.signUp("landlord");
  tenant = await ctx.signUp("tenant", { name: "Anna Soler" });
  otherTenant = await ctx.signUp("tenant");
  worker = await ctx.signUp("worker", { name: "Marc Ribas" });
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Dashboard street 1, Barcelona", label: "Dash flat" } })).body;
  for (const t of [tenant, otherTenant]) await ctx.api("POST", "/properties/join", { token: t.token, body: { code: property.joinCode } });
});

const report = (who, overrides = {}) =>
  ctx.api("POST", "/issues", {
    token: who.token,
    body: { propertyId: property.id, title: "Dashboard issue", description: "Something is broken here.", category: "plumbing", ...overrides },
  });

test("an empty dashboard: zeros, every category, 12 weeks, and null medians", async () => {
  const fresh = await ctx.signUp("landlord");
  const { status, body } = await ctx.api("GET", "/dashboard/stats", { token: fresh.token });
  assert.equal(status, 200);
  assert.equal(body.total, 0);
  assert.deepEqual(body.byStatus, { open: 0, in_progress: 0, resolved: 0, closed: 0 });
  assert.equal(body.byCategory.length, 8);
  assert.ok(body.byCategory.every((c) => c.active === 0 && c.total === 0));
  assert.equal(body.weekly.length, 12);
  assert.ok(new Date(body.weekly[0].weekStart) < new Date(body.weekly[11].weekStart), "oldest first");
  assert.equal(new Date(`${body.weekly[11].weekStart}T00:00:00Z`).getUTCDay(), 1, "weeks start on Monday");
  assert.equal(body.responseTimes.medianHoursToFirstResponse, null);
  assert.equal(body.responseTimes.medianHoursToClose, null);

  const feed = await ctx.api("GET", "/dashboard/activity", { token: fresh.token });
  assert.deepEqual(feed.body, { items: [], page: { limit: 20, nextCursor: null, hasMore: false } });
});

test("stats count what the viewer can see, by status, urgency and category", async () => {
  await report(tenant, { urgency: "urgent", category: "plumbing" });
  await report(tenant, { urgency: "low", category: "electrical" });
  await report(otherTenant, { urgency: "normal", category: "plumbing" });

  const landlordStats = (await ctx.api("GET", "/dashboard/stats", { token: landlord.token })).body;
  assert.equal(landlordStats.total, 3);
  assert.deepEqual(landlordStats.byUrgency, { low: 1, normal: 1, urgent: 1 });
  assert.deepEqual(landlordStats.byCategory.find((c) => c.category === "plumbing"), { category: "plumbing", active: 2, total: 2 });
  assert.equal(landlordStats.weekly.at(-1).reported, 3, "all reported this week");

  const tenantStats = (await ctx.api("GET", "/dashboard/stats", { token: tenant.token })).body;
  assert.equal(tenantStats.total, 2, "a tenant only counts their own reports");
});

test("median response and close times come from real timestamps", async () => {
  const a = (await report(tenant, { title: "Timed A" })).body;
  const b = (await report(tenant, { title: "Timed B" })).body;
  // A: answered after 4 hours, closed after 48. B: answered after 10 hours, still open.
  await query(`UPDATE issues SET created_at = now() - interval '48 hours', acknowledged_at = now() - interval '44 hours', closed_at = now(), status = 'closed' WHERE id = $1`, [a.id]);
  await query(`UPDATE issues SET created_at = now() - interval '12 hours', acknowledged_at = now() - interval '2 hours' WHERE id = $1`, [b.id]);

  const { body } = await ctx.api("GET", "/dashboard/stats", { token: tenant.token });
  assert.equal(body.responseTimes.respondedCount, 2);
  assert.equal(body.responseTimes.medianHoursToFirstResponse, 7, "median of 4h and 10h");
  assert.equal(body.responseTimes.closedCount, 1);
  assert.equal(body.responseTimes.medianHoursToClose, 48);
});

test("the activity feed: newest first, with issue context and a short excerpt", async () => {
  const issue = (await report(tenant, { title: "Feed issue" })).body;
  const long = "x".repeat(300);
  await ctx.api("POST", `/issues/${issue.id}/comments`, { token: landlord.token, body: { body: long } });

  const { body } = await ctx.api("GET", "/dashboard/activity?limit=5", { token: landlord.token });
  const [latest, previous] = body.items;
  assert.equal(latest.type, "comment");
  assert.equal(latest.excerpt.length, 141, "140 characters + …");
  assert.ok(latest.excerpt.endsWith("…"));
  assert.deepEqual(latest.issue, { id: issue.id, title: "Feed issue", urgency: "normal", status: "open", propertyLabel: "Dash flat" });
  assert.equal(previous.type, "reported");
  assert.ok(latest.id > previous.id);
});

test("tenants never see private events in the feed; workers only see their jobs", async () => {
  const issue = (await report(tenant, { title: "Private feed issue" })).body;
  await ctx.api("POST", "/offers", { token: landlord.token, body: { issueId: issue.id, workerId: worker.user.id, message: "Budget 100 EUR" } });
  const offers = await ctx.api("GET", "/offers", { token: worker.token });
  await ctx.api("POST", `/offers/${offers.body.items[0].id}/accept`, { token: worker.token });
  await ctx.api("POST", `/issues/${issue.id}/comments`, { token: worker.token, body: { body: "Quote: 90 EUR", visibility: "internal" } });

  const tenantFeed = (await ctx.api("GET", "/dashboard/activity?limit=50", { token: tenant.token })).body.items;
  assert.ok(tenantFeed.every((e) => e.visibility === "shared"));
  const assigned = tenantFeed.find((e) => e.type === "assigned" && e.issue.id === issue.id);
  assert.equal(assigned.subject.name, "Marc R.", "privacy rules apply to names");

  const landlordFeed = (await ctx.api("GET", "/dashboard/activity?limit=50", { token: landlord.token })).body.items;
  assert.ok(landlordFeed.some((e) => e.visibility === "internal" && e.excerpt === "Quote: 90 EUR"));

  const workerFeed = (await ctx.api("GET", "/dashboard/activity?limit=50", { token: worker.token })).body.items;
  assert.ok(workerFeed.length > 0);
  assert.ok(workerFeed.every((e) => e.issue.id === issue.id), "only issues assigned to them");
});

test("the feed paginates with a cursor like every collection", async () => {
  const first = await ctx.api("GET", "/dashboard/activity?limit=3", { token: landlord.token });
  assert.equal(first.body.items.length, 3);
  assert.equal(first.body.page.hasMore, true);
  const second = await ctx.api("GET", `/dashboard/activity?limit=3&cursor=${first.body.page.nextCursor}`, { token: landlord.token });
  assert.ok(second.body.items[0].id < first.body.items[2].id, "continues where the first page stopped");
  assert.equal((await ctx.api("GET", "/dashboard/activity?limit=51", { token: landlord.token })).status, 400);
});
