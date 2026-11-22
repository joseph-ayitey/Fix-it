# 0003: `POST /issues` is idempotent with an `Idempotency-Key`

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
`POST` isn't idempotent: if the response to "report an issue" is lost (slow mobile
network, server restart) and the tenant presses Send again, a second issue is created,
with duplicate photos, and the landlord sees the same leak twice. The same problem will
matter much more for payments (roadmap phase 4).

## Decision
Follow the IETF *Idempotency-Key HTTP Header Field* draft, as Stripe does:
- The client sends `Idempotency-Key: <unique value>`, made once per intended action (the
  web app makes a UUID when the form is opened) and reused on retries. It's optional.
- The server stores key + user + operation + a SHA-256 of the request (body fields and
  each photo's bytes) + the response, in `idempotency_keys` (migration 003).
- Same key + same request: the stored response is replayed, with `Idempotent-Replayed: true`.
- Same key + different request: `422 idempotency-key-reused`.
- Same key while the first is still running: `409 idempotency-request-in-progress`.
- A failed attempt releases its key. Keys are per user and forgotten after 24 hours.
- The check runs **after** the contract validator, so invalid requests never store a key.

## Alternatives considered
- **Disable the button while sending**: done too, but it doesn't help when the *response*
  is lost: the issue was created, and the user retries from a fresh page.
- **Deduplicate by content** (same title within N minutes): guesses, and would block two
  genuinely separate reports with the same title.
- **Make the client choose the id (`PUT /issues/{uuid}`)**: idempotent by design, but it
  changes ids from integers to UUIDs everywhere.

## Consequences
- Retrying a report is always safe, and the same middleware can protect future create
  endpoints (offers, payments).
- One extra table, and two extra queries per keyed request.
