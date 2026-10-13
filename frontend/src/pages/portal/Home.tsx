import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquareWarning,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { usePaymentInfo, usePortalHome, type AttendanceStatus } from '@/api/portal'
import { Badge, Button, Card, EmptyState, LoadingState, ErrorState, StatusBadge } from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import { MEAL_ICON, MEAL_LABEL, MEAL_TIME, MEAL_TONE, NoticeCard, SectionTitle, WEEKDAYS, useMoney } from './_shared'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const ATT_DOT: Record<AttendanceStatus | 'none', string> = {
  present: 'bg-emerald-500 text-white',
  late: 'bg-amber-400 text-white',
  leave: 'bg-violet-400 text-white',
  absent: 'bg-red-500 text-white',
  none: 'bg-slate-100 text-slate-400',
}

export default function Home() {
  const home = usePortalHome()
  const payInfo = usePaymentInfo()
  const money = useMoney()

  if (home.isLoading) return <LoadingState />
  if (!home.data) return <ErrorState error={home.error} onRetry={() => void home.refetch()} />

  const h = home.data
  const me = h.hosteler
  const firstName = me.name.split(' ')[0]
  const todayKey = h.today
  const weekday = parseISO(todayKey).getDay()
  const dues = h.dues.total
  const overdue = h.dues.overdue
  const pendingVerification = payInfo.data?.pendingVerification ?? 0
  const notices = h.notices
  const last7 =
    h.last7DaysAttendance?.map((a) => {
      const d = parseISO(a.date)
      return { key: a.date, label: format(d, 'EEEEE'), day: format(d, 'd'), status: (a.status ?? 'none') as AttendanceStatus | 'none' }
    }) ?? null

  const actions = [
    { to: '/portal/fees', label: 'Pay rent', icon: Wallet, tone: 'bg-brand-50 text-brand-600', show: true },
    { to: '/portal/mess', label: 'Skip a meal', icon: UtensilsCrossed, tone: 'bg-amber-50 text-amber-600', show: h.features.mess && me.messOpted },
    { to: '/portal/complaints', label: 'Raise complaint', icon: MessageSquareWarning, tone: 'bg-red-50 text-red-600', show: true },
    { to: '/portal/leave', label: 'Apply leave', icon: CalendarDays, tone: 'bg-violet-50 text-violet-600', show: h.features.attendance },
    { to: '/portal/leave#notices', label: 'Notices', icon: BellRing, tone: 'bg-emerald-50 text-emerald-600', show: true },
    { to: '/portal/profile#documents', label: 'My documents', icon: FileText, tone: 'bg-cyan-50 text-cyan-600', show: true },
  ].filter((a) => a.show)

  return (
    <div className="pb-4">
      {/* Greeting */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-md">
        <p className="text-sm text-white/80">{greeting()},</p>
        <h1 className="mt-0.5 text-2xl font-bold">{firstName}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white/15 px-3 py-1">{h.bed ?? 'No bed assigned'}</span>
          <span className="rounded-full bg-white/15 px-3 py-1">{h.hostel?.name ?? '—'}</span>
          {me.status === 'reserved' && <span className="rounded-full bg-amber-400/90 px-3 py-1 text-amber-950">Reserved</span>}
        </div>
      </div>

      {/* Dues */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Total due</p>
            <p className={cn('mt-1 text-3xl font-bold', dues > 0 ? 'text-slate-900' : 'text-emerald-600')}>{money(dues)}</p>
            {dues > 0 && h.dues.nextDueDate ? (
              <p className={cn('mt-1 text-sm', overdue ? 'font-medium text-red-600' : 'text-slate-500')}>
                {overdue ? 'Overdue since ' : 'Next due on '}
                {formatDate(h.dues.nextDueDate)}
                {h.dues.pendingInvoices > 1 && ` · ${h.dues.pendingInvoices} bills`}
              </p>
            ) : (
              <p className="mt-1 flex items-center gap-1 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> You're all paid up
              </p>
            )}
            {pendingVerification > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
                <Clock className="h-4 w-4" /> {money(pendingVerification)} waiting for verification
              </p>
            )}
          </div>
          {dues > 0 && (
            <Link to="/portal/fees" className="w-full sm:w-auto">
              <Button size="lg" className="w-full rounded-xl" icon={<Wallet className="h-5 w-5" />}>
                Pay rent
              </Button>
            </Link>
          )}
        </div>
      </Card>

      {/* Quick actions */}
      <SectionTitle>Quick actions</SectionTitle>
      <div className={cn('grid grid-cols-3 gap-3', actions.length === 6 ? 'sm:grid-cols-6' : actions.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        {actions.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-4 text-center shadow-sm transition hover:border-brand-300 active:scale-95"
          >
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', a.tone)}>
              <a.icon className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium leading-tight text-slate-700">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Today's menu (Pro plan) */}
      {h.todayMenu && (
        <>
          <SectionTitle
            action={
              <Link to="/portal/mess" className="flex items-center gap-1 text-sm font-medium text-brand-600">
                Full menu <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            Today's menu · {WEEKDAYS[weekday]}
          </SectionTitle>
          {!me.messOpted && (
            <p className="mb-2 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-700">You're not enrolled in the mess.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {h.todayMenu.map(({ meal, items, skipped }) => {
              const Icon = MEAL_ICON[meal]
              return (
                <Card key={meal} className={cn('flex items-start gap-3 p-4', skipped && 'bg-slate-50 opacity-75')}>
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', MEAL_TONE[meal])}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <p className="font-medium text-slate-900">{MEAL_LABEL[meal]}</p>
                      <span className="text-xs text-slate-400">{MEAL_TIME[meal]}</span>
                      {skipped && <Badge tone="amber" className="ml-auto">Skipped</Badge>}
                    </div>
                    <p className={cn('mt-0.5 text-sm text-slate-600', skipped && 'line-through')}>{items || 'Menu not set'}</p>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Notices */}
      <SectionTitle
        action={
          notices.length > 0 && (
            <Link to="/portal/leave#notices" className="flex items-center gap-1 text-sm font-medium text-brand-600">
              All notices <ArrowRight className="h-4 w-4" />
            </Link>
          )
        }
      >
        Notices
      </SectionTitle>
      {notices.length === 0 ? (
        <Card>
          <EmptyState icon={<BellRing className="h-5 w-5" />} title="No notices" description="Announcements from the warden will appear here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </div>
      )}

      {/* Complaints & attendance */}
      <div className={cn('grid grid-cols-1 gap-x-4', last7 && 'md:grid-cols-2')}>
        <div>
          <SectionTitle
            action={
              <Link to="/portal/complaints" className="flex items-center gap-1 text-sm font-medium text-brand-600">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            My open complaints
          </SectionTitle>
          <Card>
            {h.openComplaints.length === 0 ? (
              <div className="flex items-center gap-3 p-4 text-sm text-slate-500">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" /> No open complaints. Everything's working!
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {h.openComplaints.slice(0, 4).map((c) => (
                  <li key={c.id}>
                    <Link to="/portal/complaints" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-800">{c.title}</p>
                        <p className="text-xs text-slate-500">Raised {formatDate(c.createdAt)}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {last7 && (
        <div>
          <SectionTitle>My attendance · last 7 days</SectionTitle>
          <Card className="p-4">
            <div className="flex justify-between gap-1">
              {last7.map((d) => (
                <div
                  key={d.key}
                  className="flex flex-col items-center gap-1.5"
                  title={`${formatDate(d.key)}: ${d.status === 'none' ? 'Not marked' : d.status}`}
                >
                  <span className="text-[11px] font-medium text-slate-400">{d.label}</span>
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold',
                      ATT_DOT[d.status],
                      d.key === todayKey && 'ring-2 ring-brand-300 ring-offset-1',
                    )}
                  >
                    {d.day}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {(['present', 'late', 'leave', 'absent'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5 capitalize">
                  <span className={cn('h-2.5 w-2.5 rounded-full', ATT_DOT[s].split(' ')[0])} /> {s}
                </span>
              ))}
            </div>
          </Card>
        </div>
        )}
      </div>
    </div>
  )
}
