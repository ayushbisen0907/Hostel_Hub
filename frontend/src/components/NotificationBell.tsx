import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, CircleAlert, CircleCheck, IndianRupee, ReceiptText } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { useNotificationActions, useNotifications, type AppNotification } from '@/api/notifications'
import { toastError } from '@/api/query'
import { toast } from '@/components/ui'
import { cn } from '@/lib/utils'

const ICONS: Record<AppNotification['type'], { icon: typeof Bell; tone: string }> = {
  payment_submitted: { icon: IndianRupee, tone: 'bg-amber-50 text-amber-600' },
  payment_verified: { icon: CircleCheck, tone: 'bg-emerald-50 text-emerald-600' },
  payment_rejected: { icon: CircleAlert, tone: 'bg-red-50 text-red-600' },
  bill_generated: { icon: ReceiptText, tone: 'bg-brand-50 text-brand-600' },
  general: { icon: Bell, tone: 'bg-slate-100 text-slate-600' },
}

/**
 * Bell with unread badge + dropdown list. Works for staff and hostelers
 * (the API path is picked from the session). New unread notifications that
 * arrive while the app is open also pop up as a toast.
 */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useNotifications()
  const { markRead, markAllRead } = useNotificationActions()
  const navigate = useNavigate()
  const unread = data?.unreadCount ?? 0
  const items = data?.items ?? []

  // toast newly-arrived notifications (not the ones present on first load)
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    if (seen.current === null) {
      seen.current = new Set(data.items.map((n) => n.id))
      return
    }
    for (const n of data.items) {
      if (!seen.current.has(n.id) && !n.readAt) toast.info(n.title)
      seen.current.add(n.id)
    }
  }, [data])

  const openItem = async (n: AppNotification) => {
    setOpen(false)
    try {
      if (!n.readAt) await markRead(n.id)
    } catch (e) {
      toastError(e)
    }
    if (n.link) navigate(n.link)
  }

  return (
    <div className={cn('relative', className)}>
      <button
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-2 top-16 z-40 max-h-[75vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="font-semibold text-slate-900">Notifications</p>
              {unread > 0 && (
                <button
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  onClick={() => markAllRead().catch(toastError)}
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[calc(75vh-49px)] overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-500">You're all caught up.</p>
              ) : (
                items.map((n) => {
                  const { icon: Icon, tone } = ICONS[n.type] ?? ICONS.general
                  return (
                    <button
                      key={n.id}
                      onClick={() => void openItem(n)}
                      className={cn('flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/40')}
                    >
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className={cn('flex-1 text-sm', n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                          {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                        </span>
                        {n.body && <span className="mt-0.5 block text-xs leading-snug text-slate-500">{n.body}</span>}
                        <span className="mt-1 block text-[11px] text-slate-400">{formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
