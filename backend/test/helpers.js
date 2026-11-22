// Shared test setup. Not a test itself: `npm test` runs only files ending in .test.js.
//
// Every test file (node --test runs each in its own process) gets:
//   - its own empty PostgreSQL schema in the real Docker database, with the real
//     migrations applied and dropped again afterwards. Tests use real Postgres, so they
//     test the real SQL, never touch your data, and can run in parallel;
//   - a throwaway folder for uploaded photos;
//   - a fake geocoder, so tests never call OpenStreetMap;
//   - helpers to start the API and call it.
//
// Needs the database running: `docker compose up -d db`.

import "dotenv/config";
import { before, after } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { createApp } from "../src/server.js";
import { closeDb, initDb } from "../src/db/index.js";

process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";

// Every connection the app opens in this process uses the private schema.
export const testSchema = `test_${process.pid}_${randomBytes(3).toString("hex")}`;
process.env.PGOPTIONS = `-c search_path=${testSchema}`;

function adminClient() {
  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  return new pg.Client({ host: PGHOST, port: Number(PGPORT), database: PGDATABASE, user: PGUSER, password: PGPASSWORD });
}

/** Create the private schema and migrate it. Call once per file; the result is shared. */
let dbReady;
export function useTestDatabase() {
  dbReady ??= (async () => {
    const client = adminClient();
    try {
      await client.connect();
    } catch (err) {
      throw new Error(`Tests need PostgreSQL. Start it with \`docker compose up -d db\` (${err.message})`);
    }
    await client.query(`CREATE SCHEMA ${testSchema}`);
    await client.end();
    await initDb();
  })();
  before(() => dbReady);
  after(async () => {
    await closeDb();
    const client = adminClient();
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await client.end();
  });
  return dbReady;
}
// Uploaded photos go to a throwaway folder per test file, removed afterwards.
export const uploadDir = mkdtempSync(path.join(tmpdir(), "fixit-test-uploads-"));
process.env.UPLOAD_DIR = uploadDir;

/** A real 1x1 PNG, the smallest file that passes the image-signature check. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Fake geocoder: known addresses resolve, "NOWHERE" matches nothing, "BOOM" throws. */
export const fakeGeocoder = {
  calls: [],
  async geocode(address) {
    this.calls.push(address);
    if (address.includes("BOOM")) throw new Error("Nominatim returned 503");
    if (address.includes("NOWHERE")) return null;
    return {
      streetAddress: "401 Carrer de Mallorca",
      city: "Barcelona",
      postcode: "08013",
      country: "Spain",
      countryCode: "es",
      latitude: 41.4031876,
      longitude: 2.1748235,
      displayName: "401, Carrer de Mallorca, Barcelona, Spain",
    };
  },
};

export function startServer() {
  const ctx = { baseUrl: null };
  let server;
  // Start right away rather than in a before() hook: other files' own before() hooks
  // call ctx.api, and every call awaits `ready`, so ordering between hooks can't matter.
  const dbReady = useTestDatabase();
  const ready = dbReady.then(
    () =>
      new Promise((resolve) => {
        const app = createApp({ geocoder: fakeGeocoder, logError: () => {} });
        server = app.listen(0, () => {
          ctx.baseUrl = `http://127.0.0.1:${server.address().port}/api`;
          resolve();
        });
      }),
  );
  before(() => ready);
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(uploadDir, { recursive: true, force: true });
  });

  /** multipart POST: fields + files ([{ name, type, data: Buffer }]) under "photos". */
  ctx.upload = async (urlPath, { token, fields = {}, files = [], headers: extraHeaders = {} }) => {
    await ready;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    for (const f of files) form.append("photos", new Blob([f.data], { type: f.type ?? "image/png" }), f.name ?? "photo.png");
    const res = await fetch(`${ctx.baseUrl}${urlPath}`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: form,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  /** GET returning raw bytes (for photo downloads). */
  ctx.raw = async (urlPath, { token } = {}) => {
    await ready;
    const res = await fetch(`${ctx.baseUrl.replace(/\/api$/, "")}${urlPath}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  };

  /** api(method, path, { body, token }) -> { status, body } */
  ctx.api = async (method, urlPath, { body, token, headers: extraHeaders = {} } = {}) => {
    await ready;
    const headers = { ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${ctx.baseUrl}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };

  let n = 0;
  /** Register a user and return { token, user }. */
  ctx.signUp = async (role, overrides = {}) => {
    n++;
    const res = await ctx.api("POST", "/auth/register", {
      body: {
        email: `${role}${n}@example.test`,
        name: `${role[0].toUpperCase()}${role.slice(1)} Person${n}`,
        password: "password123",
        role,
        ...(role === "worker" ? { trade: "plumber", area: "Barcelona" } : {}),
        ...overrides,
      },
    });
    if (res.status !== 201) throw new Error(`signUp failed: ${JSON.stringify(res.body)}`);
    return res.body;
  };

  return ctx;
}
