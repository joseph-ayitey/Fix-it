import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, ApiRequestError, setUnauthorizedHandler, tokenStore } from "../api.js";
import { fakeFetch } from "./fakeFetch.js";

beforeEach(() => tokenStore.set(null));

describe("api client", () => {
  it("sends the stored token as a Bearer header", async () => {
    tokenStore.set("abc.def.ghi");
    const fetchMock = fakeFetch({ "GET /properties": () => ({ body: [] }) });
    await api.listProperties();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("builds issue queries and leaves out empty filters", async () => {
    const fetchMock = fakeFetch({ "GET /issues": () => ({ body: [] }) });
    await api.listIssues({ status: "active", propertyId: "" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/issues?status=active");
  });

  it("turns error bodies into ApiRequestError with per-field messages", async () => {
    fakeFetch({
      "POST /auth/register": () => ({
        status: 400,
        body: { error: { message: "bad", details: [{ field: "email", message: "must be a valid email address" }] } },
      }),
    });
    const err = await api.register({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.fieldErrors).toEqual({ email: "must be a valid email address" });
  });

  it("signs out on a 401 when a token was sent", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    tokenStore.set("expired");
    fakeFetch({ "GET /issues": () => ({ status: 401, body: { error: { message: "expired" } } }) });
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
