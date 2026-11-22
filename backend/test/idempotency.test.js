// POST /issues with an Idempotency-Key: a retry never creates a second issue.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { startServer, TINY_PNG, uploadDir } from "./helpers.js";
import { one, query } from "../src/db/index.js";

const ctx = startServer();
const PROBLEM = "https://github.com/joseph-ayitey/fixit/blob/main/docs/problems.md#";

let landlord;
let tenant;
let otherTenant;
let property;

before(async () => {
  landlord = await ctx.signUp("landlord");
  tenant = await ctx.signUp("tenant");
  otherTenant = await ctx.signUp("tenant");
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Idempotent street 1, Barcelona" } })).body;
  for (const t of [tenant, otherTenant]) await ctx.api("POST", "/properties/join", { token: t.token, body: { code: property.joinCode } });
});

const leak = (overrides = {}) => ({
  propertyId: property.id,
  title: "Leak under the sink",
  description: "Steady drip from the pipe.",
  category: "plumbing",
  urgency: "urgent",
  ...overrides,
});
const report = (body, key, who = tenant) =>
  ctx.api("POST", "/issues", { token: who.token, body, headers: key ? { "Idempotency-Key": key } : {} });
const issueCount = async () => (await one(`SELECT count(*)::int AS n FROM issues`)).n;

test("a retry with the same key returns the same issue instead of creating a second", async () => {
  const key = randomUUID();
  const before = await issueCount();
  const first = await report(leak(), key);
  const retry = await report(leak(), key);

  assert.equal(first.status, 201);
  assert.equal(first.headers.get("idempotent-replayed"), null);
  assert.equal(retry.status, 201, "same status as the original");
  assert.equal(retry.headers.get("idempotent-replayed"), "true");
  assert.equal(retry.body.id, first.body.id);
  assert.equal(retry.headers.get("location"), `/api/issues/${first.body.id}`);
  assert.equal(await issueCount(), before + 1, "exactly one issue created");
});

test("the same body in a different key order is still the same request", async () => {
  const key = randomUUID();
  const body = leak({ title: "Key order test" });
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  const first = await report(body, key);
  const retry = await report(reordered, key);
  assert.equal(retry.body.id, first.body.id);
});

test("reusing a key for a different request is a 422", async () => {
  const key = randomUUID();
  await report(leak({ title: "First use of the key" }), key);
  const reused = await report(leak({ title: "Something else entirely" }), key);
  assert.equal(reused.status, 422);
  assert.equal(reused.body.type, `${PROBLEM}idempotency-key-reused`);
});

test("keys are per user: another tenant's identical key is independent", async () => {
  const key = randomUUID();
  const mine = await report(leak({ title: "Per-user key" }), key);
  const theirs = await report(leak({ title: "Per-user key" }), key, otherTenant);
  assert.equal(theirs.status, 201);
  assert.notEqual(theirs.body.id, mine.body.id);
  assert.equal(theirs.headers.get("idempotent-replayed"), null);
});

test("a failed attempt releases the key, so a corrected retry works", async () => {
  const key = randomUUID();
  const failed = await report(leak({ propertyId: 999999 }), key); // not a property this tenant is in
  assert.equal(failed.status, 404);
  const fixed = await report(leak({ title: "Fixed after a failure" }), key);
  assert.equal(fixed.status, 201);
  assert.equal(fixed.headers.get("idempotent-replayed"), null);
});

test("a retry while the first request is still running is a 409", async () => {
  const key = randomUUID();
  const body = leak({ title: "In flight" });
  // Simulate the first request still running: its key row exists, not completed yet.
  const { createHash } = await import("node:crypto");
  const stable = (v) => (v && typeof v === "object" && !Array.isArray(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v));
  const hash = createHash("sha256").update(stable(body)).digest("hex");
  await query(`INSERT INTO idempotency_keys (user_id, key, operation, request_hash) VALUES ($1, $2, 'POST /issues', $3)`, [tenant.user.id, key, hash]);

  const res = await report(body, key);
  assert.equal(res.status, 409);
  assert.equal(res.body.type, `${PROBLEM}idempotency-request-in-progress`);
});

test("keys are forgotten after 24 hours", async () => {
  const key = randomUUID();
  await report(leak({ title: "Old key" }), key);
  await query(`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = $1`, [key]);
  const later = await report(leak({ title: "A new report with an old key" }), key);
  assert.equal(later.status, 201);
  assert.equal(later.headers.get("idempotent-replayed"), null);
});

test("with photos: a retry stores no extra files and creates no extra issue", async () => {
  const key = randomUUID();
  const fields = { propertyId: String(property.id), title: "Photo retry", description: "Black mould on the ceiling.", category: "pest" };
  const files = [{ name: "mould.png", data: TINY_PNG }];
  const first = await ctx.upload("/issues", { token: tenant.token, fields, files, headers: { "Idempotency-Key": key } });
  const filesAfterFirst = readdirSync(uploadDir).length;
  const retry = await ctx.upload("/issues", { token: tenant.token, fields, files, headers: { "Idempotency-Key": key } });

  assert.equal(first.status, 201);
  assert.equal(retry.headers.get("idempotent-replayed"), "true");
  assert.equal(retry.body.id, first.body.id);
  assert.equal(readdirSync(uploadDir).length, filesAfterFirst, "no duplicate photo files");
});

test("without a key, POST stays a normal create; a malformed key is rejected by the contract", async () => {
  const a = await report(leak({ title: "No key 1" }));
  const b = await report(leak({ title: "No key 1" }));
  assert.notEqual(a.body.id, b.body.id, "no key: two requests, two issues");

  const short = await report(leak(), "abc");
  assert.equal(short.status, 400);
  assert.equal(short.body.errors[0].field, "header.idempotency-key");
});
