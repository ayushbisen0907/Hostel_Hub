/**
 * Mess (Pro plan): weekly menu, today's headcount, members, opt-outs, feedback.
 * Backend: backend/src/modules/mess/routes.ts
 */
import { useQuery } from '@tanstack/react-query'
import { ApiError, del, get, patch, post, put } from './client'
import { useApiMutation } from './query'
import type { ID, Meal, Paginated } from './types'

/* ---------------- types ---------------- */

export interface MenuEntry {
  id: ID
  hostelId: ID
  /** 0 = Sunday */
  day: number
  meal: Meal
  items: string
}

export interface MessTodayMeal {
  meal: Meal
  items: string
  members: number
  optedOut: { id: ID; hostelerId: ID; name: string; roomNumber: string | null }[]
  /** members on approved leave who did not also opt out */
  onLeave: number
  headcount: number
}

export interface MessToday {
  date: string
  day: number
  hostelId: ID
  members: number
  meals: MessTodayMeal[]
}

export interface MessMember {
  id: ID
  name: string
  loginId: string
  phone: string
  hostelId: ID
  roomId: ID | null
  roomNumber: string | null
  messOpted: boolean
}

export interface MessMembersResponse {
  items: MessMember[]
  /** active hostelers with mess on */
  members: number
  /** all active hostelers */
  active: number
}

export interface MealOptOut {
  id: ID
  hostelId: ID
  hostelerId: ID
  date: string
  meal: Meal
  hostelerName: string
  roomNumber: string | null
  createdAt: string
}

export interface MessFeedback {
  id: ID
  hostelId: ID
  hostelerId: ID
  date: string
  meal: Meal
  rating: number
  comment: string
  hostelerName: string
  roomNumber: string | null
  createdAt: string
}

export interface RatingSummary {
  average: number | null
  count: number
}

export interface MessFeedbackResponse extends Paginated<MessFeedback> {
  averages: Record<Meal, RatingSummary>
  overall: RatingSummary
  /** star (1-5) -> number of reviews */
  distribution: Record<string, number>
}

export interface MessStats {
  month: string
  members: number
  optOuts: number
  perMealCost: number
  estimatedSavings: number
}

type Scope = ID | 'all'

/* ---------------- queries ---------------- */

export function useMessMenu(hostelId: ID | null) {
  return useQuery({
    queryKey: ['mess', 'menu', hostelId],
    queryFn: async () => (await get<{ items: MenuEntry[] }>('/mess/menu', { hostelId })).items,
    enabled: !!hostelId,
  })
}

export function useMessToday(hostelId: ID | null, date: string) {
  return useQuery({
    queryKey: ['mess', 'today', { hostelId, date }],
    queryFn: () => get<MessToday>('/mess/today', { hostelId, date }),
    enabled: !!hostelId,
  })
}

export function useMessMembers(hostelId: Scope) {
  return useQuery({
    queryKey: ['mess', 'members', { hostelId }],
    queryFn: () => get<MessMembersResponse>('/mess/members', { hostelId }),
  })
}

export function useMessOptOuts(params: { hostelId: Scope; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['mess', 'opt-outs', params],
    queryFn: async () => (await get<{ items: MealOptOut[] }>('/mess/opt-outs', params)).items,
  })
}

export function useMessFeedback(params: { hostelId: Scope; meal?: Meal; rating?: 'high' | 'low'; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['mess', 'feedback', params],
    queryFn: () => get<MessFeedbackResponse>('/mess/feedback', params),
    placeholderData: (prev) => prev,
  })
}

export function useMessStats(params: { hostelId: Scope; month?: string }) {
  return useQuery({
    queryKey: ['mess', 'stats', params],
    queryFn: () => get<MessStats>('/mess/stats', params),
  })
}

/* ---------------- mutations ---------------- */

export function useSaveMenuEntry() {
  return useApiMutation(
    (body: { hostelId: ID; day: number; meal: Meal; items: string }) => put<MenuEntry>('/mess/menu', body),
    { invalidate: [['mess', 'menu'], ['mess', 'today']] },
  )
}

export function useCopyMenu() {
  return useApiMutation(
    (body: { fromHostelId: ID; toHostelId: ID }) => post<{ copied: number }>('/mess/menu/copy', body),
    {
      invalidate: [['mess', 'menu'], ['mess', 'today']],
      success: (r) => (r.copied ? `Menu copied (${r.copied} entries)` : 'Menu cleared – the other hostel has no menu'),
    },
  )
}

export function useSetMessMember() {
  return useApiMutation(
    ({ hostelerId, messOpted }: { hostelerId: ID; messOpted: boolean; name?: string }) =>
      patch<{ id: ID; name: string; messOpted: boolean }>(`/mess/members/${hostelerId}`, { messOpted }),
    {
      invalidate: [['mess'], ['hostelers']],
      success: (r) => `Mess ${r.messOpted ? 'enabled' : 'disabled'} for ${r.name}`,
    },
  )
}

/** Opts a hosteler out of several meals on one date; meals already opted out are skipped. */
export function useAddOptOuts() {
  return useApiMutation(
    async ({ hostelerId, date, meals }: { hostelerId: ID; date: string; meals: Meal[] }) => {
      let added = 0
      for (const meal of meals) {
        try {
          await post('/mess/opt-outs', { hostelerId, date, meal })
          added++
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e
        }
      }
      return { added, skipped: meals.length - added }
    },
    {
      invalidate: [['mess']],
      success: (r) =>
        r.added ? `${r.added} meal${r.added > 1 ? 's' : ''} opted out` : 'Already opted out for the selected meals',
    },
  )
}

export function useRemoveOptOut() {
  return useApiMutation((id: ID) => del(`/mess/opt-outs/${id}`), { invalidate: [['mess']], success: 'Opt-out removed' })
}
