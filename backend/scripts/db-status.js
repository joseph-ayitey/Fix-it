#!/usr/bin/env node
// What's in the database: connection, applied migrations, and row counts per table.
// Opening the database also applies pending migrations, exactly as the server would.
//
//   npm run db:status

import "dotenv/config";
import { initDb, closeDb, many } from "../src/db/index.js";
import { loadMigrations } from "../src/db/migrate.js";

try {
  await initDb();
  const { PGHOST, PGPORT, PGDATABASE, PGUSER } = process.env;
  const applied = await many(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version`);
  const latest = loadMigrations().at(-1).version;
  const tables = await many(
    `SELECT relname AS name FROM pg_stat_user_tables WHERE schemaname = current_schema() AND relname <> 'schema_migrations' ORDER BY relname`,
  );

  console.log(`Database:   postgres://${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}`);
  console.log(`Migrations: ${applied.map((m) => `${m.version} ${m.name}`).join(", ")} (latest available: ${latest})`);
  console.log("Rows:");
  for (const { name } of tables) {
    const [{ n }] = await many(`SELECT count(*)::int AS n FROM "${name}"`);
    console.log(`  ${name.padEnd(18)} ${n}`);
  }
} catch (err) {
  console.error(`Can't read the database: ${err.message}. Is it running? (docker compose up -d db)`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
