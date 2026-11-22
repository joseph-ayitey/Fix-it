import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const ctx = startServer();

test("a landlord adds a property: it's geocoded and gets a join code", async () => {
  const landlord = await ctx.signUp("landlord");
  const res = await ctx.api("POST", "/properties", {
    token: landlord.token,
    body: { address: "Carrer de Mallorca 401, Barcelona, Spain", label: "Eixample flat" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.geocodeStatus, "ok");
  assert.equal(res.body.latitude, 41.4031876);
  assert.match(res.body.joinCode, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(res.body.openIssueCount, 0);
});

test("adding the same address twice is a 409, not a duplicate", async () => {
  const landlord = await ctx.signUp("landlord");
  const body = { address: "Carrer de Balmes 150, Barcelona" };
  assert.equal((await ctx.api("POST", "/properties", { token: landlord.token, body })).status, 201);
  assert.equal((await ctx.api("POST", "/properties", { token: landlord.token, body })).status, 409);
  assert.equal((await ctx.api("GET", "/properties", { token: landlord.token })).body.length, 1);
});

test("a failed or no-match geocode still saves the property, and can be retried", async () => {
  const landlord = await ctx.signUp("landlord");
  const noMatch = await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "NOWHERE street 1" } });
  assert.equal(noMatch.status, 201);
  assert.equal(noMatch.body.geocodeStatus, "no_match");
  assert.equal(noMatch.body.latitude, null);

  const failed = await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "BOOM street 1" } });
  assert.equal(failed.status, 201);
  assert.equal(failed.body.geocodeStatus, "failed");

  const retry = await ctx.api("POST", `/properties/${noMatch.body.id}/geocode`, { token: landlord.token });
  assert.equal(retry.body.geocodeStatus, "no_match");
});

test("tenants can't add properties", async () => {
  const tenant = await ctx.signUp("tenant");
  const res = await ctx.api("POST", "/properties", { token: tenant.token, body: { address: "Somewhere 12, Town" } });
  assert.equal(res.status, 403);
});

test("a tenant joins with the code (any case, with dashes), and sees the property but not its code", async () => {
  const landlord = await ctx.signUp("landlord");
  const tenant = await ctx.signUp("tenant");
  const { body: property } = await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Join street 1, Barcelona" } });

  const typed = `${property.joinCode.slice(0, 4).toLowerCase()}-${property.joinCode.slice(4)}`;
  const joined = await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: typed } });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.id, property.id);
  assert.equal(joined.body.joinCode, undefined, "tenants must not see (and re-share) the join code");

  const again = await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });
  assert.equal(again.status, 200, "joining twice is harmless");

  const list = await ctx.api("GET", "/properties", { token: tenant.token });
  assert.deepEqual(list.body.map((p) => p.id), [property.id]);

  const detail = await ctx.api("GET", `/properties/${property.id}`, { token: landlord.token });
  assert.deepEqual(detail.body.tenants.map((t) => t.id), [tenant.user.id]);
});

test("a wrong code is a 404 and rotating the code invalidates the old one", async () => {
  const landlord = await ctx.signUp("landlord");
  const tenant = await ctx.signUp("tenant");
  const { body: property } = await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Rotate street 2, Barcelona" } });

  assert.equal((await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: "ZZZZZZZZ" } })).status, 404);

  const rotated = await ctx.api("POST", `/properties/${property.id}/join-code`, { token: landlord.token });
  assert.notEqual(rotated.body.joinCode, property.joinCode);
  assert.equal((await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } })).status, 404);
  assert.equal((await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: rotated.body.joinCode } })).status, 201);
});

test("other people's properties are invisible (404), not just forbidden", async () => {
  const owner = await ctx.signUp("landlord");
  const otherLandlord = await ctx.signUp("landlord");
  const stranger = await ctx.signUp("tenant");
  const { body: property } = await ctx.api("POST", "/properties", { token: owner.token, body: { address: "Private street 3, Barcelona" } });

  assert.equal((await ctx.api("GET", `/properties/${property.id}`, { token: otherLandlord.token })).status, 404);
  assert.equal((await ctx.api("GET", `/properties/${property.id}`, { token: stranger.token })).status, 404);
  assert.equal((await ctx.api("POST", `/properties/${property.id}/join-code`, { token: otherLandlord.token })).status, 404);
  assert.equal((await ctx.api("GET", "/properties/abc", { token: owner.token })).status, 404);
});

test("a landlord can rename a property and remove a tenant", async () => {
  const landlord = await ctx.signUp("landlord");
  const tenant = await ctx.signUp("tenant");
  const { body: property } = await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Tenancy street 4, Barcelona" } });
  await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });

  const renamed = await ctx.api("PATCH", `/properties/${property.id}`, { token: landlord.token, body: { label: "Top floor" } });
  assert.equal(renamed.body.label, "Top floor");

  const removed = await ctx.api("DELETE", `/properties/${property.id}/tenants/${tenant.user.id}`, { token: landlord.token });
  assert.equal(removed.status, 204);
  assert.equal((await ctx.api("GET", `/properties/${property.id}`, { token: tenant.token })).status, 404);
});
