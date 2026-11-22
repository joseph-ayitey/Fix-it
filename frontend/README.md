# FixIt Frontend

> This README covers `frontend/` only. See the [root README](../README.md) and
> [backend/README.md](../backend/README.md) for the API.

A Vite + React app for landlords, tenants and workers. Everyone signs in and sees
screens for their role.

**Tenants**
- **Link a home** with the join code their landlord shares.
- **Report an issue** with category, urgency, details and up to 5 photos.
- **Follow it**: a timeline, how long it's been waiting, and which worker is coming
  ("Marc R. · Plumber", no contact details).
- When it's marked fixed: **confirm it works**, or **reopen** it and say what's still wrong.

**Landlords**
- **Dashboard**: urgent issues, issues not yet answered, issues with no worker, and fixed
  issues waiting for *your* approval.
- **Find a worker** on any open issue: the trade is pre-selected from the issue's category
  (plumbing → plumber), workers in the property's city come first, and you send a **job
  offer** with a message. You can see whether it's pending, accepted or declined (with the
  reason), and withdraw it.
- **Approve the work** once it's fixed, or **send it back** to the worker with a reason.
- **Private notes** with the worker (prices, instructions) that the tenant never sees.
- **Properties**: add one at a time (placed on a map), share or rotate join codes, see or
  remove tenants. **Workers**: everyone who has accepted your jobs, plus a directory.

**Workers**
- Sign up with a **trade** and area. Landlords find you by trade.
- **Job offers** on the dashboard: what the job is, the city and the landlord's message.
  **Accept** (then you get the address) or **decline** with a reason.
- **Jobs**: update the status ("Start work", "Mark as fixed"), comment publicly or
  privately with the landlord, and add photos.

**Each browser tab is its own sign-in** (`sessionStorage`), so you can test landlord,
tenant and worker side by side in three tabs. Signing in in one tab never changes who
another tab is.

## How to run

Start the backend first (`cd backend && npm run dev`), then:

```bash
npm install
npm run dev        # http://localhost:5173
```

Vite forwards `/api/*` to `http://localhost:3000`, so the backend needs no CORS setup.
Use `VITE_API_TARGET=http://localhost:4000 npm run dev` for another port.

Sign in with the demo accounts from `npm run seed` in `backend/` (password `password123`):
`landlord@fixit.test`, `tenant@fixit.test`, `worker@fixit.test` (heating engineer), `worker3@fixit.test` (plumber).

## Structure

```
src/api.js                  The only module that calls the backend (token, Problem Details errors, 401 -> sign out, Idempotency-Key)
src/auth.jsx                AuthProvider, useAuth, <RequireAuth role>
src/labels.js               Wording for statuses, categories, urgency; "waiting N days" text
src/useApi.js               useApi (abort, reload(), setData()) and usePagedApi (cursor pagination, "Load more")
src/App.jsx                 Header, health banner, routes
src/pages/LandingPage.jsx   Public front page: how it works, the three roles, "Join as …"
src/pages/AuthPages.jsx     Sign in / sign up (role picker; ?role= pre-selects it)
src/pages/DashboardPage.jsx Role-specific overview: count-up tiles, property map, response times, charts, live activity
src/pages/PropertiesPage.jsx  List + map; AddPropertyPage; JoinPropertyPage
src/pages/PropertyDetailPage.jsx  Map, join code, tenants, issues at the property
src/pages/IssuesPage.jsx    Inbox: status tabs, search, urgency/category/property/worker filters, sort (all in the URL), Load more
src/pages/NewIssuePage.jsx  Report form
src/pages/IssueDetailPage.jsx  Description, worker assignment, status actions, timeline, comments
src/pages/TeamPage.jsx      Landlord: their workers + directory; worker: trade/area profile + landlords
src/components/             PropertyMap (Leaflet), IssueList, Timeline, Badges, Status (skeletons, empty/error states, field errors),
                            Charts (category bars, 12-week trend), ActivityFeed (polling live feed),
                            PhotoPicker (choose + preview), PhotoGallery (protected photos + viewer)
src/test/                   All tests (*.test.jsx), the Vitest setup (stubs the map) and a fake-fetch router
```

The sign-in token is kept in `sessionStorage`, one per tab. If storage is blocked, the app
still works, but you'll be asked to sign in again after a reload.

## Tests

```bash
npm test
```

48 tests in jsdom, with `fetch` faked (in the contract's shapes: `{ items, page }` collections and
Problem Details errors) so no backend is needed. They cover:
- the API client (token header, Problem Details and field errors, sign-out on 401, unreachable server,
  split team endpoints, Idempotency-Key and Idempotent-Replayed)
- "Load more" pagination (inbox and properties) and inbox filters kept in the URL
- the report form showing the API's field errors (and focusing the first one), the Idempotency-Key
  being reused after a 503 or network failure and renewed after a fixed 400, and the "already received" notice
- empty states, error states with a working "Try again", and the dashboard (stats with `null` medians,
  categories, trend, activity feed polling and pausing)
- signing in and being redirected
- a tenant joining with a code and reporting an issue
- a tenant having to give a reason to reopen
- a landlord's join code and tenant list
- landlords seeing only the status buttons the server allows
- role-protected routes, and returning to the page you were on after signing in
- the landing page: the flow, the three roles, and "Join as …" pre-selecting the role
- photo uploads: multipart request body, rejecting non-images and files over 8 MB before
  upload, photos loaded with the sign-in token, photo-only comments
- workers: signing up with a trade; a landlord finding a worker by the suggested trade
  and sending an offer; a worker accepting from the dashboard; the two-sided confirmation
  panel; private notes; each tab keeping its own sign-in
