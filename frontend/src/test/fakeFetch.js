import { vi } from "vitest";

/**
 * Stub global fetch with a router: `routes` maps "METHOD /path" (no /api prefix, no
 * query string) to (url, init) -> { status, body }. Returns the mock to inspect calls.
 */
export function fakeFetch(routes) {
  const mock = vi.fn(async (input, init = {}) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method ?? "GET"} ${url.pathname.replace(/^\/api/, "")}`;
    const handler = routes[key];
    const { status = 200, body = null } = handler
      ? await handler(url, init)
      : { status: 404, body: { error: { message: `no fake for ${key}` } } };
    return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export const landlordUser = { id: 1, email: "landlord@fixit.test", name: "Maria Garcia", role: "landlord", createdAt: "2026-01-01T00:00:00.000Z" };
export const tenantUser = { id: 2, email: "tenant@fixit.test", name: "Anna Soler", role: "tenant", createdAt: "2026-01-01T00:00:00.000Z" };

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

export function sampleIssue(overrides = {}) {
  return {
    id: 100,
    property: { id: 10, label: "Eixample flat", address: sampleProperty.addressInput, city: "Barcelona" },
    reporter: { id: 2, name: "Anna Soler" },
    title: "Water leaking under the kitchen sink",
    description: "Steady drip from the pipe.",
    category: "plumbing",
    urgency: "urgent",
    status: "open",
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: hoursAgo(50),
    updatedAt: hoursAgo(50),
    allowedTransitions: [],
    events: [
      { id: 1, type: "reported", actor: { id: 2, name: "Anna Soler", role: "tenant" }, body: null, fromStatus: null, toStatus: "open", createdAt: hoursAgo(50) },
    ],
    ...overrides,
  };
}
