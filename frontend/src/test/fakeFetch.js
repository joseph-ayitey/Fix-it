import { vi } from "vitest";

/**
 * Stub global fetch with a router: `routes` maps "METHOD /path" (no /api prefix, no
 * query string) to (url, init) -> { status, body, headers }. Returns the mock to inspect
 * calls. A body with a numeric `status` and a `title` on an error response is sent as
 * application/problem+json, like the real API; unknown routes answer a 404 problem.
 */
export function fakeFetch(routes) {
  const mock = vi.fn(async (input, init = {}) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method ?? "GET"} ${url.pathname.replace(/^\/api/, "")}`;
    const handler = routes[key];
    const { status = 200, body = null, headers = {} } = handler ? await handler(url, init) : problem(404, `no fake for ${key}`, { type: "not-found", title: "Not found" });
    const contentType = status >= 400 ? "application/problem+json" : "application/json";
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": contentType, ...headers } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const PROBLEMS = "https://github.com/joseph-ayitey/fixit/blob/main/docs/problems.md";
const TITLES = {
  400: ["validation-error", "Your request has invalid fields"],
  401: ["unauthorized", "You need to sign in"],
  403: ["forbidden", "You're not allowed to do this"],
  404: ["not-found", "Not found"],
  409: ["conflict", "Conflict"],
  422: ["idempotency-key-reused", "Idempotency key reused"],
  500: ["internal-error", "Something went wrong on the server"],
  503: ["service-unavailable", "Service unavailable"],
};

/** An RFC 9457 Problem Details response: problem(400, "title: too short", { errors: [...] }). */
export function problem(status, detail, { errors, type, title } = {}) {
  const [kind, defaultTitle] = TITLES[status] ?? ["internal-error", "Error"];
  return {
    status,
    body: {
      type: `${PROBLEMS}#${type ?? kind}`,
      title: title ?? defaultTitle,
      status,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
    },
  };
}

/** A collection page: { items, page: { limit, nextCursor, hasMore } } (decision 0002). */
export function page(items, { nextCursor = null, limit = 20 } = {}) {
  return { body: { items, page: { limit, nextCursor, hasMore: nextCursor !== null } } };
}

export const landlordUser = { id: 1, email: "landlord@fixit.test", name: "Maria Garcia", role: "landlord", trade: null, area: null, createdAt: "2026-01-01T00:00:00.000Z" };
export const tenantUser = { id: 2, email: "tenant@fixit.test", name: "Anna Soler", role: "tenant", trade: null, area: null, createdAt: "2026-01-01T00:00:00.000Z" };
export const workerUser = { id: 3, email: "worker@fixit.test", name: "Marc Ribas", role: "worker", trade: "plumber", area: "Barcelona", createdAt: "2026-01-01T00:00:00.000Z" };

export const sampleProperty = {
  id: 10,
  label: "Eixample flat",
  addressInput: "Carrer de Mallorca 401, Barcelona, Spain",
  streetAddress: "401 Carrer de Mallorca",
  city: "Barcelona",
  postcode: "08013",
  country: "Spain",
  countryCode: "es",
  latitude: 41.4031876,
  longitude: 2.1748235,
  displayName: "401, Carrer de Mallorca, Barcelona, Spain",
  geocodeStatus: "ok",
  landlord: { id: 1, name: "Maria Garcia", email: "landlord@fixit.test" },
  tenantCount: 1,
  openIssueCount: 1,
  urgentIssueCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

/** An IssueDetail as the contract describes it (an Issue in lists, plus `events`). */
export function sampleIssue(overrides = {}) {
  return {
    id: 100,
    property: { id: 10, label: "Eixample flat", address: sampleProperty.addressInput, city: "Barcelona", latitude: sampleProperty.latitude, longitude: sampleProperty.longitude },
    reporter: { id: 2, name: "Anna Soler" },
    assignee: null,
    assignedAt: null,
    title: "Water leaking under the kitchen sink",
    description: "Steady drip from the pipe.",
    category: "plumbing",
    urgency: "urgent",
    status: "open",
    acknowledgedAt: null,
    resolvedAt: null,
    confirmations: { tenant: null, landlord: null },
    closedAt: null,
    createdAt: hoursAgo(50),
    updatedAt: hoursAgo(50),
    photoCount: 0,
    allowedTransitions: [],
    canConfirm: false,
    events: [
      {
        id: 1,
        type: "reported",
        visibility: "shared",
        actor: { id: 2, name: "Anna Soler", role: "tenant" },
        subject: null,
        body: null,
        fromStatus: null,
        toStatus: "open",
        createdAt: hoursAgo(50),
        photos: [],
      },
    ],
    ...overrides,
  };
}

/** GET /issues/summary with everything at zero, plus overrides. */
export function sampleSummary(overrides = {}) {
  return { active: 0, urgent: 0, unacknowledged: 0, unassigned: 0, awaitingConfirmation: 0, needsYourConfirmation: 0, ...overrides };
}

const CATEGORIES = ["plumbing", "electrical", "heating", "appliance", "structural", "pest", "security", "other"];

/** GET /dashboard/stats: 12 weeks, every category, plus overrides. */
export function sampleStats(overrides = {}) {
  const monday = Date.UTC(2026, 10, 16);
  return {
    total: 7,
    byStatus: { open: 2, in_progress: 1, resolved: 1, closed: 3 },
    byUrgency: { low: 0, normal: 2, urgent: 1 },
    byCategory: CATEGORIES.map((category) => ({
      category,
      active: category === "plumbing" ? 2 : category === "electrical" ? 1 : 0,
      total: category === "plumbing" ? 5 : category === "electrical" ? 2 : 0,
    })),
    responseTimes: { windowDays: 90, medianHoursToFirstResponse: 5.5, medianHoursToClose: 72, respondedCount: 6, closedCount: 3 },
    weekly: Array.from({ length: 12 }, (_, i) => ({
      weekStart: new Date(monday - (11 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
      reported: i % 3,
      closed: i % 2,
    })),
    ...overrides,
  };
}

/** One ActivityEvent from GET /dashboard/activity. */
export function sampleActivity(overrides = {}) {
  return {
    id: 500,
    type: "comment",
    visibility: "shared",
    createdAt: hoursAgo(1),
    actor: { id: 1, name: "Maria Garcia", role: "landlord" },
    subject: null,
    toStatus: null,
    excerpt: "A plumber is coming on Thursday morning.",
    photoCount: 0,
    issue: { id: 100, title: "Water leaking under the kitchen sink", urgency: "urgent", status: "open", propertyLabel: "Eixample flat" },
    ...overrides,
  };
}

/** The dashboard's statistics and activity endpoints, answered with sample data. */
export const dashboardRoutes = {
  "GET /dashboard/stats": () => ({ body: sampleStats() }),
  "GET /dashboard/activity": () => page([sampleActivity()]),
};
