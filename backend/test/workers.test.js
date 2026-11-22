// Workers end to end: trades, the directory, job offers (accept/decline/withdraw), the
// private landlord-worker thread, name privacy, and the two-sided confirmation.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const ctx = startServer();

let landlord;
let tenant;
let plumber;
let electrician;
let property;

before(async () => {
  landlord = await ctx.signUp("landlord", { name: "Maria Garcia" });
  tenant = await ctx.signUp("tenant", { name: "Anna Soler" });
  plumber = await ctx.signUp("worker", { name: "Marc Ribas", trade: "plumber", area: "Barcelona" });
  electrician = await ctx.signUp("worker", { name: "Laia Serra", trade: "electrician", area: "Girona" });
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Worker street 1, Barcelona" } })).body;
  await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });
});

async function report(title = "Kitchen tap leaking", category = "plumbing") {
  const res = await ctx.api("POST", "/issues", {
    token: tenant.token,
    body: { propertyId: property.id, title, description: "Water drips from the tap all night.", category, urgency: "urgent" },
  });
  return res.body;
}

const offer = (issueId, workerId, message = "Can you come today?") =>
  ctx.api("POST", "/offers", { token: landlord.token, body: { issueId, workerId, message } });

async function pendingOfferId(worker, issueId) {
  const { body } = await ctx.api("GET", "/offers", { token: worker.token });
  return body.items.find((o) => o.issue.id === issueId && o.status === "pending")?.id;
}

async function hire(issueId, worker) {
  await offer(issueId, worker.user.id);
  const id = await pendingOfferId(worker, issueId);
  return ctx.api("POST", `/offers/${id}/accept`, { token: worker.token, body: { response: "On my way" } });
}

test("workers must pick a trade when signing up; only workers have one", async () => {
  assert.equal(plumber.user.trade, "plumber");
  const noTrade = await ctx.api("POST", "/auth/register", {
    body: { email: "x@example.test", name: "X", password: "password123", role: "worker" },
  });
  assert.equal(noTrade.status, 400);
  const tenantWithTrade = await ctx.api("POST", "/auth/register", {
    body: { email: "y@example.test", name: "Y", password: "password123", role: "tenant", trade: "plumber" },
  });
  assert.equal(tenantWithTrade.status, 400);

  const updated = await ctx.api("PATCH", "/auth/me", { token: electrician.token, body: { area: "Girona, Barcelona" } });
  assert.equal(updated.body.user.area, "Girona, Barcelona");
  assert.equal(updated.body.user.trade, "electrician", "fields not sent stay as they were");
});

test("the directory finds workers by trade without exposing contact details", async () => {
  const plumbers = await ctx.api("GET", "/team/directory?trade=plumber&city=Barcelona", { token: landlord.token });
  assert.equal(plumbers.status, 200);
  const marc = plumbers.body.items.find((w) => w.id === plumber.user.id);
  assert.equal(marc.name, "Marc R.", "not yet working together: short name only");
  assert.equal(marc.tradeLabel, "Plumber");
  assert.equal(marc.inArea, true);
  assert.equal(marc.email, undefined);
  assert.ok(plumbers.body.items.every((w) => w.trade === "plumber"));

  assert.equal((await ctx.api("GET", "/team/directory", { token: tenant.token })).status, 403);
  assert.equal((await ctx.api("GET", "/team/directory?trade=astronaut", { token: landlord.token })).status, 400);
});

test("an offer doesn't assign anyone: the worker sees a preview, without the address", async () => {
  const issue = await report();
  const sent = await offer(issue.id, plumber.user.id, "Urgent leak, tenant home after 5");
  assert.equal(sent.status, 201);
  assert.equal(sent.body.assignee, null);
  assert.equal(sent.body.offers[0].status, "pending");
  assert.ok(sent.body.acknowledgedAt, "sending an offer counts as the landlord responding");

  const inbox = await ctx.api("GET", "/offers", { token: plumber.token });
  const preview = inbox.body.items.find((o) => o.issue.id === issue.id);
  assert.equal(preview.status, "pending");
  assert.equal(preview.message, "Urgent leak, tenant home after 5");
  assert.equal(preview.issue.title, "Kitchen tap leaking");
  assert.equal(preview.issue.address, undefined, "the exact address comes with accepting");
  assert.equal((await ctx.api("GET", `/issues/${issue.id}`, { token: plumber.token })).status, 404, "no access before accepting");

  const second = await offer(issue.id, electrician.user.id);
  assert.equal(second.status, 409, "one open offer per issue at a time");

  const tenantView = await ctx.api("GET", `/issues/${issue.id}`, { token: tenant.token });
  assert.ok(!tenantView.body.events.some((e) => e.type.startsWith("offer_")), "offers are private to landlord and worker");
  assert.equal(tenantView.body.offers, undefined);
});

test("accepting assigns the worker, adds them to the landlord's workers, and tells the tenant", async () => {
  const issue = await report("Shower drain blocked");
  const accepted = await hire(issue.id, plumber);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.assignee.id, plumber.user.id);
  assert.equal(accepted.body.property.address, "Worker street 1, Barcelona", "now they get the address");

  const team = await ctx.api("GET", "/team/workers", { token: landlord.token });
  assert.ok(team.body.items.some((w) => w.id === plumber.user.id && w.name === "Marc Ribas"));

  const tenantView = await ctx.api("GET", `/issues/${issue.id}`, { token: tenant.token });
  assert.deepEqual(tenantView.body.assignee, { id: plumber.user.id, name: "Marc R.", trade: "plumber", tradeLabel: "Plumber" });
  const assigned = tenantView.body.events.find((e) => e.type === "assigned");
  assert.equal(assigned.subject.name, "Marc R.");

  const workerView = await ctx.api("GET", `/issues/${issue.id}`, { token: plumber.token });
  assert.equal(workerView.body.reporter.name, "Anna S.", "workers see tenants by short name too");

  const inbox = await ctx.api("GET", "/offers", { token: plumber.token });
  const acceptedOffer = inbox.body.items.find((o) => o.issue.id === issue.id && o.status === "accepted");
  const again = await ctx.api("POST", `/offers/${acceptedOffer.id}/accept`, { token: plumber.token });
  assert.equal(again.status, 409, "an answered offer can't be answered twice");
});

test("declining keeps the issue unassigned and tells the landlord why; withdrawing works too", async () => {
  const issue = await report("Bathroom fan dead", "electrical");
  await offer(issue.id, electrician.user.id);
  const id = await pendingOfferId(electrician, issue.id);
  const declined = await ctx.api("POST", `/offers/${id}/decline`, { token: electrician.token, body: { response: "Fully booked this week" } });
  assert.equal(declined.status, 204);

  const detail = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.equal(detail.body.assignee, null);
  assert.equal(detail.body.offers[0].status, "declined");
  assert.equal(detail.body.offers[0].response, "Fully booked this week");

  const another = await offer(issue.id, plumber.user.id);
  assert.equal(another.status, 201, "the landlord can offer it to someone else now");
  const withdrawn = await ctx.api("POST", `/offers/${another.body.offers[0].id}/withdraw`, { token: landlord.token });
  assert.equal(withdrawn.body.offers[0].status, "withdrawn");
  assert.equal(await pendingOfferId(plumber, issue.id), undefined);
});

test("only landlords offer jobs, and only on their own active, unassigned issues", async () => {
  const issue = await report("Window handle loose", "structural");
  const otherLandlord = await ctx.signUp("landlord");
  assert.equal((await ctx.api("POST", "/offers", { token: tenant.token, body: { issueId: issue.id, workerId: plumber.user.id } })).status, 403);
  assert.equal((await ctx.api("POST", "/offers", { token: otherLandlord.token, body: { issueId: issue.id, workerId: plumber.user.id } })).status, 404);
  assert.equal((await offer(issue.id, tenant.user.id)).status, 400, "you can only offer jobs to worker accounts");

  await hire(issue.id, plumber);
  assert.equal((await offer(issue.id, electrician.user.id)).status, 409, "already assigned: unassign first");
});

test("the private landlord-worker thread is invisible to the tenant, photos included", async () => {
  const issue = await report("Boiler pressure low", "heating");
  await hire(issue.id, plumber);
  const note = await ctx.upload(`/issues/${issue.id}/comments`, {
    token: plumber.token,
    fields: { body: "Quote: 120 EUR for a new valve", visibility: "internal" },
    files: [{ name: "quote.png", data: (await import("./helpers.js")).TINY_PNG }],
  });
  assert.equal(note.status, 201);
  const internal = note.body.events.find((e) => e.visibility === "internal" && e.type === "comment");
  assert.equal(internal.body, "Quote: 120 EUR for a new valve");

  const landlordView = await ctx.api("GET", `/issues/${issue.id}`, { token: landlord.token });
  assert.ok(landlordView.body.events.some((e) => e.body === "Quote: 120 EUR for a new valve"));

  const tenantView = await ctx.api("GET", `/issues/${issue.id}`, { token: tenant.token });
  assert.ok(!tenantView.body.events.some((e) => e.visibility === "internal"));
  assert.equal((await ctx.raw(internal.photos[0].url, { token: tenant.token })).status, 404, "not even by guessing the URL");
  assert.equal((await ctx.raw(internal.photos[0].url, { token: landlord.token })).status, 200);

  const tenantTries = await ctx.api("POST", `/issues/${issue.id}/comments`, { token: tenant.token, body: { body: "hi", visibility: "internal" } });
  assert.equal(tenantTries.status, 403);
});

test("worker fixes it -> tenant confirms -> landlord approves -> closed (either order works)", async () => {
  const issue = await report("Toilet keeps running");
  await hire(issue.id, plumber);
  const move = (who, status, note) => ctx.api("PATCH", `/issues/${issue.id}/status`, { token: who.token, body: { status, note } });
  const confirm = (who, note) => ctx.api("POST", `/issues/${issue.id}/confirm`, { token: who.token, body: note ? { note } : {} });

  const fixed = await move(plumber, "resolved", "Replaced the flapper");
  assert.equal(fixed.body.status, "resolved");
  assert.deepEqual(fixed.body.confirmations, { tenant: null, landlord: null }, "a worker's fix needs both confirmations");
  assert.equal(fixed.body.canConfirm, false, "the worker doesn't confirm their own work");
  assert.equal((await confirm(plumber)).status, 403);

  const tenantView = await ctx.api("GET", `/issues/${issue.id}`, { token: tenant.token });
  assert.equal(tenantView.body.canConfirm, true, "the tenant CAN confirm");

  const afterTenant = await confirm(tenant, "No more running water");
  assert.equal(afterTenant.body.status, "resolved", "still waiting for the landlord");
  assert.ok(afterTenant.body.confirmations.tenant);
  assert.equal((await confirm(tenant)).status, 403, "no double confirming");

  const afterLandlord = await confirm(landlord, "Approved");
  assert.equal(afterLandlord.body.status, "closed");
  assert.ok(afterLandlord.body.closedAt);
});

test("the landlord can send the work back; that resets both confirmations", async () => {
  const issue = await report("Sink drains slowly");
  await hire(issue.id, plumber);
  await ctx.api("PATCH", `/issues/${issue.id}/status`, { token: plumber.token, body: { status: "resolved" } });
  await ctx.api("POST", `/issues/${issue.id}/confirm`, { token: tenant.token, body: {} });

  const noReason = await ctx.api("PATCH", `/issues/${issue.id}/status`, { token: landlord.token, body: { status: "in_progress" } });
  assert.equal(noReason.status, 400, "sending back needs a reason");
  const sentBack = await ctx.api("PATCH", `/issues/${issue.id}/status`, {
    token: landlord.token,
    body: { status: "in_progress", note: "Pipe under the sink still drips" },
  });
  assert.equal(sentBack.body.status, "in_progress");
  assert.deepEqual(sentBack.body.confirmations, { tenant: null, landlord: null });

  const workerView = await ctx.api("GET", `/issues/${issue.id}`, { token: plumber.token });
  assert.deepEqual(workerView.body.allowedTransitions, [{ to: "resolved", noteRequired: false }], "back on the worker's list");
});

test("dashboards: the worker sees pending offers; everyone sees what needs THEIR confirmation", async () => {
  const issue = await report("Leaky radiator valve", "heating");
  await offer(issue.id, electrician.user.id);
  const workerSummary = await ctx.api("GET", "/issues/summary", { token: electrician.token });
  assert.equal(workerSummary.body.pendingOffers, 1);

  const fixed = await report("Dripping shower head");
  await hire(fixed.id, plumber);
  await ctx.api("PATCH", `/issues/${fixed.id}/status`, { token: plumber.token, body: { status: "resolved" } });
  const tenantSummary = await ctx.api("GET", "/issues/summary", { token: tenant.token });
  const landlordSummary = await ctx.api("GET", "/issues/summary", { token: landlord.token });
  assert.ok(tenantSummary.body.needsYourConfirmation >= 1);
  assert.ok(landlordSummary.body.needsYourConfirmation >= 1);
});

test("removing a worker unassigns their active jobs and cancels pending offers", async () => {
  const leaver = await ctx.signUp("worker", { name: "Leo Vela" });
  const active = await report("Door handle loose", "structural");
  await hire(active.id, leaver);
  const waiting = await report("Gutter overflowing", "structural");
  await offer(waiting.id, leaver.user.id);

  const res = await ctx.api("DELETE", `/team/workers/${leaver.user.id}`, { token: landlord.token });
  assert.deepEqual(res.body, { unassignedIssues: 1 });
  assert.equal((await ctx.api("GET", `/issues/${active.id}`, { token: landlord.token })).body.assignee, null);
  assert.equal((await ctx.api("GET", `/issues/${active.id}`, { token: leaver.token })).status, 404);
  assert.equal(await pendingOfferId(leaver, waiting.id), undefined);
});

test("a wrong-role request says who you're signed in as", async () => {
  const res = await ctx.api("POST", "/properties", { token: tenant.token, body: { address: "Somewhere 12, Town" } });
  assert.equal(res.status, 403);
  assert.match(res.body.detail, /signed in as Anna Soler \(tenant\)/);
});
