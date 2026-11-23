# FixIt

Property maintenance between landlords, tenants and the workers who do the repairs,
without the lost texts and "I told you weeks ago".

A tenant reports what's broken, with how urgent it is and photos. The landlord sees it in
one inbox, urgent and longest-waiting first, and assigns a worker from their team, who
sees just their own jobs. Everyone follows the issue on one timeline that records every
message and status change with who and when. The worker or landlord marks it fixed, and
the tenant confirms it or reopens it with a reason.

```
fixit/
  backend/    Node.js + Express API, OpenStreetMap (Nominatim) client, CSV import,
              PostgreSQL schema + docker-compose.yml
  frontend/   Vite + React web app for landlords, tenants and workers
```

## Project structure

```
FIX-IT/
├── README.md                  this file
├── .gitignore                 keeps .env, node_modules and runtime data out of git
├── docs/
│   ├── ARCHITECTURE.md        diagrams, architecture review, roadmap
│   ├── problems.md            the API's error types (RFC 9457 Problem Details)
│   └── decisions/             decision records (why the API looks the way it does)
│
├── backend/                   Node.js + Express API (port 3000)
│   ├── openapi.yaml           THE API CONTRACT (OpenAPI 3.1), enforced by the server
│   ├── redocly.yaml           lint rules for the contract (npm run lint:api)
│   ├── docker-compose.yml     PostgreSQL in Docker (+ optional API container)
│   ├── Dockerfile             the API as a container image
│   ├── .env.example           settings to copy into .env (never commit .env)
│   ├── samples/               properties.csv for `npm run import`
│   ├── scripts/               seed.js (demo data), import.js (CSV import), db-status.js
│   ├── src/
│   │   ├── server.js          builds the Express app, starts it
│   │   ├── routes/            HTTP endpoints: auth, properties, issues, offers, team, health
│   │   ├── middleware/        auth.js (token -> user, role), idempotency.js (Idempotency-Key)
│   │   ├── models/            the repository layer: the ONLY code that runs SQL
│   │   ├── db/                connection pool, schema.sql, migrations/
│   │   ├── import/            CSV parser + idempotent import
│   │   └── utils/             OpenStreetMap client, photos, tokens, validation, trades
│   └── test/                  node:test, against a throwaway Postgres schema
│
└── frontend/                  Vite + React web app (port 5173)
    ├── index.html
    ├── vite.config.js         dev server; forwards /api to the backend
    └── src/
        ├── main.jsx, App.jsx  start-up and page routes
        ├── api.js             the only code that calls the backend
        ├── auth.jsx           who is signed in (one sign-in per browser tab)
        ├── pages/             one file per screen (landing, dashboard, issues, …)
        ├── components/        reusable pieces (map, timeline, photo picker, …)
        └── test/              Vitest tests + helpers
```

**Diagrams and an architecture review:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

How a request travels: **page** (`frontend/src/pages`) → **`api.js`** → Vite forwards
`/api` → **route** (`backend/src/routes`) checks the sign-in and the input → **model**
(`backend/src/models`) applies the rules and runs SQL → **PostgreSQL** in Docker. The
answer goes back the same way as JSON.

**Week 3: the API contract.** [`backend/openapi.yaml`](backend/openapi.yaml) (OpenAPI 3.1,
linted with Redocly) describes every endpoint; the server enforces it on every request,
and on every response in development and tests. Errors are [Problem Details](docs/problems.md),
lists are cursor-paginated, creating an issue is idempotent, and every design decision is
recorded in [docs/decisions/](docs/decisions/README.md).

**Week 1 hand-in:** the API choice, how to run it, the schema and what was surprising in
the data are all in **[backend/README.md](backend/README.md)**, which starts with a table
mapping each assignment item to its file.

## Quick start

```bash
# terminal 1: database + API
cd backend
cp .env.example .env        # set PGPASSWORD and JWT_SECRET
npm install
docker compose up -d db     # PostgreSQL 16 in Docker
npm run seed                # optional: demo accounts (password: password123)
npm run import              # optional: import samples/properties.csv (needs the demo landlord, or --landlord you@x.com)
npm run dev                 # http://localhost:3000/api

# terminal 2: web app
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173: the landing page explains how FixIt works and lets you join
as a landlord, tenant or worker. To test all three at once, use three browser tabs: each
tab has its own sign-in. (`npm run seed` creates demo accounts instead, all with password
`password123`: `landlord@fixit.test`, `tenant@fixit.test`, `worker@fixit.test`.)

## Checking the API contract

```bash
npx @redocly/cli lint                          # from the repository root
cd backend && npx @redocly/cli lint openapi.yaml   # or from backend/ (same rules)
```

## Tests

```bash
cd backend && npm test     # 66 tests against real PostgreSQL (needs `docker compose up -d db`)
cd frontend && npm test    # 29 tests, offline (jsdom, fake fetch)
```

## What's next: roadmap

FixIt works end to end locally. These are the steps to make it safe for real users,
ready to run in production, and able to pay workers through Stripe. Each phase builds on
the one before it. The reasons, and the design of the bigger items, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap-what-to-fix-and-in-which-order).

### Phase 0: safety net (small, do first)
- [ ] **CI:** a GitHub Actions workflow that starts PostgreSQL and runs both test suites on every push
- [ ] **ESLint + Prettier**, checked in CI
- [ ] **One list of trades and photo limits** shared by frontend and backend (no copies to drift apart)
- [ ] **Protect the timeline in the database:** a trigger that refuses `UPDATE`/`DELETE` on `issue_events`
- [ ] **Guard `npm run seed -- --reset`:** development only, and ask before emptying tables

### Phase 1: protect accounts
- [ ] **Rate limiting** (`express-rate-limit`) on login, sign-up and join codes
- [ ] **Security headers** (`helmet`, Content-Security-Policy)
- [ ] **Sending email:** one mail service (Resend or Postmark in production; Mailpit in Docker for local testing). Verification, password reset and notifications all depend on it
- [ ] **Verify email addresses** before an account can send job offers
- [ ] **Password reset** with a short-lived, single-use emailed link
- [ ] **Safer sessions** (JWT stays, used better):
  - [ ] short-lived access token (15 min), kept in memory, never in browser storage
  - [ ] refresh token in an `httpOnly`, `Secure`, `SameSite` cookie, so JavaScript can't read it
  - [ ] refresh tokens rotated on every use and stored hashed in a `refresh_tokens` table, so "log out" and "log out everywhere" really work
  - [ ] CSRF protection for the cookie (SameSite plus an Origin check)
- [ ] **Optional:** two-factor sign-in (TOTP app) for landlords and workers, who will handle money

### Phase 2: growth and the user experience
- [x] **Pagination** on issue and property lists; the dashboard summary computed by one SQL query (week 3)
- [ ] **Email notifications:** new job offer, offer answered, worker assigned, "please confirm the fix"
- [ ] **Job offers expire** (e.g. after 48 hours), so a forgotten offer doesn't block an issue
- [ ] **Workers choose whether they appear in the directory**, and landlords get a daily offer limit

### Phase 3: ready for production
- [ ] **Background jobs** (`pg-boss`, a queue stored in PostgreSQL) for geocoding and emails, so requests never wait on OpenStreetMap, with one shared 1-request/second limit
- [ ] **Photos in object storage** (S3 or Cloudflare R2; MinIO in Docker locally), served through short-lived links
- [ ] **Structured logs** (`pino`) with a request id per request
- [ ] **Split the biggest files:** `services/` (who may do what) apart from `repositories/` (SQL only); `IssueDetailPage` into one file per panel
- [ ] **Serve the built frontend** from the API (one origin), then **deploy** behind HTTPS
- [ ] **Browser tests** (Playwright) for the main journey: report → offer → accept → fix → confirm

### Phase 4: landlords pay workers (Stripe Connect)
Needs phases 1 and 3 first: verified accounts, HTTPS (Stripe must reach your webhook)
and background jobs.
- [ ] **Workers connect a payout account** with Stripe Connect (Express). Stripe checks their identity and pays them out; FixIt never sees bank details
- [ ] **Price on the job:** the offer (or the worker's quote) carries an amount the landlord agrees to
- [ ] **Pay on approval:** when the landlord approves the work, they pay through Stripe Checkout, and Stripe sends the money to the worker's account (optionally minus a platform fee)
- [ ] **Webhooks decide what's paid:** the payment counts only once Stripe confirms it (`payment_intent.succeeded`, signature verified), never because the browser says so
- [ ] **A `payments` table** and timeline entries ("Maria paid Marc R. 85 EUR"), with refunds and disputes handled
- [ ] **Later:** hold the payment when the offer is accepted and release it when both confirm (escrow-style)
- [ ] **Develop in Stripe test mode**, with `stripe listen` forwarding webhooks to your machine
