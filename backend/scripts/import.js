#!/usr/bin/env node
// Import a landlord's properties from a CSV file, geocoding each address via OpenStreetMap.
//
//   npm run import                                   samples/properties.csv -> landlord@fixit.test
//   npm run import -- --file my.csv --landlord me@example.com
//   npm run import -- --refresh                      look every address up again
//
// Safe to run as often as you like: re-running never creates duplicates (see
// src/import/importProperties.js). Geocoding is paced at 1 request/second, as
// Nominatim's usage policy requires, so a first run of N new addresses takes ~N seconds.

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { initDb, closeDb, one } from "../src/db/index.js";
import { importProperties } from "../src/import/importProperties.js";
import { NominatimClient, noGeocoder } from "../src/utils/geocode.js";

const { values: args } = parseArgs({
  options: {
    file: { type: "string", default: path.join(import.meta.dirname, "..", "samples", "properties.csv") },
    landlord: { type: "string", default: process.env.IMPORT_LANDLORD_EMAIL || "landlord@fixit.test" },
    refresh: { type: "boolean", default: false },
  },
});

const geocoder = process.env.NOMINATIM_USER_AGENT
  ? new NominatimClient({ userAgent: process.env.NOMINATIM_USER_AGENT, language: process.env.GEOCODE_LANGUAGE || "en" })
  : noGeocoder;

const ICON = { created: "+ created  ", updated: "~ updated  ", unchanged: "= unchanged", error: "! error    " };

async function main() {
  const csvText = readFileSync(args.file, "utf8");
  await initDb();

  const before = await one(`SELECT count(*)::int AS n FROM properties p JOIN users u ON u.id = p.landlord_id WHERE lower(u.email) = lower($1)`, [args.landlord]);
  console.log(`Importing ${path.relative(process.cwd(), args.file)} for ${args.landlord}${args.refresh ? " (refreshing every location)" : ""}`);
  if (geocoder.disabled) console.log("NOMINATIM_USER_AGENT is not set: properties will be saved without map locations.");
  console.log("");

  const { results, skipped, totals } = await importProperties({
    landlordEmail: args.landlord,
    csvText,
    geocoder,
    refresh: args.refresh,
    onRow: (r) => {
      const where = r.geocodeStatus === "ok" ? "" : `  [map: ${r.geocodeStatus}]`;
      const extra = r.error ? `  ${r.error}` : "";
      console.log(`  line ${String(r.line).padStart(3)}  ${ICON[r.outcome]}  ${r.label ?? r.address}${where}${extra}`);
    },
  });

  if (skipped.length) {
    console.log("\nSkipped rows (not imported):");
    for (const s of skipped) console.log(`  line ${String(s.line).padStart(3)}  ${s.reason}`);
  }

  const after = await one(`SELECT count(*)::int AS n FROM properties WHERE landlord_id = (SELECT id FROM users WHERE lower(email) = lower($1))`, [args.landlord]);
  console.log(`
Rows in file:     ${totals.rowsInFile}
Created:          ${totals.created}
Updated:          ${totals.updated}
Unchanged:        ${totals.unchanged}
Skipped:          ${totals.skipped}
Errors:           ${totals.errors}
Geocoding calls:  ${totals.geocodeCalls}
Not on the map:   ${totals.notOnMap} (OpenStreetMap found no match, or the lookup failed)
Properties for ${args.landlord}: ${before.n} before, ${after.n} after`);
  if (!results.length && !skipped.length) console.log("(the file has a header but no rows)");
}

main()
  .catch((err) => {
    console.error(`Import failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
