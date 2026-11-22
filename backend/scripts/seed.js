#!/usr/bin/env node
// Demo data so the UI has something real to show: one landlord, two tenants, three
// workers with different trades, three properties, and issues in every stage of the
// lifecycle (offered, accepted, worked on, confirmed) with back-dated timelines.
//
//   npm run seed            add the demo data (skipped if the demo landlord exists)
//   npm run seed -- --reset EMPTY EVERY TABLE first (all users, properties, issues), then seed
//
// All demo accounts use the password "password123". Properties are geocoded live
// (1 request/second) if NOMINATIM_USER_AGENT is set; otherwise they get no map pin.

import "dotenv/config";
import { initDb, closeDb, one, many, query } from "../src/db/index.js";
import { createUser } from "../src/models/users.js";
import { createProperty, joinProperty } from "../src/models/properties.js";
import { addComment, changeStatus, confirmFix, createIssue } from "../src/models/issues.js";
import { createOffer, respondToOffer } from "../src/models/offers.js";
import { NominatimClient, noGeocoder } from "../src/utils/geocode.js";

const PASSWORD = "password123";
const DAY = 24 * 60 * 60 * 1000;

await initDb();

if (process.argv.includes("--reset")) {
  // RESTART IDENTITY: ids start from 1 again. CASCADE: dependent rows go too.
  await query(`TRUNCATE issue_photos, issue_events, issues, tenancies, landlord_workers, properties, users RESTART IDENTITY CASCADE`);
  console.log("Emptied every table.");
}

if (await one(`SELECT 1 FROM users WHERE lower(email) = 'landlord@fixit.test'`)) {
  console.log("Demo data already present. Use `npm run seed -- --reset` to start over.");
  await closeDb();
  process.exit(0);
}

const geocoder = process.env.NOMINATIM_USER_AGENT
  ? new NominatimClient({ userAgent: process.env.NOMINATIM_USER_AGENT, language: process.env.GEOCODE_LANGUAGE || "en" })
  : noGeocoder;

/** Rewrite an issue's and its events' timestamps as if it happened `daysAgo` days ago. */
async function backdate(issueId, daysAgo) {
  const events = await many(`SELECT id FROM issue_events WHERE issue_id = $1 ORDER BY id`, [issueId]);
  const start = Date.now() - daysAgo * DAY;
  const step = (daysAgo * DAY * 0.9) / Math.max(events.length, 1);
  const at = (i) => new Date(start + i * step).toISOString();
  for (const [i, e] of events.entries()) await query(`UPDATE issue_events SET created_at = $1 WHERE id = $2`, [at(i), e.id]);
  const last = at(events.length - 1);
  await query(
    `UPDATE issues SET created_at = $2, updated_at = $3,
       acknowledged_at = CASE WHEN acknowledged_at IS NULL THEN NULL ELSE
         (SELECT min(e.created_at) FROM issue_events e JOIN users u ON u.id = e.actor_id
          WHERE e.issue_id = $1 AND u.role IN ('landlord', 'worker')) END,
       assigned_at = CASE WHEN assigned_at IS NULL THEN NULL ELSE
         (SELECT max(created_at) FROM issue_events WHERE issue_id = $1 AND type = 'assigned') END,
       resolved_at = CASE WHEN resolved_at IS NULL THEN NULL ELSE
         (SELECT max(created_at) FROM issue_events WHERE issue_id = $1 AND to_status = 'resolved') END,
       closed_at = CASE WHEN closed_at IS NULL THEN NULL ELSE $3::timestamptz END
     WHERE id = $1`,
    [issueId, at(0), last],
  );
}

const landlord = await createUser({ email: "landlord@fixit.test", name: "Maria Garcia", password: PASSWORD, role: "landlord" });
const anna = await createUser({ email: "tenant@fixit.test", name: "Anna Soler", password: PASSWORD, role: "tenant" });
const jordi = await createUser({ email: "tenant2@fixit.test", name: "Jordi Puig", password: PASSWORD, role: "tenant" });
const pau = await createUser({ email: "worker@fixit.test", name: "Pau Vidal", password: PASSWORD, role: "worker", trade: "heating_engineer", area: "Barcelona" });
const nuria = await createUser({ email: "worker2@fixit.test", name: "Núria Font", password: PASSWORD, role: "worker", trade: "locksmith", area: "Barcelona" });
await createUser({ email: "worker3@fixit.test", name: "Marc Ribas", password: PASSWORD, role: "worker", trade: "plumber", area: "Barcelona, L'Hospitalet" });

/** Landlord offers the job, worker accepts: the only way a worker gets assigned. */
async function hire(issueId, worker, message) {
  await createOffer(landlord, { issueId, workerId: worker.id, message });
  const [offer] = await many(`SELECT id FROM job_offers WHERE issue_id = $1 AND status = 'pending'`, [issueId]);
  await respondToOffer(worker, offer.id, { accept: true, response: "On it." });
}

console.log(geocoder.disabled ? "Adding properties (geocoding disabled)..." : "Adding and geocoding properties (1/second)...");
const mallorca = await createProperty(landlord, { label: "Eixample flat", address: "Carrer de Mallorca 401, Barcelona, Spain" }, geocoder);
const balmes = await createProperty(landlord, { label: "Balmes studio", address: "Carrer de Balmes 150, Barcelona, Spain" }, geocoder);
const raval = await createProperty(landlord, { label: "Raval loft", address: "Rambla del Raval 29, Barcelona, Spain" }, geocoder);
for (const p of [mallorca, balmes, raval]) console.log(`  ${p.geocodeStatus.padEnd(8)} ${p.label}`);

await joinProperty(anna, mallorca.joinCode);
await joinProperty(jordi, balmes.joinCode);

// Anna: an urgent leak nobody has responded to yet (the problem FixIt exists to surface).
const leak = await createIssue(anna, {
  propertyId: mallorca.id,
  title: "Water leaking under the kitchen sink",
  description: "There's a steady drip from the pipe under the sink and the cabinet floor is soaked. I've put a bowl under it.",
  category: "plumbing",
  urgency: "urgent",
});
await backdate(leak.id, 2);

// Anna: in progress, with a back-and-forth.
const heating = await createIssue(anna, {
  propertyId: mallorca.id,
  title: "Bedroom radiator stays cold",
  description: "The radiator in the main bedroom doesn't heat up at all, even with the boiler on. The others work.",
  category: "heating",
  urgency: "normal",
});
await addComment(landlord, heating.id, { body: "Thanks Anna. Could you try bleeding it with the key in the kitchen drawer?" });
await addComment(anna, heating.id, { body: "Tried it. Some air came out but it's still cold." });
await hire(heating.id, pau, "Pau, can you take a look? Anna is home in the mornings.");
await addComment(landlord, heating.id, { body: "Budget up to 150 EUR for the valve; ask me before going over.", visibility: "internal" });
await changeStatus(pau, heating.id, { status: "in_progress", note: "Coming Thursday 9am to check the valve." });
await backdate(heating.id, 6);

// Anna: fixed by the landlord personally (so already approved), waiting for Anna to confirm.
const oven = await createIssue(anna, {
  propertyId: mallorca.id,
  title: "Oven door hinge broken",
  description: "The oven door drops open and won't stay closed.",
  category: "appliance",
  urgency: "low",
});
await changeStatus(landlord, oven.id, { status: "resolved", note: "Replacement hinge fitted on Monday." });
await backdate(oven.id, 10);

// Jordi: full lifecycle. Worker fixes it, tenant confirms, landlord approves -> closed.
const lock = await createIssue(jordi, {
  propertyId: balmes.id,
  title: "Front door lock sticks",
  description: "The key only turns after several tries. Worried I'll get locked out.",
  category: "security",
  urgency: "normal",
});
await hire(lock.id, nuria, "Núria, a lock job for you.");
await changeStatus(nuria, lock.id, { status: "in_progress", note: "Coming tomorrow morning." });
await changeStatus(nuria, lock.id, { status: "resolved", note: "Cylinder replaced, new keys left with the porter." });
await addComment(nuria, lock.id, { body: "Invoice: 85 EUR, cylinder + labour.", visibility: "internal" });
await confirmFix(jordi, lock.id, { note: "Works perfectly now, thanks!" });
await confirmFix(landlord, lock.id, { note: "Approved, invoice paid." });
await backdate(lock.id, 20);

await closeDb();
console.log(`
Done. Sign in at http://localhost:5173 with password "${PASSWORD}":
  landlord@fixit.test   Maria Garcia (landlord, 3 properties)
  tenant@fixit.test     Anna Soler   (tenant of "Eixample flat")
  tenant2@fixit.test    Jordi Puig   (tenant of "Balmes studio")
  worker@fixit.test     Pau Vidal    (heating engineer, working on the radiator)
  worker2@fixit.test    Núria Font   (locksmith, fixed the lock)
  worker3@fixit.test    Marc Ribas   (plumber, not hired yet: offer him the leak!)
Join code for "Raval loft" (no tenant yet): ${raval.joinCode}`);
