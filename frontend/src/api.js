// The only module in the UI that talks to the backend. It attaches the sign-in token,
// turns the API's { error: { message, details } } bodies into ApiRequestError, and
// signals a sign-out when the server says the token is no longer valid.

const BASE = "/api";
const TOKEN_KEY = "fixit.token";

export class ApiRequestError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }

  /** { field: message } for showing validation errors next to form fields. */
  get fieldErrors() {
    return Object.fromEntries((this.details ?? []).filter((d) => d.field).map((d) => [d.field, d.message]));
  }
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

async function request(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
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
      throw new ApiRequestError(`Unexpected response from the server (HTTP ${res.status})`, { status: res.status });
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiRequestError(data?.error?.message ?? `Request failed (HTTP ${res.status})`, {
      status: res.status,
      details: data?.error?.details,
    });
  }
  return { status: res.status, data };
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

export const api = {
  health: (opts) => get("/health", opts),

  register: (body) => send("POST", "/auth/register", body),
  login: (body) => send("POST", "/auth/login", body),
  me: (opts) => get("/auth/me", opts),
  updateMe: (changes) => send("PATCH", "/auth/me", changes),

  listProperties: (opts) => get("/properties", opts),
  getProperty: (id, opts) => get(`/properties/${encodeURIComponent(id)}`, opts),
  addProperty: (body) => send("POST", "/properties", body),
  renameProperty: (id, label) => send("PATCH", `/properties/${id}`, { label }),
  rotateJoinCode: (id) => send("POST", `/properties/${id}/join-code`),
  retryGeocode: (id) => send("POST", `/properties/${id}/geocode`),
  removeTenant: (propertyId, tenantId) => send("DELETE", `/properties/${propertyId}/tenants/${tenantId}`),
  joinProperty: (code) => send("POST", "/properties/join", { code }),

  listIssues: (params, opts) => get(`/issues${query(params)}`, opts),
  issueSummary: (opts) => get("/issues/summary", opts),
  getIssue: (id, opts) => get(`/issues/${encodeURIComponent(id)}`, opts),
  /** JSON when there are no photos, multipart/form-data when there are. */
  reportIssue: (fields, photos = []) => send("POST", "/issues", photos.length ? toForm(fields, photos) : fields),
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

  team: (opts) => get("/team", opts),
  findWorkers: (params, opts) => get(`/team/directory${query(params)}`, opts),
  removeWorker: (workerId) => send("DELETE", `/team/${workerId}`),

  offers: (opts) => get("/offers", opts),
  offerJob: (issueId, workerId, message) => send("POST", "/offers", message ? { issueId, workerId, message } : { issueId, workerId }),
  acceptOffer: (id, response) => send("POST", `/offers/${id}/accept`, response ? { response } : {}),
  declineOffer: (id, response) => send("POST", `/offers/${id}/decline`, response ? { response } : {}),
  withdrawOffer: (id) => send("POST", `/offers/${id}/withdraw`, {}),
};
