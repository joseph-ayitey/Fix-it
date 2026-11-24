import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How often "live" data is re-checked while its tab is visible. Landlord, tenant and
 * worker usually look at the same issue from different browsers or tabs: without this,
 * one only saw the others' changes after a manual refresh.
 */
export const LIVE_REFRESH_MS = 15_000;

/**
 * Calls `refresh()` when the user comes back to this tab or window, and every
 * `intervalMs` while the tab is visible. Nothing runs in a hidden tab: coming back to
 * it refreshes at once instead, which is when it matters.
 */
function useLiveRefresh(refresh, { enabled, intervalMs }) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    const visible = () => document.visibilityState !== "hidden";
    const schedule = () => {
      clearTimeout(timer);
      if (visible()) timer = setTimeout(tick, intervalMs);
    };
    // A chain of timeouts, not setInterval: the next check is planned after this one.
    function tick() {
      refreshRef.current();
      schedule();
    }
    const onReturn = () => (visible() ? tick() : clearTimeout(timer));

    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [enabled, intervalMs]);
}

/**
 * Run an async API call whenever `deps` change and track { data, error, loading }.
 * Aborts the in-flight request when deps change or the component unmounts, so a slow
 * response for old inputs can never overwrite a newer one. `reload()` re-runs it (with
 * the loading state), and `setData()` lets a page apply a mutation's response.
 *
 * Options:
 *   live: also refresh silently when the user returns to the tab and every
 *         LIVE_REFRESH_MS while it's visible (see useLiveRefresh). A silent refresh
 *         never shows a loading state, and if it fails the data on screen stays.
 *
 * Also returns `refresh(fetcherOverride?)`: one silent refresh, optionally with a
 * different fetcher (usePagedApi uses that to refresh everything already loaded).
 */
export function useApi(fetcher, deps, { live = false, intervalMs = LIVE_REFRESH_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // the latest closure, with the current deps
  const silent = useRef(null); // the in-flight silent refresh, if any
  const loadingRef = useRef(true); // a normal (non-silent) load is running
  // Bumped by every load and every setData(). A silent refresh that started before
  // the bump is out of date when it lands (e.g. it began just before the user clicked
  // "Mark as fixed"), so its result is thrown away instead of undoing the change.
  const version = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    version.current += 1;
    silent.current?.abort();
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ data: null, error, loading: false });
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingRef.current = false;
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  useEffect(() => () => silent.current?.abort(), []);

  const refresh = useCallback((fetcherOverride) => {
    // Not while the first load (or another refresh) is running: it would only race it.
    if (silent.current || loadingRef.current) return;
    const controller = new AbortController();
    silent.current = controller;
    const startedAt = version.current;
    (fetcherOverride ?? fetcherRef.current)(controller.signal)
      .then((data) => {
        if (version.current === startedAt) setState((s) => (s.loading ? s : { data, error: null, loading: false }));
      })
      .catch(() => {
        // Keep what's on screen; the next refresh tries again.
      })
      .finally(() => {
        if (silent.current === controller) silent.current = null;
      });
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data) => {
    version.current += 1;
    silent.current?.abort();
    silent.current = null;
    setState({ data, error: null, loading: false });
  }, []);

  useLiveRefresh(refresh, { enabled: live, intervalMs });
  return { ...state, reload, setData, refresh };
}

/**
 * A cursor-paginated list (decision record 0002): `fetchPage(cursor, signal, size)`
 * returns { items, page: { nextCursor, hasMore } }. `size` is normally undefined (use
 * your usual page size); a refresh passes a bigger one, see below. The first page loads
 * whenever `deps` change (new filters start again from the top); `loadMore()` appends
 * the next page.
 *
 * There are no page numbers on purpose: the server hands us an opaque cursor that
 * means "rows after the last one you saw", so nothing is skipped or shown twice when
 * issues are added while you browse.
 *
 * With { live: true } the list refreshes silently like useApi's. If "Load more" has been
 * used, the refresh asks for everything shown so far in one request (up to 100, the
 * API's largest page), so the list doesn't shrink back to its first page.
 *
 * Returns { items, hasMore, loading, error, reload, loadMore, loadingMore, moreError }.
 * `items` is null until the first page arrives.
 */
export function usePagedApi(fetchPage, deps, { live = false, intervalMs = LIVE_REFRESH_MS } = {}) {
  const first = useApi((signal) => fetchPage(undefined, signal), deps);
  // Pages appended with "Load more". They belong to one first page (`base`): when the
  // first page is replaced (new filters, reload or refresh) they no longer apply.
  const [extra, setExtra] = useState({ base: null, items: [], page: null });
  const [more, setMore] = useState({ loading: false, error: null, base: null });
  const moreController = useRef(null);

  useEffect(() => {
    moreController.current?.abort();
  }, [first.data]);
  useEffect(() => () => moreController.current?.abort(), []);

  const own = extra.base === first.data ? extra : { items: [], page: null };
  const moreState = more.base === first.data ? more : { loading: false, error: null };
  const page = own.page ?? first.data?.page;
  const items = first.data ? [...first.data.items, ...own.items] : null;

  const loadMore = useCallback(async () => {
    const base = first.data;
    if (!base || !page?.nextCursor) return;
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ loading: true, error: null, base });
    try {
      const next = await fetchPage(page.nextCursor, controller.signal);
      setExtra((prev) => {
        const kept = prev.base === base ? prev.items : [];
        // Ignore ids we already have, in case a row moved between pages.
        const seen = new Set([...base.items, ...kept].map((x) => x.id));
        return { base, items: [...kept, ...next.items.filter((x) => !seen.has(x.id))], page: next.page };
      });
      setMore({ loading: false, error: null, base });
    } catch (error) {
      if (error.name !== "AbortError") setMore({ loading: false, error, base });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.nextCursor, first.data]);

  // Silent refresh: the first page alone, or, after "Load more", everything shown so far.
  const shown = items?.length ?? 0;
  const extended = own.items.length > 0;
  const refresh = useCallback(() => {
    if (moreController.current && moreState.loading) return; // don't fight a Load more
    const size = extended ? Math.min(Math.max(shown, 1), 100) : undefined;
    first.refresh((signal) => fetchPage(undefined, signal, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extended, shown, moreState.loading, first.refresh, ...deps]);

  useLiveRefresh(refresh, { enabled: live, intervalMs });

  return {
    items,
    hasMore: Boolean(page?.hasMore && page?.nextCursor),
    loading: first.loading,
    error: first.error,
    reload: first.reload,
    loadMore,
    loadingMore: moreState.loading,
    moreError: moreState.error,
  };
}
