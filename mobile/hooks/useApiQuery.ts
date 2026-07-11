import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ── Query cache ─────────────────────────────────────────────────────────────
// Stale-while-revalidate cache, persisted to disk. A screen that mounts with
// a cacheKey renders the last known data instantly (no loading flash) and
// revalidates silently — including on a cold app launch, where the previous
// session's data is hydrated before the first screen renders so the app never
// opens onto a blank page while the backend wakes up. Cleared on sign-out so
// accounts never see each other's data.
const queryCache = new Map<string, unknown>();

const CACHE_STORAGE_KEY = 'mneme_query_cache_v1';
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced write-through: batch rapid cache updates into one disk write. */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(queryCache))).catch(() => {
      // Persistence is best-effort; the in-memory cache still works.
    });
  }, 800);
}

/** Load the previous session's cache. Called once at app start, before render. */
export async function hydrateQueryCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      // Live data always wins over what was on disk.
      if (!queryCache.has(key)) queryCache.set(key, value);
    }
  } catch {
    // A corrupt cache file just means a cold start.
  }
}

export function clearQueryCache() {
  queryCache.clear();
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  AsyncStorage.removeItem(CACHE_STORAGE_KEY).catch(() => {});
}

/** Warm the cache before a screen is ever visited (e.g. on tab-bar mount). */
export async function prefetchQuery<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<void> {
  if (queryCache.has(cacheKey)) return;
  try {
    queryCache.set(cacheKey, await fetcher());
    schedulePersist();
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
      if (cacheKey !== undefined) {
        queryCache.set(cacheKey, data);
        schedulePersist();
      }
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
