import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '@/store'
import { useScope } from '@/store/selectors'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ComplaintCategory, ID, Meal, Priority, StaffRole } from '@/types'

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
export const STAFF_ROLES: StaffRole[] = ['manager', 'warden', 'accountant', 'cook', 'security', 'cleaner']

/** Clean phone digits and build a wa.me link (Indian numbers by default). */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  const num = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}

export function waShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/**
 * When the top-bar scope is a single hostel, that hostel is used.
 * When it's 'all', the page keeps its own selection (defaults to the first hostel).
 */
export function useHostelPicker(): { hostelId: ID; setHostelId: (id: ID) => void; needsPicker: boolean } {
  const scope = useScope()
  const hostels = useStore((s) => s.hostels)
  const [local, setLocal] = useState<ID>(hostels[0]?.id ?? '')
  useEffect(() => {
    if (!hostels.some((h) => h.id === local)) setLocal(hostels[0]?.id ?? '')
  }, [hostels, local])
  return {
    hostelId: scope === 'all' ? local : scope,
    setHostelId: setLocal,
    needsPicker: scope === 'all' && hostels.length > 1,
  }
}

export function HostelSelect({
  value,
  onChange,
  includeAll,
  allLabel = 'All hostels',
  className,
}: {
  value: string
  onChange: (id: string) => void
  includeAll?: boolean
  allLabel?: string
  className?: string
}) {
  const hostels = useStore((s) => s.hostels)
  const options = useMemo(
    () => [...(includeAll ? [{ value: 'all', label: allLabel }] : []), ...hostels.map((h) => ({ value: h.id, label: h.name }))],
    [hostels, includeAll, allLabel],
  )
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={options} className={className} />
}

/** Compact segmented control */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T | null
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; activeClass?: string; title?: string }[]
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md font-medium transition',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? o.activeClass ?? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Room label like "Room 101 · B" from room/bed maps */
export function useBedLabeler() {
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  return useMemo(() => {
    const roomMap = new Map(rooms.map((r) => [r.id, r]))
    const bedMap = new Map(beds.map((b) => [b.id, b]))
    return {
      room: (roomId: ID | null) => (roomId ? roomMap.get(roomId)?.number ?? '' : ''),
      label: (roomId: ID | null, bedId: ID | null) => {
        const r = roomId ? roomMap.get(roomId) : undefined
        const b = bedId ? bedMap.get(bedId) : undefined
        if (!r) return 'No room'
        return b ? `Room ${r.number} · ${b.label}` : `Room ${r.number}`
      },
    }
  }, [rooms, beds])
}

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
