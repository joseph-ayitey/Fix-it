import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run an async API call whenever `deps` change and track { data, error, loading }.
 * Aborts the in-flight request when deps change or the component unmounts, so a slow
 * response for old inputs can never overwrite a newer one. `reload()` re-runs it, and
 * `setData()` lets a page apply a mutation's response without refetching.
 */
export function useApi(fetcher, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== "AbortError") setState({ data: null, error, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, setData };
}

/**
 * A cursor-paginated list (decision record 0002): `fetchPage(cursor, signal)` returns
 * { items, page: { nextCursor, hasMore } }. The first page loads whenever `deps` change
 * (new filters start again from the top); `loadMore()` appends the next page.
 *
 * There are no page numbers on purpose: the server hands us an opaque cursor that
 * means "rows after the last one you saw", so nothing is skipped or shown twice when
 * issues are added while you browse.
 *
 * Returns { items, hasMore, loading, error, reload, loadMore, loadingMore, moreError }.
 * `items` is null until the first page arrives.
 */
export function usePagedApi(fetchPage, deps) {
  const first = useApi((signal) => fetchPage(undefined, signal), deps);
  // Pages appended with "Load more". They belong to one first page (`base`): when the
  // first page is replaced (new filters, or reload) they no longer apply.
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
