# 0001: Errors are RFC 9457 Problem Details

- **Status:** Accepted
- **Date:** 2026-11-22

## Context
Until now every error was `{ "error": { "message", "details?" } }`. It was consistent,
but it was FixIt's own invention: a consumer had to learn it, and generic HTTP tooling
couldn't recognise it. The contract needs one documented error shape.

## Decision
Every error is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details
object, served as `application/problem+json`:
- `type` is a URL into [docs/problems.md](../problems.md), one section per kind of problem;
- `title` is fixed per type, `detail` explains this occurrence, and `instance` is the path;
- validation errors add `errors: [{ field, message }]`, listing **every** invalid field.

Status codes: 400 invalid input (including invalid cursors), 401 not signed in, 403 not
allowed, 404 missing **or not yours**, 405, 409 state conflict, 413, 415, 422 reused
idempotency key, 500.

## Alternatives considered
- **Keep the old shape**: it works, but it isn't a standard, which is the point of the exercise.
- **422 for all validation errors**: also common. 400 was kept, because the validator and
  most APIs use 400 for "the request doesn't match the schema". 422 is reserved for a
  semantically valid request we refuse (a reused idempotency key).

## Consequences
- One function (`backend/src/utils/problems.js`) builds every error, and the contract
  declares the shape, so responses are validated.
- The web app reads `errors[].field` to show messages next to form fields.
- It's a breaking change for any client of the old shape (only the web app, updated with it).
