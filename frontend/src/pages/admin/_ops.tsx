import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/api/client'
import { useHostelName, useHostels, useScope, useSingleHostelId } from '@/api/common'
import type { ComplaintCategory, Hosteler, ID, Meal, Paginated, Priority } from '@/api/types'
import { Avatar, Button, SearchInput, Select, Spinner } from '@/components/ui'
import { cn } from '@/lib/utils'

/* Shared helpers for the operations pages (mess, attendance, complaints, visitors, notices, staff). */

export const MEALS: Meal[] = ['breakfast', 'lunch', 'snacks', 'dinner']
export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'Snacks',
  dinner: 'Dinner',
}
export const MEAL_TIME: Record<Meal, string> = {
  breakfast: '7:30 – 9:30 AM',
  lunch: '12:30 – 2:30 PM',
  snacks: '5:00 – 6:00 PM',
  dinner: '8:00 – 10:00 PM',
}
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday-first order for weekly grids */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
  'electrical',
  'plumbing',
  'internet',
  'cleaning',
  'furniture',
  'food',
  'security',
  'other',
]
export const PRIORITIES: Priority[] = ['low', 'medium', 'high']

/** Clean phone digits and build a wa.me link (Indian numbers by default). */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  const num = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}

export function waShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** `value`, updated only after it stops changing for `ms` (for search boxes that hit the API). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * For screens that need ONE hostel (mess menu / headcount).
 * When the top-bar scope is a single hostel, that hostel is used.
 * When it's 'all', the page keeps its own selection (defaults to the first hostel).
 */
export function useHostelPicker(): { hostelId: ID | null; setHostelId: (id: ID) => void; needsPicker: boolean; isLoading: boolean } {
  const scope = useScope()
  const fallback = useSingleHostelId()
  const { data: hostels, isLoading } = useHostels()
  const [local, setLocal] = useState<ID | null>(null)
  const localValid = !!local && !!hostels?.some((h) => h.id === local)
  return {
    hostelId: scope === 'all' ? (localValid ? local : fallback) : scope,
    setHostelId: setLocal,
    needsPicker: scope === 'all' && (hostels?.length ?? 0) > 1,
    isLoading,
  }
}

export function HostelSelect({
  value,
  onChange,
  includeAll,
  allLabel = 'All hostels',
  className,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  includeAll?: boolean
  allLabel?: string
  className?: string
  disabled?: boolean
}) {
  const { data: hostels } = useHostels()
  const options = useMemo(
    () => [...(includeAll ? [{ value: 'all', label: allLabel }] : []), ...(hostels ?? []).map((h) => ({ value: h.id, label: h.name }))],
    [hostels, includeAll, allLabel],
  )
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      className={className}
      disabled={disabled}
      placeholder={!includeAll && !value ? 'Select hostel…' : undefined}
    />
  )
}

/** Compact segmented control */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  disabled,
}: {
  value: T | null
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; activeClass?: string; title?: string }[]
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5', disabled && 'opacity-60', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md font-medium transition disabled:cursor-not-allowed',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? (o.activeClass ?? 'bg-white text-slate-900 shadow-sm') : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** "Room 101" or a fallback */
export function roomLabel(roomNumber: string | null | undefined, fallback = 'No room') {
  return roomNumber ? `Room ${roomNumber}` : fallback
}

/* ------------------------------------------------------------------ */
/* Hosteler picker (server search)                                     */
/* ------------------------------------------------------------------ */

/** Row of GET /api/hostelers (decorated with room/bed/hostel names). */
export interface HostelerHit extends Hosteler {
  roomNumber: string | null
  bedLabel: string | null
  hostelName: string | null
  dues: number
}

export function hitLabel(h: Pick<HostelerHit, 'roomNumber' | 'bedLabel'>) {
  if (!h.roomNumber) return 'No room'
  return h.bedLabel ? `Room ${h.roomNumber} · ${h.bedLabel}` : `Room ${h.roomNumber}`
}

/** Active hostelers matching `q` (name, phone, login id, institution). */
export function useHostelerSearch(params: { q: string; hostelId: ID | 'all' | null; messOpted?: boolean; limit?: number }) {
  const q = useDebounced(params.q.trim())
  const query = {
    q,
    hostelId: params.hostelId ?? 'all',
    status: 'active',
    messOpted: params.messOpted === undefined ? undefined : String(params.messOpted),
    limit: params.limit ?? 8,
  }
  return useQuery({
    queryKey: ['hostelers', 'search', query],
    queryFn: async () => (await get<Paginated<HostelerHit>>('/hostelers', query)).items,
    placeholderData: (prev) => prev,
  })
}

/**
 * Search-and-pick an active hosteler. Shows the chosen one with a "Change"
 * button; `hostelId` limits the search (null / 'all' = every hostel).
 */
export function HostelerPicker({
  value,
  onChange,
  hostelId,
  messOpted,
  placeholder = 'Search by name, phone or login ID…',
  error,
}: {
  value: HostelerHit | null
  onChange: (h: HostelerHit | null) => void
  hostelId: ID | 'all' | null
  messOpted?: boolean
  placeholder?: string
  error?: string
}) {
  const [search, setSearch] = useState('')
  const hostelName = useHostelName()
  const showHostel = !hostelId || hostelId === 'all'
  const { data, isLoading, isFetching, error: loadError } = useHostelerSearch({ q: search, hostelId, messOpted })

  if (value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={value.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{value.name}</p>
            <p className="truncate text-xs text-slate-500">
              {hitLabel(value)}
              {showHostel ? ` · ${value.hostelName ?? hostelName(value.hostelId)}` : ''}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    )

  return (
    <div>
      <SearchInput value={search} onChange={setSearch} placeholder={placeholder} />
      <ul
        className={cn(
          'mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border',
          error ? 'border-red-300' : 'border-slate-200',
        )}
      >
        {isLoading ? (
          <li className="flex justify-center px-3 py-4">
            <Spinner className="h-5 w-5" />
          </li>
        ) : loadError ? (
          <li className="px-3 py-4 text-center text-sm text-red-600">Couldn't search hostelers</li>
        ) : !data?.length ? (
          <li className="px-3 py-4 text-center text-sm text-slate-400">No active hostelers found</li>
        ) : (
          data.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onChange(h)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50', isFetching && 'opacity-70')}
              >
                <Avatar name={h.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {hitLabel(h)}
                    {showHostel ? ` · ${h.hostelName ?? hostelName(h.hostelId)}` : ''}
                    {h.loginId ? ` · ${h.loginId}` : ''}
                  </p>
                </div>
              </button>
            </li>
          ))
        )}
      </ul>
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  )
}

/** Previous / next pager for paginated lists. */
export function Pager({ page, pages, onPage, busy }: { page: number; pages: number; onPage: (p: number) => void; busy?: boolean }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

/** Human-friendly duration from milliseconds */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  return `${formatDuration(ms)} ago`
}

/** Re-render every `intervalMs` (for live durations). */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
