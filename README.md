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
│
├── backend/                   Node.js + Express API (port 3000)
│   ├── docker-compose.yml     PostgreSQL in Docker (+ optional API container)
│   ├── Dockerfile             the API as a container image
│   ├── .env.example           settings to copy into .env (never commit .env)
│   ├── samples/               properties.csv for `npm run import`
│   ├── scripts/               seed.js (demo data), import.js (CSV import), db-status.js
│   ├── src/
│   │   ├── server.js          builds the Express app, starts it
│   │   ├── routes/            HTTP endpoints: auth, properties, issues, offers, team, health
│   │   ├── middleware/        auth.js: who is calling (token -> user), which role
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

How a request travels: **page** (`frontend/src/pages`) → **`api.js`** → Vite forwards
`/api` → **route** (`backend/src/routes`) checks the sign-in and the input → **model**
(`backend/src/models`) applies the rules and runs SQL → **PostgreSQL** in Docker. The
answer goes back the same way as JSON.

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

## Tests

```bash
cd backend && npm test     # 66 tests against real PostgreSQL (needs `docker compose up -d db`)
cd frontend && npm test    # 29 tests, offline (jsdom, fake fetch)
```
