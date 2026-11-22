// Parser for the property import CSV: turns a landlord's spreadsheet export into clean
// { label, address } records, and collects a reason for every row it can't use instead
// of crashing. One bad row never stops the import.
//
// Expected columns (header row required, any order, case-insensitive):
//   address   required  e.g. "Carrer de Mallorca 401, Barcelona, Spain"
//   label     optional  the landlord's nickname, e.g. "Eixample flat" (alias: nickname)
//
// Decisions about messy input:
//   - Byte-order mark, Windows line endings, blank lines, quoted fields with commas: handled.
//   - Extra spaces anywhere are tidied ("  Carrer   de Pau Claris 100 ,Barcelona" ->
//     "Carrer de Pau Claris 100, Barcelona"). What's left is kept exactly as written.
//   - Empty label -> null, never "".
//   - Missing or implausible address (too short, no letters, too long) -> that row is
//     skipped with a reason.
//   - The same address twice in one file (ignoring case and spacing) -> the later row is
//     skipped as a duplicate, so one file can't contradict itself.
//   - Unknown extra columns are ignored, so an export with more columns still works.
//   - Rows with a different number of fields than the header are skipped with a reason.

import { parse } from "csv-parse/sync";
import { addressKey } from "../models/properties.js";

const MAX_ADDRESS = 500;
const MAX_LABEL = 200;
const HEADER_ALIASES = { address: "address", label: "label", nickname: "label", name: "label" };

/** Collapse runs of spaces and tidy spaces around commas. */
export function tidy(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
}

/**
 * @param {string} text the CSV file's contents
 * @returns {{ records: Array<{ line: number, label: string|null, address: string }>,
 *             skipped: Array<{ line: number, reason: string, raw: string }> }}
 * @throws Error only when the file as a whole can't be read (e.g. no address column)
 */
export function parsePropertyCsv(text) {
  let rows;
  try {
    rows = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true, // judge wrong field counts per row below, not for the whole file
      info: true,
      trim: false,
    });
  } catch (err) {
    throw new Error(`the CSV file can't be read: ${err.message}`);
  }
  if (!rows.length) throw new Error("the CSV file is empty");

  const header = rows[0].record.map((h) => HEADER_ALIASES[tidy(h).toLowerCase()] ?? null);
  const addressCol = header.indexOf("address");
  const labelCol = header.indexOf("label");
  if (addressCol === -1) {
    throw new Error(`the CSV needs an "address" column; found: ${rows[0].record.map(tidy).join(", ") || "(nothing)"}`);
  }

  const records = [];
  const skipped = [];
  const firstLineFor = new Map(); // addressKey -> line, to spot duplicates within the file

  for (const { record, info } of rows.slice(1)) {
    const line = info.lines;
    const raw = record.join(",");
    const skip = (reason) => skipped.push({ line, reason, raw });

    if (record.every((field) => tidy(field) === "")) continue; // a row of empty cells, e.g. ",,"
    if (record.length !== header.length) {
      skip(`has ${record.length} fields but the header has ${header.length} (a comma inside an address needs "quotes")`);
      continue;
    }

    const address = tidy(record[addressCol]);
    const label = labelCol === -1 ? null : tidy(record[labelCol]) || null;

    if (!address) {
      skip("address is empty");
      continue;
    }
    if (address.length < 5 || !/\p{L}/u.test(address)) {
      skip(`"${address}" doesn't look like an address`);
      continue;
    }
    if (address.length > MAX_ADDRESS) {
      skip(`address is longer than ${MAX_ADDRESS} characters`);
      continue;
    }
    if (label && label.length > MAX_LABEL) {
      skip(`label is longer than ${MAX_LABEL} characters`);
      continue;
    }

    const key = addressKey(address);
    if (firstLineFor.has(key)) {
      skip(`same address as line ${firstLineFor.get(key)}`);
      continue;
    }
    firstLineFor.set(key, line);
    records.push({ line, label, address });
  }

  return { records, skipped };
}
