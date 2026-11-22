import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { query } from "../src/db/index.js";

const ctx = startServer();

let landlord;
let tenant;
let property;

const LEAK = {
  title: "Leak under the sink",
  description: "Steady drip from the pipe under the kitchen sink.",
  category: "plumbing",
  urgency: "urgent",
};

before(async () => {
  landlord = await ctx.signUp("landlord");
  tenant = await ctx.signUp("tenant");
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Issue street 1, Barcelona" } })).body;
  await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });
});

async function report(overrides = {}, who = tenant) {
  return ctx.api("POST", "/issues", { token: who.token, body: { propertyId: property.id, ...LEAK, ...overrides } });
}

test("a tenant reports an issue: it starts open, unacknowledged, with a 'reported' event", async () => {
  const res = await report();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "open");
  assert.equal(res.body.acknowledgedAt, null);
  assert.deepEqual(res.body.allowedTransitions, [{ to: "closed", noteRequired: false }], "tenant can only withdraw an open issue");

  const detail = await ctx.api("GET", `/issues/${res.body.id}`, { token: tenant.token });
  assert.deepEqual(detail.body.events.map((e) => e.type), ["reported"]);
});

test("reporting needs a current tenancy, valid fields, and the tenant role", async () => {
  const outsider = await ctx.signUp("tenant");
  assert.equal((await report({}, outsider)).status, 404, "not a tenant of this property");
  assert.equal((await report({}, landlord)).status, 403, "landlords don't report issues");
  const bad = await report({ category: "magic", title: "" });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ["category", "title"]);
});

test("the landlord's first comment records acknowledgement time", async () => {
  const { body: issue } = await report({ title: "Comment ack test" });
  await ctx.api("POST", `/issues/${issue.id}/comments`, { token: tenant.token, body: { body: "Any update?" } });
  let detail = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.equal(detail.body.acknowledgedAt, null, "a tenant comment is not an acknowledgement");

  await ctx.api("POST", `/issues/${issue.id}/comments`, { token: landlord.token, body: { body: "On it." } });
  detail = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.ok(detail.body.acknowledgedAt);
  assert.deepEqual(detail.body.events.map((e) => [e.type, e.actor.role]), [
    ["reported", "tenant"],
    ["comment", "tenant"],
    ["comment", "landlord"],
  ]);
});

test("full lifecycle: landlord works and resolves, tenant reopens with a reason, then confirms", async () => {
  const { body: issue } = await report({ title: "Lifecycle" });
  const move = (who, status, note) => ctx.api("PATCH", `/issues/${issue.id}/status`, { token: who.token, body: { status, note } });

  assert.equal((await move(tenant, "in_progress")).status, 403, "tenant can't mark work started");
  assert.equal((await move(landlord, "in_progress", "Plumber booked")).body.status, "in_progress");
  assert.equal((await move(landlord, "closed")).status, 403, "landlord can't skip the tenant's confirmation");

  const resolved = await move(landlord, "resolved", "Pipe replaced");
  assert.equal(resolved.body.status, "resolved");
  assert.ok(resolved.body.resolvedAt);

  const noReason = await move(tenant, "open");
  assert.equal(noReason.status, 400, "reopening requires saying what's still wrong");
  const reopened = await move(tenant, "open", "Still dripping");
  assert.equal(reopened.body.status, "open");
  assert.equal(reopened.body.resolvedAt, null);

  const fixedAgain = await move(landlord, "resolved", "Tightened the joint");
  assert.ok(fixedAgain.body.confirmations.landlord, "a landlord who fixes it themselves has approved it");
  assert.equal(fixedAgain.body.confirmations.tenant, null);
  assert.equal((await move(tenant, "closed")).status, 403, "tenants confirm, they don't close directly");

  const closed = await ctx.api("POST", `/issues/${issue.id}/confirm`, { token: tenant.token, body: { note: "All dry now" } });
  assert.equal(closed.body.status, "closed", "tenant's confirmation was the last one needed");
  assert.deepEqual(closed.body.allowedTransitions, []);
  assert.equal(closed.body.canConfirm, false);

  const comment = await ctx.api("POST", `/issues/${issue.id}/comments`, { token: tenant.token, body: { body: "hi" } });
  assert.equal(comment.status, 409, "closed issues don't take comments");

  const detail = await ctx.api("GET", `/issues/${issue.id}`, { token: tenant.token });
  assert.deepEqual(
    detail.body.events.filter((e) => e.type === "status_change").map((e) => `${e.fromStatus}->${e.toStatus}`),
    ["open->in_progress", "in_progress->resolved", "resolved->open", "open->resolved", "resolved->closed"],
  );
  assert.equal(detail.body.events.find((e) => e.type === "confirmed").body, "All dry now");
  assert.equal(detail.body.events.find((e) => e.toStatus === "open" && e.type === "status_change").body, "Still dripping");
});

test("a landlord may close a resolved issue only after the tenant has been silent for 7 days", async () => {
  const { body: issue } = await report({ title: "Silent tenant" });
  await ctx.api("PATCH", `/issues/${issue.id}/status`, { token: landlord.token, body: { status: "resolved" } });
  let detail = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.deepEqual(detail.body.allowedTransitions, [{ to: "in_progress", noteRequired: true }], "only 'send back' for now");

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  await query("UPDATE issues SET resolved_at = $1 WHERE id = $2", [eightDaysAgo, issue.id]);
  detail = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.deepEqual(detail.body.allowedTransitions, [
    { to: "in_progress", noteRequired: true },
    { to: "closed", noteRequired: false },
  ]);
});

test("visibility: tenants see only their own reports; other landlords see nothing", async () => {
  const flatmate = await ctx.signUp("tenant");
  await ctx.api("POST", "/properties/join", { token: flatmate.token, body: { code: property.joinCode } });
  const { body: theirs } = await report({ title: "Flatmate's issue" }, flatmate);

  const mine = await ctx.api("GET", "/issues", { token: tenant.token });
  assert.ok(!mine.body.some((i) => i.id === theirs.id));
  assert.equal((await ctx.api("GET", `/issues/${theirs.id}`, { token: tenant.token })).status, 404);

  const all = await ctx.api("GET", "/issues", { token: landlord.token });
  assert.ok(all.body.some((i) => i.id === theirs.id), "the landlord sees every issue on their property");

  const otherLandlord = await ctx.signUp("landlord");
  assert.deepEqual((await ctx.api("GET", "/issues", { token: otherLandlord.token })).body, []);
  assert.equal((await ctx.api("GET", `/issues/${theirs.id}`, { token: otherLandlord.token })).status, 404);
});

test("the landlord inbox puts active urgent issues first and supports filters", async () => {
  const { body: low } = await report({ title: "Low priority", urgency: "low" });
  const list = await ctx.api("GET", "/issues?status=active", { token: landlord.token });
  assert.ok(list.body.every((i) => ["open", "in_progress"].includes(i.status)));
  assert.equal(list.body[0].urgency, "urgent");
  assert.equal(list.body.at(-1).id, low.id);

  const byProperty = await ctx.api(`GET`, `/issues?propertyId=${property.id}&status=closed`, { token: landlord.token });
  assert.ok(byProperty.body.every((i) => i.status === "closed"));
  assert.equal((await ctx.api("GET", "/issues?status=bogus", { token: landlord.token })).status, 400);
});

test("summary counts what needs attention, and property counts track open issues", async () => {
  const summary = await ctx.api("GET", "/issues/summary", { token: landlord.token });
  assert.equal(summary.status, 200);
  assert.ok(summary.body.active >= 1);
  assert.ok(summary.body.urgent >= 1);
  assert.ok(summary.body.unacknowledged >= 1);

  const props = await ctx.api("GET", "/properties", { token: landlord.token });
  assert.equal(props.body[0].openIssueCount, summary.body.active);
});
