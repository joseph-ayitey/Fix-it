# FixIt Backend

> This README covers `backend/`. See the [root README](../README.md) for the whole project
> and [frontend/README.md](../frontend/README.md) for the web UI.

FixIt is property maintenance between **landlords, tenants and workers**. A tenant reports
what's broken (with photos and urgency). The landlord finds a worker by trade and sends a
job offer, which the worker accepts or declines. Once the worker marks it fixed, the issue
closes when **both** the tenant (it works) and the landlord (work approved) confirm. All
three follow it on one timeline, with a private landlord-worker thread for prices and
instructions.

This folder is the Node.js + Express API, the OpenStreetMap API client, the CSV import,
and the PostgreSQL schema.

| Role | Joins by | Can |
| --- | --- | --- |
| **Landlord** | signing up | add properties (one by one, or a CSV with `npm run import`), share join codes, find workers by trade and send job offers, approve finished work or send it back |
| **Tenant** | signing up + a property's join code | report issues with photos, comment, confirm a fix or reopen it with a reason |
| **Worker** | signing up with a **trade** (plumber, electrician…) and area | accept or decline job offers, then see the job's address, comment (shared or private), add photos, mark work started or fixed |

**Who sees whom.** The landlord sees everyone's full name. Tenants and workers see each
other only as "Marc R." with no contact details, and see the worker's trade. Before
accepting an offer, a worker sees the job (category, urgency, description, city) but not
the address or the tenant. Private landlord-worker notes and job offers never reach the
tenant, not even their photos.

## Week 1 hand-in: where everything is

| Assignment item | Where |
| --- | --- |
| 1. Data source | OpenStreetMap **Nominatim** geocoding API ([why](#which-api-and-why)) |
| 2. API client: timeouts, retries, rate limit | [`src/utils/geocode.js`](src/utils/geocode.js) (`NominatimClient`, `RateLimiter`), tested in `test/geocode.test.js` |
| 3. Parser: own data model, missing fields, odd formats, one bad record doesn't crash the run | API response: `parseNominatimResult` in [`src/utils/geocode.js`](src/utils/geocode.js). Import file: [`src/import/csvParser.js`](src/import/csvParser.js). Decisions: [below](#parser-decisions) |
| 4. PostgreSQL in Docker | [`docker-compose.yml`](docker-compose.yml) (service `db`) |
| Schema: tables, types, keys | [`src/db/schema.sql`](src/db/schema.sql), applied automatically ([migrations](#schema-and-migrations)) |
| Repository layer (one place that reads/writes the DB) | [`src/models/`](src/models) on top of [`src/db/index.js`](src/db/index.js). Routes, the importer and the scripts never write SQL themselves |
| The import | `npm run import`: [`scripts/import.js`](scripts/import.js) → [`src/import/importProperties.js`](src/import/importProperties.js) |
| Running the import twice creates no duplicates | upsert on `UNIQUE (landlord_id, address_key)` ([below](#idempotency-running-the-import-twice)), tested in `test/import.test.js` |
| Secrets out of git | `.env` (gitignored); `.env.example` shows what to set |

## Which API, and why

**OpenStreetMap's Nominatim** (https://nominatim.org) turns a typed address into
coordinates and a normalized address. FixIt uses it so every property sits on a map and
workers can find the job.

- **Free**, with no signup and no API key.
- **Its data may be used** under the ODbL licence, with attribution (shown on the map).
- **It has real rules**, from its usage policy
  (https://operations.osmfoundation.org/policies/nominatim/):
  - at most **1 request per second**: `RateLimiter`, with one shared client per process;
  - a **descriptive User-Agent**: default ones are blocked;
  - **no repeated or bulk lookups**: the import never asks twice for an address it
    already found.
- **The responses are realistically messy** (see [what was surprising](#what-was-surprising-about-the-data)).
- **Enough records to browse:** each address is one lookup, so the list comes from the
  import file. `samples/properties.csv` has 20 real Barcelona addresses plus deliberately
  broken rows.

Explore it by hand first, as the assignment suggests:

```bash
curl -s -G "https://nominatim.openstreetmap.org/search" \
  --data-urlencode "q=Carrer de Mallorca 401, Barcelona, Spain" \
  --data-urlencode "format=jsonv2" --data-urlencode "addressdetails=1" \
  --data-urlencode "limit=1" --data-urlencode "accept-language=en" \
  -H "User-Agent: fixit-course-project/1.0" | python3 -m json.tool
```

How the client deals with the real world (`src/utils/geocode.js`):
- **Timeouts:** every request is aborted after 10 s.
- **Retries:** network errors, timeouts, `5xx` and `429` are retried with exponential
  backoff and jitter, up to 3 times. A `429`'s `Retry-After` header is honored.
- **No retry on other `4xx`:** a `403` is Nominatim saying "policy violation", and
  retrying would make it worse.
- **Rate limit:** 1 request per second, process-wide.
- **No match is not an error:** an empty result is `null`, and the property is saved with
  `geocode_status = 'no_match'`. If the service is down, it's saved as `'failed'` and
  retried on the next import. Adding a property never fails because the map lookup did.

## How to run

You need Docker and Node.js 20+.

```bash
cd backend
cp .env.example .env        # set PGPASSWORD and JWT_SECRET (see comments in the file)
npm install

docker compose up -d db     # 1. start PostgreSQL 16 in Docker (host port 5433)
npm run seed                # 2. demo accounts: landlord, tenants, workers (password: password123)
npm run import              # 3. import samples/properties.csv for landlord@fixit.test
npm run import              #    ...and again: 0 created, nothing duplicated
npm run dev                 # 4. the API on http://localhost:3000/api (for the web UI)
```

There's no separate "create the schema" step. The schema and any newer migrations are
applied automatically the first time anything connects (the API, `seed`, `import` or
`db:status`).

Import options:
```bash
npm run import -- --file path/to/your.csv --landlord you@example.com
npm run import -- --refresh       # look every address up again (still no duplicates)
```

The CSV needs an `address` column, and can have a `label` (or `nickname`) column. Other
columns are ignored. Example:
```csv
label,address
Eixample flat,"Carrer de Mallorca 401, Barcelona, Spain"
```

What a run prints (second run of the sample file):
```
  line   2  = unchanged  Casa Batlló flat
  ...
  line  26  = unchanged  Nowhere  [map: no_match]

Skipped rows (not imported):
  line  22  same address as line 2
  line  23  address is empty
  line  24  "12345" doesn't look like an address
  line  25  has 4 fields but the header has 3 (a comma inside an address needs "quotes")

Created: 0   Updated: 0   Unchanged: 21   Skipped: 4   Geocoding calls: 0
Properties for landlord@fixit.test: 23 before, 23 after
```

### Showing what's in the database

```bash
npm run db:status                                   # migrations + row count per table
docker compose exec db psql -U fixit fixit          # a SQL prompt
```

Some queries worth showing:
```sql
-- The imported properties, with what OpenStreetMap made of them
SELECT label, city, postcode, round(latitude::numeric, 5) AS lat, round(longitude::numeric, 5) AS lon, geocode_status
FROM properties ORDER BY created_at;

-- Proof of idempotency: no address appears twice for the same landlord
SELECT landlord_id, address_key, count(*) FROM properties GROUP BY 1, 2 HAVING count(*) > 1;  -- 0 rows

-- Issues with who reported them and who's fixing them
SELECT i.title, i.status, i.urgency, r.name AS reported_by, w.name AS worker
FROM issues i JOIN users r ON r.id = i.reported_by LEFT JOIN users w ON w.id = i.assigned_worker_id;

-- One issue's timeline
SELECT e.created_at, u.name, e.type, e.from_status, e.to_status, e.body
FROM issue_events e JOIN users u ON u.id = e.actor_id WHERE e.issue_id = 2 ORDER BY e.id;
```

## Schema and migrations

[`src/db/schema.sql`](src/db/schema.sql) is the full schema, with a comment on every
decision:

| Table | Holds | Keys |
| --- | --- | --- |
| `users` | landlords, tenants, workers (+ trade, area) | `id`; unique `lower(email)`; `role` and `trade` CHECKs; only workers have a trade |
| `properties` | a landlord's properties + geocoded location | `id`; FK `landlord_id`; **unique `(landlord_id, address_key)`**; unique `join_code` |
| `tenancies` | which tenant lives where | PK `(property_id, tenant_id)` |
| `landlord_workers` | workers who accepted a landlord's job (filled automatically) | PK `(landlord_id, worker_id)` |
| `issues` | reported problems + who confirmed the fix | `id`; FKs to property, reporter, assigned worker; CHECKs on category/urgency/status |
| `job_offers` | landlord → worker offers and answers | `id`; FKs; **at most one `pending` offer per issue** (unique partial index) |
| `issue_events` | the append-only timeline; `visibility` = `shared` or `internal` (landlord + worker only) | `id`; FK `issue_id` |
| `issue_photos` | photo metadata (files on disk) | `id`; FKs to issue and event |

Type choices:
- **`timestamptz`** for every time, so instants compare correctly in any time zone.
- **`double precision`** for coordinates, with range CHECKs.
- **`text` + CHECK** for fixed value sets, so they're readable in psql and enforced by the
  database itself.
- **`integer` identity** ids.

**Migrations** ([`src/db/migrate.js`](src/db/migrate.js)):
- The `schema_migrations` table records which versions a database has.
- Version 1 is `schema.sql`. Later changes are numbered files in
  [`src/db/migrations/`](src/db/migrations/README.md).
- Each version runs in one transaction, so a failure leaves the database untouched and
  stops startup.
- An advisory lock stops two processes (say the API and the import) from migrating at the
  same time.

## Parser decisions

**From Nominatim's response** (`parseNominatimResult`):
- **Coordinates:** `lat`/`lon` arrive as strings and are converted to numbers. A result
  without usable coordinates counts as no match.
- **Missing address parts** (no postcode, no city) become `NULL`, never `""` or a guess.
- **City fallback:** `city` falls back to `town`, then `village`, because small places
  don't have a `city`.
- **Street:** `house_number` + `road` are joined into `street_address`.

**From the import CSV** (`src/import/csvParser.js`):
- **Format quirks:** byte-order marks, Windows line endings, blank lines and quoted fields
  containing commas are all handled.
- **Spacing:** extra spaces are tidied. `"  Carrer   de Pau Claris 100 ,Barcelona"`
  becomes `"Carrer de Pau Claris 100, Barcelona"`.
- **Empty label:** stored as `NULL`.
- **Rows that are skipped, with their line number and reason:** empty or implausible
  addresses (`12345`), rows with the wrong number of fields, and a repeat of an address
  already in the file (ignoring case and spacing).
- **Unknown columns** are ignored, so a spreadsheet export with extra columns still works.
- **A bad row never stops the import.** Even an unexpected database error on one row is
  reported, and the run continues.

**Dates and time zones:** neither Nominatim nor the CSV has dates, so all times are ours.
They're stored as `timestamptz` (absolute UTC instants), returned by the API as ISO-8601
UTC (`2026-11-22T09:30:00.000Z`), and shown by the browser in the viewer's local time.
Nothing ever stores local time without a zone.

## Idempotency: running the import twice

- **The key:** each property is identified by `(landlord_id, address_key)`, where
  `address_key` is the address lowercased with spacing tidied. That pair has a `UNIQUE`
  constraint, so even a bug can't store a duplicate.
- **The write:** the import upserts. An unknown address is inserted
  (`ON CONFLICT ... DO NOTHING` protects against two imports running at once). A known
  address is updated only if something actually changed, so a second run reports
  `unchanged`.
- **No repeat lookups:** addresses already geocoded are not sent to Nominatim again.
  Lookups that *failed* (the service was down) are retried; a definite "no match" is
  retried only with `--refresh`.
- **Tested:** `test/import.test.js` runs the import twice against Postgres. It checks the
  row count is unchanged and that no new API calls were made.

The API's own "Add property" form uses the same unique key, but answers `409` for an
address you already have, because in a form saying so beats silently doing nothing.

## What was surprising about the data

All of these came from real calls during development:

- **A confident answer can be the wrong town.** "Carrer de Balmes 150, Barcelona" came back
  as a Carrer de Balmes in **Sant Adrià de Besòs**, about 6 km away. Its `display_name`
  still contains "Barcelona" (the province), so only the `city` field gives it away.
- **An address without a city can land anywhere.** A property typed as
  "Bou de sant pere" was placed in **Palma de Mallorca, 206 km away**. Nominatim picks the
  best match in the whole world. Always include the city and country.
- **Coordinates are strings** (`"lat": "41.4031876"`). Left unparsed, they'd silently break
  any numeric comparison.
- **Names come back in the local language by default.** Barcelona results said "España"
  and "Catalunya" until the client started sending `accept-language`.
- **"No match" is a successful response with an empty list**, not a 404.
- **Address completeness depends on how well-mapped an area is:** `postcode` or `city`
  can be missing, and small places have `town` or `village` instead of `city`. In
  central Barcelona all 23 found addresses had street, city and postcode.
- **Hand-made test data drifts from reality.** An early fixture's coordinates for Carrer
  de Mallorca 401 were about 1.4 km from what the real API returned.

## API

All endpoints except `/health`, `/auth/register` and `/auth/login` need
`Authorization: Bearer <token>`. Errors are always `{ "error": { "message", "details?" } }`,
and `details` lists one entry per invalid field. Other people's properties and issues
return **404, not 403**, so their ids can't be probed.

| Method & path | Who | What it does |
| --- | --- | --- |
| `GET /api/health` | anyone | `{status, database, geocoding}` (503 if Postgres is unreachable) |
| `POST /api/auth/register` | anyone | `{email, name, password (≥8), role: landlord\|tenant\|worker, trade (workers), area?}` → `201 {token, user}` |
| `POST /api/auth/login` | anyone | `{email, password}` → `{token, user}` |
| `GET /api/auth/me` | signed in | the current user |
| `PATCH /api/auth/me` | signed in | `{name?, trade?, area?}` (trade and area: workers only) |
| `GET /api/properties` | all | landlord: owned; tenant: joined; worker: where they have an active job |
| `POST /api/properties` | landlord | `{address, label?}` → geocoded, gets a join code (409 if you already have that address) |
| `POST /api/properties/join` | tenant | `{code}` → 201 joined / 200 already joined / 404 bad code |
| `GET /api/properties/:id` | all | landlord also gets `joinCode` and `tenants` |
| `PATCH /api/properties/:id` | landlord | `{label}` |
| `POST /api/properties/:id/join-code` | landlord | new code; the old one stops working |
| `POST /api/properties/:id/geocode` | landlord | retry a failed or no-match map lookup |
| `DELETE /api/properties/:id/tenants/:tenantId` | landlord | end a tenancy |
| `GET /api/issues?status=&propertyId=&assignment=` | all | landlord: all on their properties; tenant: own reports; worker: assigned to them |
| `GET /api/issues/summary` | all | `{active, urgent, unacknowledged, unassigned, awaitingConfirmation, needsYourConfirmation, pendingOffers (workers)}` |
| `POST /api/issues` | tenant | `{propertyId, title, description, category, urgency?}`, as JSON or multipart with up to 5 `photos` |
| `GET /api/issues/:id` | all | issue + timeline + `allowedTransitions`, `canConfirm`, `confirmations` (+ `offers` for the landlord) |
| `POST /api/issues/:id/comments` | all | `{body, visibility?}` and/or `photos`; `visibility: "internal"` = private landlord-worker note |
| `POST /api/issues/:id/confirm` | tenant, landlord | `{note?}`: tenant "it works" / landlord "work approved". Closes once both have confirmed |
| `GET /api/issues/:id/photos/:photoId` | all | the image, only for people who can see the issue |
| `PATCH /api/issues/:id/status` | all | `{status, note?}`, only transitions in `allowedTransitions` |
| `DELETE /api/issues/:id/assignment` | landlord | take the worker off the issue |
| `GET /api/team/directory?trade=&city=` | landlord | find workers by trade: short name, trade, area, track record, no contact details |
| `GET /api/team` | landlord, worker | landlord: workers who accepted their jobs; worker: their landlords |
| `DELETE /api/team/:workerId` | landlord | stop working with them; their active jobs become unassigned |
| `POST /api/offers` | landlord | `{issueId, workerId, message?}`: offer an open, unassigned issue to a worker |
| `GET /api/offers` | worker | your offers: pending first, with a preview of each job |
| `POST /api/offers/:id/accept` | worker | `{response?}` → you're assigned; returns the full issue |
| `POST /api/offers/:id/decline` | worker | `{response?}` (a reason helps the landlord) |
| `POST /api/offers/:id/withdraw` | landlord | take back an unanswered offer |

**Issue lifecycle.** Only the transitions in `allowedTransitions` are accepted:

```
                  landlord offers job ──▶ worker accepts ──▶ assigned
open ──worker/landlord──▶ in_progress ──worker/landlord──▶ resolved ──▶ closed when BOTH:
                               ▲                              │          ✓ tenant: "it works"
                               └─landlord sends back (reason)─┤          ✓ landlord: "work approved"
open ◀──────────────────────────tenant reopens (reason)───────┘
```
- A landlord who marks it resolved themselves has approved it by doing so.
- Sending back or reopening clears both confirmations.
- The tenant can withdraw an open issue.
- If the tenant hasn't replied 7 days after it's resolved, the landlord may close it alone.

## Tests

```bash
docker compose up -d db   # tests use the real PostgreSQL
npm test
```

66 tests. Each test file gets its own temporary Postgres schema, migrated from scratch and
dropped afterwards, so tests use the real SQL, never touch your data, and run in parallel.
OpenStreetMap is replaced by a fake, so tests make no network calls. They cover:
- the API client (retries, timeouts, rate limit, parsing);
- the CSV parser and import idempotency;
- migrations and the schema's own constraints;
- authentication, properties and join codes;
- the full issue lifecycle and who may do what;
- trades, the worker directory, job offers, private notes, name privacy, and the two-sided confirmation;
- photo uploads.

## Run the API in Docker too (optional)

```bash
docker compose --profile app up -d --build   # API on :3000 (stop `npm run dev` first)
docker compose exec api node scripts/import.js
```

The API applies migrations itself on startup. Photos go in the `fixit_uploads` volume, and
the database in `fixit_postgres`. `docker compose down` keeps both, and
`docker compose down -v` deletes them.

## Troubleshooting

- **`Can't reach PostgreSQL at localhost:5433`:** run `docker compose up -d db`, then
  `docker compose ps` should say `healthy`.
- **`password authentication failed`:** the database was first created with a different
  `PGPASSWORD`. The Postgres image only reads the password when its volume is new. Put the
  old password back in `.env`, or wipe and recreate with `docker compose down -v` (this
  deletes the data).
- **Port 5433 or 3000 already in use:** change `PGPORT` or `PORT` in `.env`.
- **`npm run dev` says "Waiting for file changes before restarting":** the server exited
  on startup, and the line above that message says why. It restarts by itself when you
  fix `.env`.
