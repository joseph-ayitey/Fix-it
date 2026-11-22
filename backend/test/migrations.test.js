// The migration runner and the schema's own rules, against real PostgreSQL (a private
// schema per test file; see helpers.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestDatabase } from "./helpers.js";
import { getPool, many, one, query } from "../src/db/index.js";
import { loadMigrations, migrate } from "../src/db/migrate.js";

useTestDatabase(); // applies the real migrations once, like the API does on startup

const REAL_DIR = fileURLToPath(new URL("../src/db/migrations/", import.meta.url));
const REAL_FILES = readdirSync(REAL_DIR).filter((f) => f.endsWith(".sql"));
const NEXT = String(REAL_FILES.length + 2).padStart(3, "0"); // the next free version number
const AFTER_NEXT = String(REAL_FILES.length + 3).padStart(3, "0");

/** A temporary migrations folder: the real migrations (optional) plus the given files. */
function migrationsDir(files, { withReal = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "fixit-migrations-"));
  if (withReal) for (const f of REAL_FILES) copyFileSync(path.join(REAL_DIR, f), path.join(dir, f));
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

const columns = async (table) =>
  (await many(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table])).map(
    (c) => c.column_name,
  );

test("the schema is applied once and recorded; running again does nothing", async () => {
  const applied = await many(`SELECT version, name FROM schema_migrations ORDER BY version`);
  assert.deepEqual(applied.map((m) => m.version), loadMigrations().map((m) => m.version));
  assert.deepEqual(applied[0], { version: 1, name: "initial_schema" });
  const again = await migrate(getPool());
  assert.deepEqual(again.applied, []);
});

test("a new migration applies to an existing database and keeps its data", async () => {
  await query(`INSERT INTO users (email, name, password_hash, role) VALUES ('keep@x.test', 'Keep', 'h', 'landlord')`);
  const dir = migrationsDir({ [`${NEXT}_add_phone.sql`]: "ALTER TABLE users ADD COLUMN phone text;" });

  const result = await migrate(getPool(), loadMigrations(dir));
  assert.deepEqual(result.applied, [`${Number(NEXT)} add_phone`]);
  assert.ok((await columns("users")).includes("phone"));
  assert.equal((await one(`SELECT name, phone FROM users WHERE email = 'keep@x.test'`)).name, "Keep");

  assert.deepEqual((await migrate(getPool(), loadMigrations(dir))).applied, [], "never applied twice");
});

test("a failing migration is rolled back completely and stops startup", async () => {
  const dir = migrationsDir({
    [`${NEXT}_add_phone.sql`]: "ALTER TABLE users ADD COLUMN phone text;", // already applied above
    [`${AFTER_NEXT}_half_broken.sql`]: "ALTER TABLE issues ADD COLUMN notes text;\nTHIS IS NOT SQL;",
  });
  await assert.rejects(
    () => migrate(getPool(), loadMigrations(dir)),
    new RegExp(`migration ${Number(AFTER_NEXT)} \\(half_broken\\) failed and was rolled back`),
  );
  assert.ok(!(await columns("issues")).includes("notes"), "the statement before the error must be undone too");
  assert.equal((await one(`SELECT max(version)::int AS v FROM schema_migrations`)).v, Number(NEXT));
});

test("badly named or numbered migration files are refused before anything runs", () => {
  assert.throws(() => loadMigrations(migrationsDir({ "2_oops.sql": "" }, { withReal: false })), /named like 002_add_something/);
  assert.throws(() => loadMigrations(migrationsDir({ "005_skips_some.sql": "" }, { withReal: false })), /numbered 001, 002/);
});

test("the schema itself rejects bad data", async () => {
  await assert.rejects(
    () => query(`INSERT INTO users (email, name, password_hash, role) VALUES ('a@x.test', 'A', 'h', 'admin')`),
    /users_role_check/,
    "unknown roles are refused by a CHECK constraint",
  );
  await assert.rejects(
    () => query(`INSERT INTO users (email, name, password_hash, role, trade) VALUES ('b@x.test', 'B', 'h', 'tenant', 'plumber')`),
    /users_trade_only_workers/,
    "only workers have a trade",
  );
  await assert.rejects(
    () => query(`INSERT INTO users (email, name, password_hash, role) VALUES ('KEEP@X.TEST', 'Dup', 'h', 'tenant')`),
    /users_email_key/,
    "emails are unique regardless of case",
  );
  const landlord = await one(`SELECT id FROM users WHERE email = 'keep@x.test'`);
  await query(`INSERT INTO properties (landlord_id, address_input, address_key, join_code) VALUES ($1, 'A 1', 'a 1', 'AAAA2222')`, [landlord.id]);
  await assert.rejects(
    () => query(`INSERT INTO properties (landlord_id, address_input, address_key, join_code) VALUES ($1, 'a  1', 'a 1', 'BBBB2222')`, [landlord.id]),
    /properties_landlord_address_key/,
    "the same address can't be stored twice for one landlord",
  );
  await assert.rejects(
    () => query(`UPDATE properties SET latitude = 123 WHERE landlord_id = $1`, [landlord.id]),
    /latitude_check/,
    "impossible coordinates are refused",
  );
});
