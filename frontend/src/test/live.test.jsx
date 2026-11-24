// Live data: pages refresh by themselves, so landlord, tenant and worker see each
// other's changes without reloading the page.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LIVE_REFRESH_MS, useApi, usePagedApi } from "../useApi.js";

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A fetcher whose answers we control: each call returns the next value. */
function sequence(...values) {
  let i = 0;
  return vi.fn(async () => values[Math.min(i++, values.length - 1)]);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useApi with { live: true }", () => {
  it("refreshes as soon as you come back to the tab", async () => {
    const fetcher = sequence({ n: 1 }, { n: 2 });
    const { result } = renderHook(() => useApi(fetcher, [], { live: true }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.loading).toBe(false); // silent: no loading flicker
  });

  it(`re-checks every ${LIVE_REFRESH_MS / 1000} s while visible, never in a hidden tab`, async () => {
    const fetcher = sequence({ n: 1 }, { n: 2 }, { n: 3 });
    const { result } = renderHook(() => useApi(fetcher, [], { live: true }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));

    act(() => setVisibility("hidden"));
    const callsWhileHidden = fetcher.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3));
    expect(fetcher.mock.calls.length).toBe(callsWhileHidden);
  });

  it("without live, nothing refreshes by itself", async () => {
    const fetcher = sequence({ n: 1 }, { n: 2 });
    const { result } = renderHook(() => useApi(fetcher, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 2));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a refresh that fails keeps the data on screen", async () => {
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      if (call === 1) return { n: 1 };
      throw new Error("network down");
    });
    const { result } = renderHook(() => useApi(fetcher, [], { live: true }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBeNull();
  });

  it("a refresh that was already under way can't undo a newer change (setData)", async () => {
    let resolveStale;
    let call = 0;
    const fetcher = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ status: "open" });
      return new Promise((resolve) => {
        resolveStale = resolve; // the refresh hangs until we let it finish
      });
    });
    const { result } = renderHook(() => useApi(fetcher, [], { live: true }));
    await waitFor(() => expect(result.current.data).toEqual({ status: "open" }));

    act(() => result.current.refresh()); // a refresh starts…
    act(() => result.current.setData({ status: "resolved" })); // …then the user marks it fixed
    await act(async () => resolveStale({ status: "open" })); // …and the old answer arrives late
    expect(result.current.data).toEqual({ status: "resolved" });
  });
});

describe("usePagedApi with { live: true }", () => {
  const page = (ids, nextCursor) => ({ items: ids.map((id) => ({ id })), page: { limit: 2, nextCursor, hasMore: Boolean(nextCursor) } });

  it("refreshes the first page, picking up an item someone else just added", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([2, 1], null)).mockResolvedValue(page([3, 2], "c1"));
    const { result } = renderHook(() => usePagedApi(fetchPage, [], { live: true }));
    await waitFor(() => expect(result.current.items?.map((x) => x.id)).toEqual([2, 1]));
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual([3, 2]));
  });

  it("after Load more, a refresh asks for everything shown, so the list doesn't shrink", async () => {
    const fetchPage = vi.fn(async (cursor, _signal, size) => {
      if (size) return page([5, 4, 3, 2], "c4"); // the refresh: everything shown so far, plus a new #5
      return cursor ? page([2, 1], null) : page([4, 3], "c2");
    });
    const { result } = renderHook(() => usePagedApi(fetchPage, [], { live: true }));
    await waitFor(() => expect(result.current.items?.length).toBe(2));
    await act(() => result.current.loadMore());
    expect(result.current.items.map((x) => x.id)).toEqual([4, 3, 2, 1]);

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith(undefined, expect.anything(), 4));
    await waitFor(() => expect(result.current.items.map((x) => x.id)).toEqual([5, 4, 3, 2]));
  });
});
