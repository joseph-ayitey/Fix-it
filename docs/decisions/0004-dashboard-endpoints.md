# 0004: Dashboard statistics and activity feed endpoints

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
The new dashboard design (week 3) shows, for whoever is signed in:
1. a map of properties with pins coloured by urgency: **available** (`GET /properties`
   has coordinates and open/urgent counts);
2. headline tiles: **available** (`GET /issues/summary`);
3. **response times**: the median time to a first response and to closing an issue;
4. **issues by category** and a **12-week trend** of issues reported vs closed;
5. a **live activity feed**: the latest events across all your issues, refreshed while
   the page is open.

3–5 aren't in the contract. Computing them in the browser would mean downloading every
issue and every timeline, page by page, which pagination (0002) exists to avoid.

## Decision
Add two read-only endpoints to the contract (tag `Dashboard`), scoped by the same
visibility rules as everything else:
- `GET /dashboard/stats`: issue counts by status, category and urgency; median hours to
  first response and to close over the last 90 days (with the sample size, and `null`
  when there's no data); and per-week reported/closed counts for the last 12 weeks.
- `GET /dashboard/activity`: the most recent timeline events visible to you, newest first,
  cursor-paginated like every collection. Tenants never see private (`internal`) events,
  and names follow the usual privacy rules. Each event carries a short `excerpt` of its
  text, not the full body.

The web app refreshes the feed by polling `GET /dashboard/activity?limit=…` every few seconds.

## Alternatives considered
- **Compute in the browser** from `/issues`: needs every page of every list, so it's slow, and
  wrong as soon as there are more issues than one page.
- **Server-Sent Events / WebSockets** for the live feed: truly push-based, but it's another
  protocol to describe and secure. Polling a normal, cacheable GET fits the contract and
  is enough at this scale; push can replace it later without changing the data shape.
- **Fold the statistics into `/issues/summary`**: that would make the cheap summary used
  by every page heavier; the dashboard-only numbers get their own endpoint.

## Consequences
- Two more operations (33), validated and tested like the rest.
- **Known limitation, found while building the UI from the contract:** a poll can't ask
  for "only what's new" (no `since` parameter, no `ETag`), so each poll downloads the
  first page again, and if more than `limit` events happen between two polls the client
  can't know what it missed (the web app then restarts the feed from the newest page).
  Fine at FixIt's scale; if it isn't, add a `since=<event id>` parameter (a contract
  change and a new decision record) or move to Server-Sent Events.
- Lists that need "everything" (the dashboard map) get at most one page of 100 properties;
  the web app says when there are more. A lightweight map-summary endpoint would lift that.
- The statistics are computed with SQL aggregates (`count … FILTER`, `percentile_cont`,
  `generate_series`), so the response stays small however many issues exist.
