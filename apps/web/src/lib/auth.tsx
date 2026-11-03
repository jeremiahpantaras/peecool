import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto, PermissionKey } from '@pickle/shared';
import { ApiError, get, post } from './api';

export function useMe() {
  return useQuery<MeDto | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await get<MeDto>('auth/me'); }
      catch (e) { if (e instanceof ApiError && e.status === 401) return null; if (e instanceof ApiError && e.code === 'PASSWORD_CHANGE_REQUIRED') return null; throw e; }
    },
    staleTime: 20_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500 && e.status > 0) && n < 3,
  });
}

export function usePerm(key: PermissionKey): boolean {
  const { data } = useMe();
  return !!data?.permissions.includes(key);
}
export function useIsAdmin(): boolean { return useMe().data?.user.role === 'admin'; }

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try { await post('auth/logout'); } catch { /* already gone */ }
    // Drop everything the old user could see, then mark `me` signed-out so <App> shows Login immediately (no refresh).
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], null);
  };
}
