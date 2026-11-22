// The PostgreSQL connection pool, plus small helpers the repository layer (src/models/)
// uses. Nothing outside src/db and src/models talks to the database.
//
// Connection settings come from the standard PG* environment variables (.env):
// PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD. Tests also set PGOPTIONS to give each
// test file its own Postgres schema (see test/helpers.js).

import pg from "pg";
import { migrate } from "./migrate.js";

let pool;
let ready;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      options: process.env.PGOPTIONS,
      max: 10,
    });
    // An idle connection dropping (e.g. the database restarting) must not crash the API.
    pool.on("error", (err) => console.error(`Postgres connection error: ${err.message}`));
  }
  return pool;
}

/**
 * Connect and apply pending migrations, once per process. Call (and await) before the
 * first query; server.js and every script do.
 */
export function initDb() {
  ready ??= migrate(getPool())
    .then((result) => {
      if (result.applied.length) console.log(`Database migrated: ${result.applied.join(", ")}`);
      return result;
    })
    .catch((err) => {
      ready = undefined; // let a later call try again
      throw err;
    });
  return ready;
}

/** Run a query on the pool. `q` lets a caller pass a transaction's client instead. */
export function query(text, params, q = getPool()) {
  return q.query(text, params);
}

export async function one(text, params, q) {
  const { rows } = await query(text, params, q);
  return rows[0] ?? null;
}

export async function many(text, params, q) {
  const { rows } = await query(text, params, q);
  return rows;
}

/**
 * Run `fn(client)` inside BEGIN/COMMIT. Any error rolls everything back. Use the given
 * client for every query that must be part of the transaction.
 */
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Builds a parameter list while writing SQL: `p(value)` adds the value and returns its
 * placeholder ($1, $2...). Keeps values out of the SQL text (no SQL injection) without
 * counting placeholders by hand.
 */
export function params() {
  const values = [];
  const p = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  p.values = values;
  return p;
}

/** Date from Postgres -> ISO-8601 UTC string for the API ("2026-01-01T10:00:00.000Z"). */
export function iso(date) {
  return date ? new Date(date).toISOString() : null;
}

export async function ping() {
  await getPool().query("SELECT 1");
}

/** Postgres error codes we turn into friendly responses. */
export const PG = { UNIQUE_VIOLATION: "23505", FOREIGN_KEY_VIOLATION: "23503" };

export async function closeDb() {
  if (pool) {
    const p = pool;
    pool = undefined;
    ready = undefined;
    await p.end();
  }
}
