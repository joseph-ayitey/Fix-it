import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { startServer, TINY_PNG, uploadDir } from "./helpers.js";

const ctx = startServer();

let landlord;
let tenant;
let property;

const ISSUE_FIELDS = {
  title: "Mould on bathroom ceiling",
  description: "Black mould spreading above the shower.",
  category: "pest",
};

before(async () => {
  landlord = await ctx.signUp("landlord");
  tenant = await ctx.signUp("tenant");
  property = (await ctx.api("POST", "/properties", { token: landlord.token, body: { address: "Photo street 1, Barcelona" } })).body;
  await ctx.api("POST", "/properties/join", { token: tenant.token, body: { code: property.joinCode } });
  ISSUE_FIELDS.propertyId = property.id;
});

const filesOnDisk = () => readdirSync(uploadDir).length;

test("a tenant reports an issue with photos; they're attached to the 'reported' event", async () => {
  const res = await ctx.upload("/issues", {
    token: tenant.token,
    fields: ISSUE_FIELDS,
    files: [
      { name: "ceiling.png", data: TINY_PNG },
      { name: "close-up.png", data: TINY_PNG },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.photoCount, 2);
  const reported = res.body.events.find((e) => e.type === "reported");
  assert.deepEqual(reported.photos.map((p) => p.originalName), ["ceiling.png", "close-up.png"]);
  assert.equal(reported.photos[0].mimeType, "image/png");
});

test("both the tenant and the landlord can download the photo; nobody else can", async () => {
  const { body: issue } = await ctx.upload("/issues", { token: tenant.token, fields: ISSUE_FIELDS, files: [{ data: TINY_PNG }] });
  const url = issue.events[0].photos[0].url;

  for (const who of [tenant, landlord]) {
    const res = await ctx.raw(url, { token: who.token });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.bytes.equals(TINY_PNG), "must serve exactly the uploaded bytes");
  }

  const stranger = await ctx.signUp("landlord");
  assert.equal((await ctx.raw(url, { token: stranger.token })).status, 404);
  assert.equal((await ctx.raw(url)).status, 401);
});

test("a file that only pretends to be an image is rejected, and nothing is saved", async () => {
  const before = filesOnDisk();
  const res = await ctx.upload("/issues", {
    token: tenant.token,
    fields: { ...ISSUE_FIELDS, title: "Sneaky upload" },
    files: [
      { name: "ok.png", data: TINY_PNG },
      { name: "evil.png", type: "image/png", data: Buffer.from("<script>alert(1)</script> not really a png") },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.detail, /evil\.png/);
  assert.deepEqual(res.body.errors.map((e) => e.field), ["photos"], "the contract's field name for photo problems");
  assert.equal(filesOnDisk(), before, "the valid photo in the same request must not be left on disk either");

  const list = await ctx.api("GET", "/issues", { token: tenant.token });
  assert.ok(!list.body.items.some((i) => i.title === "Sneaky upload"), "the issue must not be created");
});

test("too many photos is a clear 400; an invalid report stores no files", async () => {
  const before = filesOnDisk();
  const six = Array.from({ length: 6 }, () => ({ data: TINY_PNG }));
  const tooMany = await ctx.upload("/issues", { token: tenant.token, fields: ISSUE_FIELDS, files: six });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.detail, /at most 5 photos/);
  assert.equal(tooMany.body.errors[0].field, "photos");

  const badFields = await ctx.upload("/issues", { token: tenant.token, fields: { ...ISSUE_FIELDS, category: "nope" }, files: [{ data: TINY_PNG }] });
  assert.equal(badFields.status, 400);
  assert.equal(filesOnDisk(), before);
});

test("a photo larger than 8 MB gets a 413", async () => {
  const big = Buffer.concat([TINY_PNG, Buffer.alloc(8 * 1024 * 1024)]);
  const res = await ctx.upload("/issues", { token: tenant.token, fields: ISSUE_FIELDS, files: [{ data: big }] });
  assert.equal(res.status, 413);
  assert.match(res.body.detail, /8 MB/);
});

test("the landlord can post a photo-only comment (e.g. the finished repair)", async () => {
  const { body: issue } = await ctx.api("POST", "/issues", { token: tenant.token, body: ISSUE_FIELDS });
  const res = await ctx.upload(`/issues/${issue.id}/comments`, {
    token: landlord.token,
    files: [{ name: "after.png", data: TINY_PNG }],
  });
  assert.equal(res.status, 201);
  const comment = res.body.events.find((e) => e.type === "comment");
  assert.equal(comment.body, null);
  assert.equal(comment.photos[0].originalName, "after.png");
  assert.ok(res.body.acknowledgedAt, "a landlord's photo counts as a response");

  const empty = await ctx.api("POST", `/issues/${issue.id}/comments`, { token: landlord.token, body: {} });
  assert.equal(empty.status, 400, "a comment needs text or a photo");
});

test("JSON reports without photos still work", async () => {
  const res = await ctx.api("POST", "/issues", { token: tenant.token, body: ISSUE_FIELDS });
  assert.equal(res.status, 201);
  assert.equal(res.body.photoCount, 0);
});

test("uploaded filenames can't be used for path tricks", async () => {
  const res = await ctx.upload("/issues", {
    token: tenant.token,
    fields: ISSUE_FIELDS,
    files: [{ name: "../../../etc/passwd.png", data: TINY_PNG }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.events[0].photos[0].originalName, "passwd.png");
  assert.ok(readdirSync(uploadDir).every((f) => /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/.test(f)));
});
