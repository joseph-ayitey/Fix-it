// Every API error leaves the server through toProblem(), as RFC 9457 Problem Details
// (application/problem+json). The `type` of each problem links to its explanation in
// docs/problems.md; openapi.yaml declares the shape (components/schemas/Problem).

const DOCS = "https://github.com/joseph-ayitey/fixit/blob/main/docs/problems.md#";

const BY_STATUS = {
  400: ["validation-error", "Your request has invalid fields"],
  401: ["unauthorized", "Sign-in required"],
  403: ["forbidden", "Not allowed"],
  404: ["not-found", "Not found"],
  405: ["method-not-allowed", "Method not allowed"],
  409: ["conflict", "Conflict with the current state"],
  413: ["payload-too-large", "Upload too large"],
  415: ["unsupported-media-type", "Unsupported request format"],
  422: ["idempotency-key-reused", "Idempotency-Key already used for a different request"],
  500: ["internal-error", "Something went wrong on our side"],
};

/** Titles for problem types that share a status code with another type. */
const BY_SLUG = {
  "idempotency-request-in-progress": "A request with this Idempotency-Key is still being processed",
};

/**
 * @param {number} status
 * @param {{ detail?: string, errors?: Array<{field: string, message: string}>, slug?: string, instance?: string }} [extra]
 */
export function problem(status, { detail, errors, slug, instance } = {}) {
  const [defaultSlug, defaultTitle] = BY_STATUS[status] ?? BY_STATUS[status >= 500 ? 500 : 400];
  const type = slug ?? defaultSlug;
  return {
    type: DOCS + type,
    title: BY_SLUG[type] ?? defaultTitle,
    status,
    ...(detail ? { detail } : {}),
    ...(instance ? { instance } : {}),
    ...(errors?.length ? { errors } : {}),
  };
}

/**
 * express-openapi-validator reports errors like { path: "/body/title", message } or
 * { path: "/query/limit" }. Turn them into the contract's FieldError: body fields by
 * name ("title"), other parts prefixed ("query.limit", "path.issueId", "header.idempotency-key").
 */
export function fieldErrorsFromValidator(errors = []) {
  return errors.map((e) => {
    const parts = String(e.path ?? "").replace(/^[./]/, "").split(/[./]/).filter(Boolean);
    const [where, ...rest] = parts;
    // An unknown field is reported on its parent; name the field itself.
    const extra = e.errorCode?.startsWith("additionalProperties") ? e.params?.additionalProperty ?? e.additionalProperty : null;
    const name = [...rest, ...(extra && rest.at(-1) !== extra ? [extra] : [])].join(".");
    const prefix = { body: "", query: "query.", params: "path.", headers: "header.", cookies: "cookie." }[where] ?? `${where}.`;
    return { field: (prefix + name).replace(/\.$/, "") || "body", message: e.message };
  });
}
