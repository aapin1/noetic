import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';

/** Cached across consumers so the ad card and paywall share one fetch. */
export function useEntitlements() {
  const { data, loading, refetch } = useApiQuery(() => api.plus.entitlements(), [], {
    cacheKey: 'plus.entitlements',
  });
  return {
    plan: data?.plan ?? null,
    usage: data?.usage ?? [],
    loading,
    refetch,
  };
}
