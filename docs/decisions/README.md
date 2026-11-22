# Decision records

Short records of API and architecture decisions: what was decided, why, and what else
was considered, so that later readers know *why* things are the way they are.

The rule for the API: **the contract (`backend/openapi.yaml`) changes first.** If the web
app (or any other consumer) needs something the contract doesn't offer, add it to the
contract, write a record here, and only then change the code.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-problem-details-errors.md) | Errors are RFC 9457 Problem Details | Accepted |
| [0002](0002-cursor-pagination.md) | Collections use cursor pagination | Accepted |
| [0003](0003-idempotency-keys.md) | `POST /issues` is idempotent with an `Idempotency-Key` | Accepted |
| [0004](0004-dashboard-endpoints.md) | Dashboard statistics and activity feed endpoints | Accepted |

Template: **Status · Date · Context · Decision · Alternatives considered · Consequences.**
