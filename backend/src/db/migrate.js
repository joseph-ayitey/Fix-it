// Brings a PostgreSQL database up to date: creates the schema on an empty database and
// applies any newer migrations. Runs automatically whenever the API or a script opens the
// database (src/db/index.js -> initDb), so there is nothing to run by hand.
//
// How it knows what's been done: a table, schema_migrations, records every version that
// has been applied. Version 1 is src/db/schema.sql. Later versions are files in
// src/db/migrations/ named NNN_description.sql (002_add_repair_cost.sql, ...).
//
// Safety:
//   - Each version runs inside a transaction. Postgres can roll back schema changes
//     (CREATE/ALTER TABLE) too, so a failing migration leaves the database exactly as it
//     was, and the error stops startup instead of the app running on a half-changed schema.
//   - An advisory lock makes sure that if two processes start at once (say the API and
//     `npm run import`), only one migrates and the other waits for it.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(here, "schema.sql");
const MIGRATIONS_DIR = path.join(here, "migrations");
const LOCK_ID = 7_340_201; // any constant number; identifies "FixIt migrations" to pg_advisory_lock

/** All known versions, in order: [{ version, name, sql }]. */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const list = [{ version: 1, name: "initial_schema", sql: readFileSync(SCHEMA_FILE, "utf8") }];
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match) throw new Error(`migration file "${file}" must be named like 002_add_something.sql`);
    list.push({ version: Number(match[1]), name: match[2], sql: readFileSync(path.join(dir, file), "utf8") });
  }
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migrations must be numbered 001, 002, 003... in order; found ${m.version} where ${i + 1} was expected`);
  });
  return list;
}

/**
 * @param {import("pg").Pool} pool
 * @returns {Promise<{ from: number, to: number, applied: string[] }>}
 */
export async function migrate(pool, migrations = loadMigrations()) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    integer PRIMARY KEY,
        name       text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query("SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations");
    const from = rows[0].v;

    const applied = [];
    for (const m of migrations) {
      if (m.version <= from) continue;
      try {
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        err.message = `migration ${m.version} (${m.name}) failed and was rolled back: ${err.message}`;
        throw err;
      }
      applied.push(`${m.version} ${m.name}`);
    }
    return { from, to: migrations.at(-1).version, applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}
