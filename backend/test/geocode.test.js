// The Nominatim client's retry / timeout / rate-limit behavior and the result parser,
// offline: global fetch is stubbed, so these never touch the real (rate-limited) API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GeocodeError, NominatimClient, RateLimiter, parseNominatimResult } from "../src/utils/geocode.js";

function fakeResponse({ ok = true, status = 200, body = [], headers = {} } = {}) {
  return { ok, status, headers: { get: (n) => headers[n] ?? null }, json: async () => body };
}

async function withFakeFetch(sequence, fn) {
  const calls = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = sequence[Math.min(i++, sequence.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const fastClient = (o = {}) =>
  new NominatimClient({
    userAgent: "fixit-test/1.0",
    timeoutMs: 50,
    baseBackoffMs: 1,
    maxBackoffMs: 5,
    maxRetries: 2,
    rateLimiter: new RateLimiter({ maxRequests: 1000, windowMs: 1 }),
    ...o,
  });

const MALLORCA = {
  lat: "41.4031876",
  lon: "2.1748235",
  display_name: "401, Carrer de Mallorca, Barcelona, Spain",
  address: { house_number: "401", road: "Carrer de Mallorca", city: "Barcelona", postcode: "08013", country: "Spain", country_code: "es" },
};

test("requires a User-Agent: Nominatim's policy rejects default ones", () => {
  assert.throws(() => new NominatimClient({}), /userAgent/);
});

test("sends the User-Agent and accept-language, and parses the first match", async () => {
  await withFakeFetch([fakeResponse({ body: [MALLORCA] })], async (calls) => {
    const loc = await fastClient({ language: "en" }).geocode("Carrer de Mallorca 401");
    assert.equal(calls[0].options.headers["User-Agent"], "fixit-test/1.0");
    assert.match(calls[0].url, /accept-language=en/);
    assert.equal(loc.latitude, 41.4031876);
    assert.equal(loc.streetAddress, "401 Carrer de Mallorca");
  });
});

test("no match is null, not an error", async () => {
  await withFakeFetch([fakeResponse({ body: [] })], async () => {
    assert.equal(await fastClient().geocode("nowhere"), null);
  });
});

test("retries 5xx and network errors, then succeeds", async () => {
  await withFakeFetch([fakeResponse({ ok: false, status: 503 }), new TypeError("fetch failed"), fakeResponse({ body: [MALLORCA] })], async (calls) => {
    assert.ok(await fastClient().geocode("x"));
    assert.equal(calls.length, 3);
  });
});

test("does not retry a 403 (policy violation)", async () => {
  await withFakeFetch([fakeResponse({ ok: false, status: 403 })], async (calls) => {
    await assert.rejects(() => fastClient().geocode("x"), (e) => e instanceof GeocodeError && e.status === 403);
    assert.equal(calls.length, 1);
  });
});

test("honors a 429's Retry-After, and gives up after maxRetries", async () => {
  await withFakeFetch([fakeResponse({ ok: false, status: 429, headers: { "Retry-After": "0" } }), fakeResponse({ body: [] })], async (calls) => {
    assert.equal(await fastClient().geocode("x"), null);
    assert.equal(calls.length, 2);
  });
  await withFakeFetch([fakeResponse({ ok: false, status: 500 })], async (calls) => {
    await assert.rejects(() => fastClient({ maxRetries: 2 }).geocode("x"), GeocodeError);
    assert.equal(calls.length, 3);
  });
});

test("the default RateLimiter enforces 1 request per second", async () => {
  const limiter = new RateLimiter();
  const start = Date.now();
  await limiter.wait();
  await limiter.wait();
  assert.ok(Date.now() - start >= 950);
});

test("parser: lat/lon become numbers, missing parts become null, city falls back to town", () => {
  const loc = parseNominatimResult({ lat: "41.39", lon: "2.15", address: { road: "Carrer de Balmes", town: "Barcelona" } });
  assert.equal(typeof loc.latitude, "number");
  assert.equal(loc.city, "Barcelona");
  assert.equal(loc.postcode, null);
  assert.equal(loc.streetAddress, "Carrer de Balmes");
  assert.equal(parseNominatimResult({ lat: "abc", lon: "1" }), null);
});
