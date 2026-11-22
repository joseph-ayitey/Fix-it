import { useCallback, useEffect, useState } from "react";

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
