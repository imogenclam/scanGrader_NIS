import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { User } from '@/api'

export type CurrentUser = User

export const profileQueryOptions = () =>
  queryOptions({
    queryKey: ['profile'],
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        return await api.get<CurrentUser>('/api/me')
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })

export function useUser() {
  const q = useQuery(profileQueryOptions())
  return {
    user: q.data ?? null,
    isTeacher: q.data?.role === 'teacher',
    isLoading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  }
}
