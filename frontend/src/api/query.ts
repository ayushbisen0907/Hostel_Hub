/**
 * React Query setup.
 *
 * Conventions used across the app:
 *  - Query keys start with the resource name, e.g. ['hostelers', params], ['invoices', params].
 *    After a mutation, invalidate by prefix: queryClient.invalidateQueries({ queryKey: ['hostelers'] }).
 *  - Mutations show their own success toast; errors go through `toastError`.
 */
import { QueryClient, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ApiError, errorMessage } from './client'
import { toast } from '@/components/ui'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // don't retry client errors (400/401/403/404…), retry server/network errors twice
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
})

export function toastError(e: unknown, fallback?: string) {
  toast.error(errorMessage(e, fallback))
}

/**
 * useMutation with the usual wiring: invalidates the given query prefixes on
 * success, shows `success` as a toast, and toasts errors.
 *
 *   const save = useApiMutation(api.createRoom, { invalidate: [['rooms'], ['hostels']], success: 'Room added' })
 *   save.mutate(body)
 */
export function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  opts: {
    invalidate?: QueryKey[]
    success?: string | ((data: TData, vars: TVars) => string)
    onSuccess?: (data: TData, vars: TVars) => void
    /** set false to handle errors yourself */
    toastErrors?: boolean
  } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      await Promise.all((opts.invalidate ?? []).map((queryKey) => qc.invalidateQueries({ queryKey })))
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(data, vars) : opts.success)
      opts.onSuccess?.(data, vars)
    },
    onError: (e) => {
      if (opts.toastErrors !== false) toastError(e)
    },
  })
}
