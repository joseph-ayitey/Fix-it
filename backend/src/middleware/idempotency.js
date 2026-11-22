// Idempotency-Key support for create endpoints (contract: POST /issues).
//
// "Idempotent" = doing it twice has the same effect as doing it once. POST normally isn't:
// if the connection drops after the server created the issue but before the browser got
// the answer, the user retries and gets two issues. With an Idempotency-Key (a random id
// the client makes once per intended action and reuses on retry), the server remembers:
//
//   new key                        -> run the request, store its response
//   same key, same request         -> replay the stored response (nothing created twice),
//                                     with the header Idempotent-Replayed: true
//   same key, different request    -> 422 idempotency-key-reused
//   same key, first still running  -> 409 idempotency-request-in-progress
//   first attempt failed (4xx/5xx) -> the key is released, so a corrected retry can work
//   key older than 24 hours        -> forgotten
//
// Keys are per user. Use after authentication and after the contract validator, so
// invalid requests are rejected before a key is ever stored.

import { createHash } from "node:crypto";
import { one, query } from "../db/index.js";
import { conflict, unprocessable } from "../utils/errors.js";

const KEY_LIFETIME = "24 hours";

/** JSON with object keys sorted, so {a,b} and {b,a} hash the same. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Fingerprint of the request: its body fields and, for uploads, each photo's bytes. */
function requestHash(req) {
  const hash = createHash("sha256");
  hash.update(stableStringify(req.body ?? {}));
  for (const file of req.files ?? []) {
    hash.update(`|${file.fieldname}|${file.originalname}|${createHash("sha256").update(file.buffer).digest("hex")}`);
  }
  return hash.digest("hex");
}

/** @param {string} operation a label that ties a key to one endpoint, e.g. "POST /issues" */
export function idempotent(operation) {
  return async (req, res, next) => {
    const key = req.get("Idempotency-Key");
    if (!key) return next(); // optional: without a key the request just runs

    const userId = req.user.id;
    const hash = requestHash(req);

    await query(
      `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND created_at < now() - interval '${KEY_LIFETIME}'`,
      [userId, key],
    );
    const claimed = await one(
      `INSERT INTO idempotency_keys (user_id, key, operation, request_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
      [userId, key, operation, hash],
    );

    if (!claimed) {
      const seen = await one(`SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [userId, key]);
      if (!seen) return next(); // released between our two queries: treat as new next time
      if (seen.operation !== operation || seen.request_hash !== hash) {
        throw unprocessable(
          "this Idempotency-Key was already used for a different request. Use a new key for a new action",
          "idempotency-key-reused",
        );
      }
      if (seen.status === "in_progress") {
        throw conflict("a request with this Idempotency-Key is still being processed. Retry in a moment", "idempotency-request-in-progress");
      }
      res.set("Idempotent-Replayed", "true");
      if (seen.response_location) res.location(seen.response_location);
      return res.status(seen.response_status).json(seen.response_body);
    }

    // We own the key now. Store the response if it succeeds; release the key otherwise.
    let stored = false;
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        query(
          `UPDATE idempotency_keys SET status = 'completed', response_status = $3, response_body = $4,
             response_location = $5, completed_at = now()
           WHERE user_id = $1 AND key = $2`,
          [userId, key, res.statusCode, JSON.stringify(body), res.get("Location") ?? null],
        )
          .then(() => {
            stored = true;
          })
          .catch((err) => console.error(`could not store idempotent response: ${err.message}`))
          .finally(() => sendJson(body));
        return res;
      }
      return sendJson(body);
    };
    res.on("finish", () => {
      if (!stored) {
        query(`DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND status = 'in_progress'`, [userId, key]).catch(() => {});
      }
    });
    next();
  };
}
