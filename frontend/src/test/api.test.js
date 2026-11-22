import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, ApiRequestError, setUnauthorizedHandler, tokenStore } from "../api.js";
import { fakeFetch, page, problem } from "./fakeFetch.js";

beforeEach(() => tokenStore.set(null));

describe("api client", () => {
  it("sends the stored token as a Bearer header", async () => {
    tokenStore.set("abc.def.ghi");
    const fetchMock = fakeFetch({ "GET /properties": () => page([]) });
    await api.listProperties();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("builds issue queries and leaves out empty filters", async () => {
    const fetchMock = fakeFetch({ "GET /issues": () => page([]) });
    const result = await api.listIssues({ status: "active", propertyId: "", urgency: "urgent", q: "leak", sort: "newest", limit: 20, cursor: "abc" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/issues?status=active&urgency=urgent&q=leak&sort=newest&limit=20&cursor=abc");
    expect(result).toEqual({ items: [], page: { limit: 20, nextCursor: null, hasMore: false } });
  });

  it("turns Problem Details into ApiRequestError with the detail and per-field messages", async () => {
    fakeFetch({
      "POST /auth/register": () =>
        problem(400, "email: must match format \"email\"", {
          errors: [
            { field: "email", message: 'must match format "email"' },
            { field: "query.limit", message: "must be <= 100" },
          ],
        }),
    });
    const err = await api.register({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('email: must match format "email"');
    expect(err.type).toMatch(/#validation-error$/);
    expect(err.fieldErrors).toEqual({ email: 'must match format "email"', "query.limit": "must be <= 100" });
    expect(err.isRetryable).toBe(false);
  });

  it("falls back to the problem's title when there is no detail", async () => {
    fakeFetch({ "GET /issues/summary": () => problem(500, undefined) });
    const err = await api.issueSummary().catch((e) => e);
    expect(err.message).toBe("Something went wrong on the server");
    expect(err.isRetryable).toBe(true);
  });

  it("calls the split team endpoints from the contract", async () => {
    const fetchMock = fakeFetch({
      "GET /team/workers": () => page([]),
      "GET /team/landlords": () => page([]),
      "DELETE /team/workers/3": () => ({ body: { unassignedIssues: 2 } }),
    });
    await api.myWorkers();
    await api.myLandlords();
    expect(await api.removeWorker(3)).toEqual({ unassignedIssues: 2 });
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "GET /api/team/workers",
      "GET /api/team/landlords",
      "DELETE /api/team/workers/3",
    ]);
  });

  it("sends an Idempotency-Key with a report and reads Idempotent-Replayed", async () => {
    const fetchMock = fakeFetch({ "POST /issues": () => ({ status: 201, body: { id: 7 }, headers: { "Idempotent-Replayed": "true" } }) });
    const result = await api.reportIssue({ title: "x" }, [], { idempotencyKey: "key-12345678" });
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("key-12345678");
    expect(result).toEqual({ issue: { id: 7 }, replayed: true });
  });

  it("signs out on a 401 when a token was sent", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    tokenStore.set("expired");
    fakeFetch({ "GET /issues": () => problem(401, "Your session has expired") });
    await api.listIssues().catch(() => {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it("explains an unreachable backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.health().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/backend running/);
  });
});
