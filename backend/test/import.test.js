// The CSV import: parser decisions, and idempotency against real PostgreSQL.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useTestDatabase } from "./helpers.js";
import { many, one } from "../src/db/index.js";
import { createUser } from "../src/models/users.js";
import { parsePropertyCsv, tidy } from "../src/import/csvParser.js";
import { importProperties } from "../src/import/importProperties.js";

const dbReady = useTestDatabase();

/** Geocoder double that counts calls; addresses containing "NOWHERE" don't match, "FLAKY" fails. */
function countingGeocoder() {
  return {
    calls: 0,
    failFlaky: true,
    async geocode(address) {
      this.calls++;
      if (address.includes("NOWHERE")) return null;
      if (address.includes("FLAKY") && this.failFlaky) throw new Error("Nominatim returned 503");
      return { streetAddress: address.split(",")[0], city: "Barcelona", postcode: "08001", country: "Spain", countryCode: "es", latitude: 41.39, longitude: 2.17, displayName: address };
    },
  };
}

const CSV = `label,address
Flat A,"Carrer A 1, Barcelona"
Flat B,"Carrer B 2, Barcelona"
,"Carrer C 3, Barcelona"
Nowhere,"NOWHERE street 9, Nowhereville"
`;

let landlordEmail;
before(async () => {
  await dbReady;
  landlordEmail = (await createUser({ email: "importer@x.test", name: "Importer", password: "password123", role: "landlord" })).email;
});

const countProperties = async () => (await one(`SELECT count(*)::int AS n FROM properties`)).n;

test("parser: tidies spacing, keeps quoted commas, blank label -> null, reports bad rows with line numbers", () => {
  const csv = `﻿Label,ADDRESS,extra\r
"Flat, top floor","  Carrer   de Pau Claris 100 ,Barcelona ",x\r
,"Passeig de Sant Joan 90, Barcelona",\r
Dup,"carrer de pau claris 100,  barcelona",\r
Empty,,\r
Number,12345,\r
Broken,Carrer X 1, Barcelona,too,many\r
,,\r
`;
  const { records, skipped } = parsePropertyCsv(csv);
  assert.deepEqual(records, [
    { line: 2, label: "Flat, top floor", address: "Carrer de Pau Claris 100, Barcelona" },
    { line: 3, label: null, address: "Passeig de Sant Joan 90, Barcelona" },
  ]);
  assert.deepEqual(
    skipped.map((s) => [s.line, s.reason]),
    [
      [4, "same address as line 2"],
      [5, "address is empty"],
      [6, '"12345" doesn\'t look like an address'],
      [7, 'has 5 fields but the header has 3 (a comma inside an address needs "quotes")'],
    ],
  );
});

test("parser: a file without an address column is rejected as a whole, with a clear message", () => {
  assert.throws(() => parsePropertyCsv("name,street\nA,B\n"), /needs an "address" column; found: name, street/);
  assert.throws(() => parsePropertyCsv(""), /empty/);
  assert.equal(tidy("  a ,b  ,  c  "), "a, b, c");
});

test("the sample CSV in the repo parses: 21 usable rows, 4 skipped", () => {
  const { records, skipped } = parsePropertyCsv(readFileSync(new URL("../samples/properties.csv", import.meta.url), "utf8"));
  assert.equal(records.length, 21);
  assert.equal(skipped.length, 4);
});

test("importing twice creates no duplicates and doesn't call the API again", async () => {
  const geocoder = countingGeocoder();
  const first = await importProperties({ landlordEmail, csvText: CSV, geocoder });
  assert.deepEqual(first.totals, { rowsInFile: 4, created: 4, updated: 0, unchanged: 0, errors: 0, skipped: 0, geocodeCalls: 4, notOnMap: 1 });
  assert.equal(await countProperties(), 4);

  const second = await importProperties({ landlordEmail, csvText: CSV, geocoder });
  assert.equal(second.totals.created, 0);
  assert.equal(second.totals.updated, 0);
  assert.equal(second.totals.unchanged, 4);
  assert.equal(geocoder.calls, 4, "no new Nominatim requests on a re-run, not even for the no-match");
  assert.equal(await countProperties(), 4, "row count unchanged");
});

test("the same address typed differently is still the same property", async () => {
  const csv = `label,address\nFlat A,"  carrer a 1 ,barcelona"\n`;
  const result = await importProperties({ landlordEmail, csvText: csv, geocoder: countingGeocoder() });
  assert.equal(result.totals.unchanged, 1);
  assert.equal(await countProperties(), 4);
});

test("a changed label in the CSV updates the existing property instead of adding one", async () => {
  const csv = `label,address\nFlat A (renovated),"Carrer A 1, Barcelona"\n`;
  const result = await importProperties({ landlordEmail, csvText: csv, geocoder: countingGeocoder() });
  assert.equal(result.totals.updated, 1);
  const row = await one(`SELECT label FROM properties WHERE address_key = 'carrer a 1, barcelona'`);
  assert.equal(row.label, "Flat A (renovated)");
  assert.equal(await countProperties(), 4);
});

test("a failed lookup is saved without a map pin, and retried on the next run", async () => {
  const geocoder = countingGeocoder();
  const csv = `label,address\nFlaky,"FLAKY road 5, Barcelona"\n`;
  const first = await importProperties({ landlordEmail, csvText: csv, geocoder });
  assert.equal(first.results[0].geocodeStatus, "failed");
  assert.equal(first.totals.created, 1, "the property is still imported");

  geocoder.failFlaky = false; // the service is back
  const second = await importProperties({ landlordEmail, csvText: csv, geocoder });
  assert.equal(second.results[0].outcome, "updated");
  assert.equal(second.results[0].geocodeStatus, "ok");
  const row = await one(`SELECT latitude FROM properties WHERE address_key = 'flaky road 5, barcelona'`);
  assert.equal(row.latitude, 41.39);
});

test("--refresh looks everything up again but still creates nothing", async () => {
  const geocoder = countingGeocoder();
  const before = await countProperties();
  const result = await importProperties({ landlordEmail, csvText: CSV, geocoder, refresh: true });
  assert.equal(geocoder.calls, 4);
  assert.equal(result.totals.created, 0);
  assert.equal(await countProperties(), before);
});

test("rows are stored with clean types: numbers as numbers, missing values as NULL", async () => {
  const rows = await many(`SELECT label, latitude, geocode_status, geocoded_at FROM properties WHERE address_key LIKE 'carrer c 3%' OR address_key LIKE 'nowhere%' ORDER BY address_key`);
  assert.equal(rows[0].label, null);
  assert.equal(typeof rows[0].latitude, "number");
  assert.ok(rows[0].geocoded_at instanceof Date);
  assert.equal(rows[1].latitude, null);
  assert.equal(rows[1].geocode_status, "no_match");
});

test("the import refuses an unknown or non-landlord account", async () => {
  await assert.rejects(() => importProperties({ landlordEmail: "ghost@x.test", csvText: CSV, geocoder: countingGeocoder() }), /no account/);
  const tenant = await createUser({ email: "t@x.test", name: "T", password: "password123", role: "tenant" });
  await assert.rejects(() => importProperties({ landlordEmail: tenant.email, csvText: CSV, geocoder: countingGeocoder() }), /tenant account/);
});
