// The contract (openapi.yaml) and the code agree. Every other test file also runs with
// response validation ON, so any response that doesn't match the contract fails as a 500;
// these tests cover what that can't: completeness, pagination, and the error format.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { startServer } from "./helpers.js";
import { OPENAPI_PATH } from "../src/server.js";

const ctx = startServer();
const spec = parse(readFileSync(OPENAPI_PATH, "utf8"));
const PROBLEM_DOCS = "https://github.com/joseph-ayitey/fixit/blob/main/docs/problems.md#";

let landlord;
let tenant;
let property;

before(async () => {
  landlord = await ctx.signUp("landlord");
  tenant = await ctx.signUp("tenant");
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Contract street 1, Barcelona" } })).body;
  await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });
});

async function rawFetch(method, path, { token, body, headers = {} } = {}) {
  return fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("every operation in openapi.yaml is implemented (none documented but missing)", async () => {
  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    ["get", "post", "patch", "put", "delete"].filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path })),
  );
  assert.equal(operations.length, 31);
  for (const op of operations) {
    const url = op.path.replace(/\{[^}]+\}/g, "999999");
    const res = await rawFetch(op.method, url, { token: landlord.token });
    const type = res.headers.get("content-type") ?? "";
    // An unimplemented route would fall through to Express's default HTML 404 page.
    assert.ok(!type.includes("text/html"), `${op.method} ${op.path} is in the contract but not implemented`);
  }
});

test("routes that aren't in the contract don't exist: 404 Problem Details", async () => {
  const res = await rawFetch("GET", "/units", { token: landlord.token });
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type"), /application\/problem\+json/);
  const body = await res.json();
  assert.equal(body.type, `${PROBLEM_DOCS}not-found`);
  assert.equal(body.status, 404);
});

test("a method the path doesn't support is a 405", async () => {
  const res = await rawFetch("DELETE", "/issues", { token: landlord.token });
  assert.equal(res.status, 405);
  assert.equal((await res.json()).type, `${PROBLEM_DOCS}method-not-allowed`);
});

test("validation errors are Problem Details listing every invalid field, checked before any route code", async () => {
  const res = await rawFetch("POST", "/issues", {
    token: tenant.token,
    body: { propertyId: "x", title: "", category: "magic", sneaky: true },
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type"), /application\/problem\+json/);
  const body = await res.json();
  assert.equal(body.type, `${PROBLEM_DOCS}validation-error`);
  assert.equal(body.title, "Your request has invalid fields");
  assert.equal(body.instance, "/api/issues");
  assert.deepEqual(body.errors.map((e) => e.field).sort(), ["category", "description", "propertyId", "sneaky", "title"]);
});

test("query and path errors name where the problem is", async () => {
  const badLimit = await (await rawFetch("GET", "/issues?limit=500", { token: landlord.token })).json();
  assert.equal(badLimit.errors[0].field, "query.limit");
  const badId = await (await rawFetch("GET", "/issues/abc", { token: landlord.token })).json();
  assert.equal(badId.errors[0].field, "path.issueId");
});

test("401, 403, 404 and 409 all use the same Problem shape", async () => {
  const cases = [
    [await rawFetch("GET", "/issues"), 401, "unauthorized"],
    [await rawFetch("POST", "/properties", { token: tenant.token, body: { address: "Nope street 1, Town" } }), 403, "forbidden"],
    [await rawFetch("GET", "/issues/999999", { token: landlord.token }), 404, "not-found"],
    [await rawFetch("POST", "/properties", { token: landlord.token, body: { address: "Contract street 1, Barcelona" } }), 409, "conflict"],
  ];
  for (const [res, status, slug] of cases) {
    assert.equal(res.status, status);
    assert.match(res.headers.get("content-type"), /application\/problem\+json/);
    const body = await res.json();
    assert.equal(body.type, PROBLEM_DOCS + slug);
    assert.equal(body.status, status);
    assert.ok(body.title && body.detail, `${status} has a title and a detail`);
  }
});

test("cursor pagination walks every issue exactly once, and the last page says so", async () => {
  const created = [];
  for (let i = 0; i < 5; i++) {
    const res = await ctx.api("POST", "/issues", {
      token: tenant.token,
      body: { propertyId: property.id, title: `Paging issue ${i}`, description: "Created to test pagination.", category: "other", urgency: i % 2 ? "urgent" : "low" },
    });
    created.push(res.body.id);
  }

  for (const sort of ["priority", "newest", "updated"]) {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await ctx.api("GET", `/issues?q=Paging&limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`, { token: tenant.token });
      assert.equal(res.status, 200);
      assert.ok(res.body.items.length <= 2);
      seen.push(...res.body.items.map((i) => i.id));
      cursor = res.body.page.nextCursor;
      assert.equal(res.body.page.hasMore, cursor !== null);
      pages++;
    } while (cursor);
    assert.equal(pages, 3, `${sort}: 5 items at 2 per page = 3 pages`);
    assert.deepEqual([...seen].sort(), [...created].sort(), `${sort}: every issue once, no duplicates or gaps`);
  }

  const newest = await ctx.api("GET", "/issues?q=Paging&sort=newest", { token: tenant.token });
  assert.deepEqual(newest.body.items.map((i) => i.id), [...created].reverse(), "newest first");
  const priority = await ctx.api("GET", "/issues?q=Paging&sort=priority", { token: tenant.token });
  assert.ok(priority.body.items.slice(0, 2).every((i) => i.urgency === "urgent"), "urgent first");
});

test("filters combine, and a bad cursor is a 400 on query.cursor", async () => {
  const urgent = await ctx.api("GET", "/issues?q=Paging&urgency=urgent&category=other", { token: tenant.token });
  assert.equal(urgent.body.items.length, 2);
  assert.ok(urgent.body.items.every((i) => i.urgency === "urgent" && i.category === "other"));

  const bad = await ctx.api("GET", "/issues?cursor=not-a-real-cursor", { token: tenant.token });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors[0].field, "query.cursor");

  const page1 = await ctx.api("GET", "/issues?limit=1&sort=newest", { token: tenant.token });
  const wrongSort = await ctx.api("GET", `/issues?limit=1&sort=priority&cursor=${page1.body.page.nextCursor}`, { token: tenant.token });
  assert.equal(wrongSort.status, 400, "a cursor only works with the sort it came from");
});

test("properties are paginated the same way", async () => {
  for (let i = 0; i < 3; i++) {
    await ctx.api("POST", "/properties", { token: landlord.token, body: { address: `Paging avenue ${i}, Barcelona` } });
  }
  const first = await ctx.api("GET", "/properties?limit=2", { token: landlord.token });
  assert.equal(first.body.items.length, 2);
  assert.equal(first.body.page.hasMore, true);
  const second = await ctx.api("GET", `/properties?limit=2&cursor=${first.body.page.nextCursor}`, { token: landlord.token });
  assert.equal(second.body.items.length, 2);
  assert.equal(second.body.page.hasMore, false);
  assert.equal(new Set([...first.body.items, ...second.body.items].map((p) => p.id)).size, 4);

  const searched = await ctx.api("GET", "/properties?q=paging%20avenue%201", { token: landlord.token });
  assert.deepEqual(searched.body.items.map((p) => p.addressInput), ["Paging avenue 1, Barcelona"]);
});

test("nullable fields are present and null, never missing or empty", async () => {
  const { body } = await ctx.api("GET", `/issues?q=Paging&limit=1`, { token: tenant.token });
  const issue = body.items[0];
  for (const field of ["assignee", "assignedAt", "acknowledgedAt", "resolvedAt", "closedAt"]) {
    assert.ok(field in issue, `${field} is present`);
    assert.equal(issue[field], null, `${field} is null, not "" or missing`);
  }
  assert.deepEqual(issue.confirmations, { tenant: null, landlord: null });
});
