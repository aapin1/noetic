import { useCallback, useEffect, useRef, useState } from 'react';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  options?: { skip?: boolean },
) {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    loading: !options?.skip,
    error: null,
  });
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    cancelRef.current = false;
    setState({ data: null, loading: true, error: null });
    try {
      const data = await fetcher();
      if (!cancelRef.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (!cancelRef.current) {
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : 'An error occurred',
        });
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
