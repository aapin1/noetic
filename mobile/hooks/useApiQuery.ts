import { useCallback, useEffect, useRef, useState } from 'react';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ── Query cache ─────────────────────────────────────────────────────────────
// Session-scoped stale-while-revalidate cache. A screen that mounts with a
// cacheKey renders the last known data instantly (no loading flash) and
// revalidates silently. Cleared on sign-out so accounts never see each
// other's data.
const queryCache = new Map<string, unknown>();

export function clearQueryCache() {
  queryCache.clear();
}

/** Warm the cache before a screen is ever visited (e.g. on tab-bar mount). */
export async function prefetchQuery<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<void> {
  if (queryCache.has(cacheKey)) return;
  try {
    queryCache.set(cacheKey, await fetcher());
  } catch {
    // Prefetch is best-effort; the screen's own fetch will surface errors.
  }
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options?: { skip?: boolean; cacheKey?: string },
) {
  const cacheKey = options?.cacheKey;
  const cached = cacheKey !== undefined ? (queryCache.get(cacheKey) as T | undefined) : undefined;
  const [state, setState] = useState<QueryState<T>>({
    data: cached ?? null,
    loading: !options?.skip && cached === undefined,
    error: null,
  });
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    cancelRef.current = false;
    // Keep any previously loaded data on screen while revalidating so a
    // refetch (e.g. on tab focus) doesn't blank the UI and flash a spinner.
    setState((s) => ({ data: s.data, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (cacheKey !== undefined) queryCache.set(cacheKey, data);
      if (!cancelRef.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (!cancelRef.current) {
        setState((s) => ({
          // Keep showing cached data on a failed revalidate — a network blip
          // shouldn't blank a screen that was already populated.
          data: s.data,
          loading: false,
          error: e instanceof Error ? e.message : 'An error occurred',
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (options?.skip) return;
    run();
    return () => { cancelRef.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, options?.skip]);

  return { ...state, refetch: run };
}

export function useApiMutation<TArgs, TResult>(
  mutator: (args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (args: TArgs): Promise<TResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await mutator(args);
        setLoading(false);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'An error occurred';
        setError(msg);
        setLoading(false);
        throw e;
      }
    },
    [mutator],
  );

  return { mutate, loading, error };
}
