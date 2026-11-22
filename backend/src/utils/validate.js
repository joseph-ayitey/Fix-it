// Small request-body validator. Each field rule returns the cleaned value or pushes an
// error; validate() throws one 400 listing every problem at once, so a form can show
// all of them instead of one per round trip.

import { badRequest } from "./errors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} body
 * @param {Record<string, { type?: 'string'|'email'|'integer', required?: boolean, min?: number,
 *         max?: number, oneOf?: string[] }>} rules
 * @returns {object} cleaned values (strings trimmed, emails lowercased, blanks -> null)
 */
export function validate(body, rules) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("request body must be a JSON object");
  }

  const errors = [];
  const out = {};

  for (const key of Object.keys(body)) {
    if (!(key in rules)) errors.push({ field: key, message: "is not an allowed field" });
  }

  for (const [field, rule] of Object.entries(rules)) {
    const { type = "string", required = false, min, max, oneOf } = rule;
    let value = body[field];

    if (typeof value === "string") value = value.trim();
    if (value === undefined || value === null || value === "") {
      if (required) errors.push({ field, message: "is required" });
      out[field] = null;
      continue;
    }

    if (type === "integer") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n) || n < 1) {
        errors.push({ field, message: "must be a positive integer" });
        continue;
      }
      out[field] = n;
      continue;
    }

    if (typeof value !== "string") {
      errors.push({ field, message: "must be a string" });
      continue;
    }
    if (min !== undefined && value.length < min) errors.push({ field, message: `must be at least ${min} characters` });
    if (max !== undefined && value.length > max) errors.push({ field, message: `must be at most ${max} characters` });
    if (type === "email") {
      value = value.toLowerCase();
      if (!EMAIL_RE.test(value)) errors.push({ field, message: "must be a valid email address" });
    }
    if (oneOf && !oneOf.includes(value)) errors.push({ field, message: `must be one of: ${oneOf.join(", ")}` });
    out[field] = value;
  }

  if (errors.length) {
    throw badRequest(errors.map((e) => `${e.field} ${e.message}`).join("; "), errors);
  }
  return out;
}

/** Parse a :id route param; 404 (not 400) for junk, since /issues/abc simply doesn't exist. */
export function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
