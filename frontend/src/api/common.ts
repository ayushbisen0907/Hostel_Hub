/**
 * Data used across many screens: organization, hostels, and the hostel
 * picked in the top bar.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { get } from './client'
import { useStaffSession } from './session'
import type { Hostel, ID, ListResponse, OrgDetails, Settings } from './types'

/* ---------------- organization ---------------- */

export const orgKey = ['org'] as const

export function useOrg() {
  const staff = useStaffSession()
  return useQuery({ queryKey: orgKey, queryFn: () => get<OrgDetails>('/org'), enabled: !!staff })
}

/** Org settings with safe defaults while loading. */
export function useSettings(): Settings {
  const { data } = useOrg()
  return (
    data?.settings ?? {
      rentDueDay: 5,
      lateFeePerDay: 0,
      receiptPrefix: 'RCPT',
      defaultSecurityDeposit: 0,
      messMonthlyCharge: 0,
      nightCurfew: '22:00',
      currencySymbol: '₹',
    }
  )
}

/* ---------------- hostels ---------------- */

export const hostelsKey = ['hostels'] as const

export function useHostels() {
  const staff = useStaffSession()
  return useQuery({
    queryKey: hostelsKey,
    queryFn: async () => (await get<ListResponse<Hostel>>('/hostels')).items,
    enabled: !!staff,
  })
}

/** id -> hostel name lookup */
export function useHostelName() {
  const { data } = useHostels()
  return useMemo(() => {
    const m = new Map((data ?? []).map((h) => [h.id, h.name]))
    return (id: ID | null | undefined) => (id ? (m.get(id) ?? '—') : 'All hostels')
  }, [data])
}

/* ---------------- top-bar hostel switcher ---------------- */

interface ScopeState {
  hostelId: ID | 'all'
  setHostelId: (id: ID | 'all') => void
}

export const useScopeStore = create<ScopeState>()(
  persist((set) => ({ hostelId: 'all', setHostelId: (hostelId) => set({ hostelId }) }), { name: 'hostelhub-scope' }),
)

/**
 * Hostel chosen in the top bar ('all' or an id). Falls back to 'all' if the
 * stored hostel no longer exists. Pass it as `hostelId` to list endpoints.
 */
export function useScope(): ID | 'all' {
  const hostelId = useScopeStore((s) => s.hostelId)
  const { data } = useHostels()
  if (hostelId !== 'all' && data && !data.some((h) => h.id === hostelId)) return 'all'
  return hostelId
}

/** For screens that need ONE hostel (e.g. mess menu): the scoped hostel, else the first one. */
export function useSingleHostelId(): ID | null {
  const scope = useScope()
  const { data } = useHostels()
  if (scope !== 'all') return scope
  return data?.[0]?.id ?? null
}
