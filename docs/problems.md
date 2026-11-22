# FixIt API problem types

Every FixIt API error is an [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)
object, sent as `application/problem+json`:

```json
{
  "type": "https://github.com/joseph-ayitey/fixit/blob/main/docs/problems.md#validation-error",
  "title": "Your request has invalid fields",
  "status": 400,
  "detail": "title: must NOT have fewer than 3 characters",
  "instance": "/api/issues",
  "errors": [{ "field": "title", "message": "must NOT have fewer than 3 characters" }]
}
```

- `type` links to the matching section below. Programs should branch on `type`, or on
  `status`, never on the wording of `detail`.
- `title` is the same for every problem of that type; `detail` explains this occurrence.
- `errors` appears only on validation errors: one entry per invalid field. `field` is the
  field name (`title`), or `query.limit` / `path.issueId` / `header.idempotency-key` for
  other parts of the request.

## validation-error
**400.** The request doesn't match the contract (`openapi.yaml`): a missing or invalid
field, an unknown field, a value outside its allowed list, malformed JSON, or an invalid
pagination cursor. Fix the fields listed in `errors` and send it again.

## unauthorized
**401.** No `Authorization: Bearer <token>` header, or the token is invalid or expired.
Sign in again. Also used for a wrong email or password on `/auth/login`, with one
message for both, so the API never reveals which emails have accounts.

## forbidden
**403.** You're signed in, but this action isn't allowed for your role or in the
issue's current state, for example a tenant adding a property or a worker closing an
issue. `detail` says who you're signed in as.

## not-found
**404.** It doesn't exist, **or it isn't yours to see**. FixIt deliberately doesn't
distinguish the two, so ids of other people's data can't be probed. Also returned for
API paths that don't exist.

## method-not-allowed
**405.** The path exists, but not with this HTTP method.

## conflict
**409.** The request clashes with the current state: the email or address already
exists, an offer was already answered, the issue already has an offer waiting, it's
closed, or someone else changed it a moment ago. Reload, then decide again.

## idempotency-request-in-progress
**409.** A request with the same `Idempotency-Key` is still being processed. Wait a
moment and retry with the same key: you'll get its result.

## payload-too-large
**413.** A photo is larger than 8 MB.

## unsupported-media-type
**415.** The body isn't in a format this endpoint accepts (JSON, or `multipart/form-data`
where photos are allowed).

## idempotency-key-reused
**422.** This `Idempotency-Key` was already used, by you, for a *different* request (a
different body or endpoint). Use a new key for a new action.

## internal-error
**500.** Something went wrong on the server. Nothing about the cause is exposed; it is
logged. Retrying later may work. For a create request, retry with the same
`Idempotency-Key` so it can't happen twice.

## service-unavailable
**503.** Returned by `/health` (as a health body, not a problem) when the database can't
be reached.
