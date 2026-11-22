// The import itself: CSV -> parser -> Nominatim (geocode) -> repository (Postgres).
// Used by `npm run import` (scripts/import.js).
//
// Idempotent: every row is written with an upsert keyed on (landlord, normalized
// address). Running the same file twice creates nothing new: the second run reports
// every row as "unchanged" and doesn't even call Nominatim again for addresses it
// already found. Changing a label in the CSV and re-running updates that property.

import { findUserByEmail } from "../models/users.js";
import { upsertPropertyForImport } from "../models/properties.js";
import { parsePropertyCsv } from "./csvParser.js";

/**
 * @param {{ landlordEmail: string, csvText: string, geocoder: object, refresh?: boolean,
 *           onRow?: (result: object) => void }} options
 * @returns {Promise<{ landlord: object, results: object[], skipped: object[], totals: object }>}
 */
export async function importProperties({ landlordEmail, csvText, geocoder, refresh = false, onRow = () => {} }) {
  const landlord = await findUserByEmail(landlordEmail);
  if (!landlord) throw new Error(`no account with email ${landlordEmail}. Run \`npm run seed\` or sign up as that landlord first`);
  if (landlord.role !== "landlord") throw new Error(`${landlordEmail} is a ${landlord.role} account, not a landlord`);

  const { records, skipped } = parsePropertyCsv(csvText);
  const results = [];

  for (const record of records) {
    let result;
    try {
      const r = await upsertPropertyForImport(landlord.id, record, geocoder, { refresh });
      result = { ...record, ...r };
    } catch (err) {
      // A database error on one row (unexpected) is reported, and the import goes on.
      result = { ...record, outcome: "error", error: err.message };
    }
    results.push(result);
    onRow(result);
  }

  const count = (pred) => results.filter(pred).length;
  return {
    landlord,
    results,
    skipped,
    totals: {
      rowsInFile: records.length + skipped.length,
      created: count((r) => r.outcome === "created"),
      updated: count((r) => r.outcome === "updated"),
      unchanged: count((r) => r.outcome === "unchanged"),
      errors: count((r) => r.outcome === "error"),
      skipped: skipped.length,
      geocodeCalls: count((r) => r.geocoded),
      notOnMap: count((r) => r.geocodeStatus && r.geocodeStatus !== "ok"),
    },
  };
}
