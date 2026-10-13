import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, Coffee, Cookie, Moon, Pin, Soup, UserX } from 'lucide-react'
import { useStore } from '@/store'
import type { Hosteler, Meal, Notice } from '@/types'
import { Badge, Card } from '@/components/ui'
import { cn, formatDate, formatMoney } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Meals                                                               */
/* ------------------------------------------------------------------ */

export const MEALS: Meal[] = ['breakfast', 'lunch', 'snacks', 'dinner']

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snacks: 'Snacks',
  dinner: 'Dinner',
}

/** Typical serving time shown to residents */
export const MEAL_TIME: Record<Meal, string> = {
  breakfast: '7:30 – 9:30 AM',
  lunch: '12:30 – 2:30 PM',
  snacks: '5:00 – 6:00 PM',
  dinner: '8:00 – 10:00 PM',
}

/** Last time (HH:mm, same day) a meal can be skipped / un-skipped */
export const MEAL_CUTOFF: Record<Meal, string> = {
  breakfast: '07:00',
  lunch: '10:00',
  snacks: '15:00',
  dinner: '17:00',
}

export const MEAL_ICON: Record<Meal, typeof Coffee> = {
  breakfast: Coffee,
  lunch: Soup,
  snacks: Cookie,
  dinner: Moon,
}

export const MEAL_TONE: Record<Meal, string> = {
  breakfast: 'bg-amber-50 text-amber-600',
  lunch: 'bg-emerald-50 text-emerald-600',
  snacks: 'bg-rose-50 text-rose-600',
  dinner: 'bg-violet-50 text-violet-600',
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatCutoff(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${suffix}`
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useMoney() {
  const symbol = useStore((s) => s.settings.currencySymbol)
  return (n: number) => formatMoney(n, symbol)
}

/** Notices visible to a hosteler: their hostel + global ones, pinned first then newest. */
export function useMyNotices(hosteler: Hosteler | null): Notice[] {
  const notices = useStore((s) => s.notices)
  return useMemo(() => {
    if (!hosteler) return []
    return notices
      .filter((n) => n.hostelId === null || n.hostelId === hosteler.hostelId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
  }, [notices, hosteler])
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

export function NotLoggedIn() {
  return (
    <Card className="mx-auto mt-10 max-w-sm p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <UserX className="h-6 w-6" />
      </div>
      <p className="font-semibold text-slate-800">Profile not found</p>
      <p className="mt-1 text-sm text-slate-500">Please log in again to the hosteler portal.</p>
    </Card>
  )
}

export function PortalTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-3 mt-7 flex scroll-mt-20 items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  )
}

export function NoticeCard({ notice, defaultOpen = false }: { notice: Notice; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const long = notice.body.length > 120
  return (
    <Card className={cn('overflow-hidden', notice.pinned && 'border-brand-200')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
      >
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            notice.priority === 'high' ? 'bg-red-50 text-red-600' : notice.pinned ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500',
          )}
        >
          <Pin className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium text-slate-900">{notice.title}</p>
            {notice.pinned && <Badge tone="blue">Pinned</Badge>}
            {notice.priority === 'high' && <Badge tone="red">Important</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{formatDate(notice.createdAt)}</p>
          <p className={cn('mt-1.5 whitespace-pre-line text-sm text-slate-600', !open && 'line-clamp-2')}>{notice.body}</p>
        </div>
        {long && (
          <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
        )}
      </button>
    </Card>
  )
}

/** Scrolls to the element matching location.hash after render (react-router doesn't do this). */
export function useScrollToHash() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const t = setTimeout(() => {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => clearTimeout(t)
  }, [hash])
}

export function openInNewTab(path: string) {
  window.open(path, '_blank', 'noopener')
}
