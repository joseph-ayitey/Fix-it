# 0002: Collections use cursor pagination

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
`GET /issues` and `GET /properties` returned every row. That's fine for a demo, slow and
heavy for a landlord with thousands of issues, and the dashboard summary even loaded every
issue just to count them.

## Decision
Collections return `{ items, page: { limit, nextCursor, hasMore } }`. Clients pass
`page.nextCursor` back as `cursor` until it is `null`.
- `limit` is 1–100, default 20.
- The cursor is opaque (base64url of the last item's id and the sort). The server finds
  "rows that sort after that row" by comparing the whole sort key as a tuple, with the id
  last so the order has no ties.
- Issues can sort by `priority` (default), `newest` or `updated`. A cursor is only valid
  with the sort it came from (otherwise 400).
- Small, bounded lists (team, directory, offers) use the same envelope, with
  `nextCursor` always `null`, so every collection looks alike.

## Alternatives considered
- **Offset/page numbers** (`?page=3`): simple, but rows shift when issues are added
  during browsing (duplicates or gaps), and large offsets get slow.
- **Link headers** (GitHub style): standard, but less convenient for a browser app than
  a field in the body.
- **Returning a total count**: useful, but it costs a second query on every page. The
  dashboard gets counts from `/issues/summary` and `/dashboard/stats` instead.

## Consequences
- Pages stay correct while data changes, and every page is one indexed query.
- No "jump to page 7": the UI offers "Load more" instead.
- Breaking change from plain arrays; the web app moved to `items` with it.
