// The only module in the UI that talks to the backend. It attaches the sign-in token,
// turns the API's RFC 9457 Problem Details error bodies into ApiRequestError, and
// signals a sign-out when the server says the token is no longer valid.
// Every path, query parameter and body here follows backend/openapi.yaml (the contract).

const BASE = "/api";
const TOKEN_KEY = "fixit.token";

/**
 * An error from the API. `message` is what to show a person: the problem's `detail`
 * (what went wrong this time), else its `title` (the generic summary of that type).
 * Code should branch on `status` (or `type`), never on the wording (docs/problems.md).
 */
export class ApiRequestError extends Error {
  constructor(message, { status, type, title, detail, errors } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status; // 0 = the server couldn't be reached at all
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.errors = errors ?? []; // [{ field, message }] on validation errors (400)
  }

  /**
   * { field: message } for showing validation errors next to form fields. Body fields
   * are plain names ("title"); other parts of the request are prefixed ("query.limit",
   * "path.issueId", "header.idempotency-key"), so they never collide with a form field.
   */
  get fieldErrors() {
    const out = {};
    for (const e of this.errors) if (e.field && !(e.field in out)) out[e.field] = e.message;
    return out;
  }

  /** Worth retrying unchanged: the server was unreachable, or failed on its side. */
  get isRetryable() {
    return this.status === 0 || this.status >= 500;
  }
}

/** The last part of a problem `type` URL, e.g. "validation-error". */
export function problemKind(error) {
  return error?.type?.split("#")[1] ?? null;
}

// The sign-in is kept per browser TAB (sessionStorage), not per browser (localStorage).
// With localStorage, signing in as a tenant in one tab silently switched every other tab
// to that tenant too: a tab still SHOWING the landlord then sent the tenant's token
// ("only landlords can do this", comments saved under the wrong person). Per tab, each
// tab is exactly who it says it is, and you can be landlord, tenant and worker side by
// side. The cost: a newly opened tab asks you to sign in.
// Storage can throw (private mode, blocked site data): then you sign in again after a reload.
export const tokenStore = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY); // clean up the old shared sign-in, if any
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized = () => {};
/** The auth provider registers a callback here so an expired token signs the user out. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/**
 * Send one request. Returns { status, data, headers } so callers that care about a
 * response header (Idempotent-Replayed) can read it; `headers` adds request headers.
 */
async function request(path, { method = "GET", body, signal, headers: extraHeaders } = {}) {
  const headers = { Accept: "application/json, application/problem+json", ...extraHeaders };
  const isForm = body instanceof FormData;
  // For FormData the browser sets multipart Content-Type itself (with the boundary).
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiRequestError("Can't reach the FixIt server. Is the backend running?", { status: 0 });
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // e.g. an HTML error page from a proxy when the backend is down.
      throw new ApiRequestError(`Unexpected response from the server (HTTP ${res.status})`, { status: res.status });
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    // Errors are application/problem+json: { type, title, status, detail?, instance?, errors? }.
    const problem = data && typeof data === "object" ? data : {};
    throw new ApiRequestError(problem.detail || problem.title || `Request failed (HTTP ${res.status})`, {
      status: res.status,
      type: problem.type,
      title: problem.title,
      detail: problem.detail,
      errors: Array.isArray(problem.errors) ? problem.errors : [],
    });
  }
  return { status: res.status, data, headers: res.headers };
}

const get = async (path, opts) => (await request(path, opts)).data;
const send = async (method, path, body) => (await request(path, { method, body })).data;

function toForm(fields, files) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  for (const file of files) form.append("photos", file, file.name);
  return form;
}

function query(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// Collections (properties, issues, offers, team, directory, activity) all return
// { items, page: { limit, nextCursor, hasMore } } (decision record 0002). The list
// functions below return that object as is; pass `page.nextCursor` back as `cursor`.
export const api = {
  health: (opts) => get("/health", opts),

  register: (body) => send("POST", "/auth/register", body),
  login: (body) => send("POST", "/auth/login", body),
  me: (opts) => get("/auth/me", opts),
  updateMe: (changes) => send("PATCH", "/auth/me", changes),

  /** params: { limit, cursor, q } */
  listProperties: (params, opts) => get(`/properties${query(params)}`, opts),
  getProperty: (id, opts) => get(`/properties/${encodeURIComponent(id)}`, opts),
  addProperty: (body) => send("POST", "/properties", body),
  renameProperty: (id, label) => send("PATCH", `/properties/${id}`, { label }),
  rotateJoinCode: (id) => send("POST", `/properties/${id}/join-code`),
  retryGeocode: (id) => send("POST", `/properties/${id}/geocode`),
  removeTenant: (propertyId, tenantId) => send("DELETE", `/properties/${propertyId}/tenants/${tenantId}`),
  joinProperty: (code) => send("POST", "/properties/join", { code }),

  /** params: { status, propertyId, assignment, urgency, category, q, sort, limit, cursor } */
  listIssues: (params, opts) => get(`/issues${query(params)}`, opts),
  issueSummary: (opts) => get("/issues/summary", opts),
  getIssue: (id, opts) => get(`/issues/${encodeURIComponent(id)}`, opts),
  /**
   * Report an issue: JSON when there are no photos, multipart/form-data when there are.
   * `idempotencyKey` makes retries safe (decision record 0003): the same key + the same
   * body returns the original issue instead of creating a second one. Resolves to
   * { issue, replayed }, where `replayed` means the server had already received it.
   */
  reportIssue: async (fields, photos = [], { idempotencyKey } = {}) => {
    const { data, headers } = await request("/issues", {
      method: "POST",
      body: photos.length ? toForm(fields, photos) : fields,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
    return { issue: data, replayed: headers.get("Idempotent-Replayed") === "true" };
  },
  /** visibility "internal" = private landlord-worker note, hidden from the tenant. */
  comment: (id, body, photos = [], visibility = "shared") => {
    const fields = { ...(body ? { body } : {}), visibility };
    return send("POST", `/issues/${id}/comments`, photos.length ? toForm(fields, photos) : fields);
  },
  confirmFix: (id, note) => send("POST", `/issues/${id}/confirm`, note ? { note } : {}),
  /** Photos need the auth header, so <img src> can't load them directly: fetch as a blob. */
  photoBlob: async (url, { signal } = {}) => {
    const token = tokenStore.get();
    const res = await fetch(url, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiRequestError(`Couldn't load photo (HTTP ${res.status})`, { status: res.status });
    return res.blob();
  },
  changeStatus: (id, status, note) => send("PATCH", `/issues/${id}/status`, note ? { status, note } : { status }),
  unassignWorker: (id) => send("DELETE", `/issues/${id}/assignment`),

  /** Landlords: workers who accepted your jobs. */
  myWorkers: (opts) => get("/team/workers", opts),
  /** Workers: the landlords you work for. */
  myLandlords: (opts) => get("/team/landlords", opts),
  /** Landlords: the worker directory. params: { trade, city } */
  findWorkers: (params, opts) => get(`/team/directory${query(params)}`, opts),
  /** Resolves to { unassignedIssues }. */
  removeWorker: (workerId) => send("DELETE", `/team/workers/${workerId}`),

  offers: (opts) => get("/offers", opts),
  offerJob: (issueId, workerId, message) => send("POST", "/offers", message ? { issueId, workerId, message } : { issueId, workerId }),
  acceptOffer: (id, response) => send("POST", `/offers/${id}/accept`, response ? { response } : {}),
  declineOffer: (id, response) => send("POST", `/offers/${id}/decline`, response ? { response } : {}),
  // The contract declares no request body for withdraw, so none is sent.
  withdrawOffer: (id) => send("POST", `/offers/${id}/withdraw`),

  /** Counts, median response times and the 12-week trend (decision record 0004). */
  dashboardStats: (opts) => get("/dashboard/stats", opts),
  /** Latest timeline events across your issues, newest first. params: { limit (1-50), cursor } */
  activity: (params, opts) => get(`/dashboard/activity${query(params)}`, opts),
};
