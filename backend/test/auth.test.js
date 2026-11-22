import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const ctx = startServer();

test("health reports the database as up", async () => {
  const res = await ctx.api("GET", "/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.database, "up");
});

test("register returns a token and a user without the password hash", async () => {
  const res = await ctx.api("POST", "/auth/register", {
    body: { email: "Maria@Example.com", name: "Maria", password: "password123", role: "landlord" },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.deepEqual(Object.keys(res.body.user).sort(), ["createdAt", "email", "id", "name", "role"]);
  assert.equal(res.body.user.email, "maria@example.com", "email is lowercased");
});

test("register rejects a duplicate email (case-insensitive) with 409", async () => {
  const res = await ctx.api("POST", "/auth/register", {
    body: { email: "MARIA@example.com", name: "Other", password: "password123", role: "tenant" },
  });
  assert.equal(res.status, 409);
});

test("register lists every validation problem at once", async () => {
  const res = await ctx.api("POST", "/auth/register", {
    body: { email: "nope", name: "", password: "short", role: "admin", extra: 1 },
  });
  assert.equal(res.status, 400);
  const fields = res.body.errors.map((d) => d.field).sort();
  assert.deepEqual(fields, ["email", "extra", "name", "password", "role"]);
});

test("login works with the right password and gives one vague error otherwise", async () => {
  const ok = await ctx.api("POST", "/auth/login", { body: { email: "maria@example.com", password: "password123" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, "Maria");

  const wrongPassword = await ctx.api("POST", "/auth/login", { body: { email: "maria@example.com", password: "nope-nope" } });
  const noUser = await ctx.api("POST", "/auth/login", { body: { email: "ghost@example.com", password: "password123" } });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPassword.body.detail, noUser.body.detail, "must not reveal which emails exist");
});

test("/auth/me needs a valid token", async () => {
  const { token } = await ctx.signUp("tenant");
  assert.equal((await ctx.api("GET", "/auth/me", { token })).status, 200);
  assert.equal((await ctx.api("GET", "/auth/me")).status, 401);
  assert.equal((await ctx.api("GET", "/auth/me", { token: token.slice(0, -2) + "xx" })).status, 401);
});

test("malformed JSON and unknown endpoints get clean JSON errors", async () => {
  assert.equal((await ctx.api("POST", "/auth/login", { body: "{oops" })).status, 400);
  const missing = await ctx.api("GET", "/nope");
  assert.equal(missing.status, 404);
  assert.ok(missing.body.detail);
});
