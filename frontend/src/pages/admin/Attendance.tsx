import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, endOfMonth, format, getDaysInMonth, parseISO } from 'date-fns'
import {
  CalendarCheck,
  CalendarDays,
  CheckCheck,
  Download,
  LogOut,
  MapPin,
  MessageCircle,
  Plane,
  Plus,
  UserCheck,
  UserX,
  Clock,
  Check,
  X,
} from 'lucide-react'
import { useStore } from '@/store'
import { inScope, useHostelName, useHostelerMap, useScope, useScopedHostelers } from '@/store/selectors'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  toast,
} from '@/components/ui'
import { cn, currentMonth, daysBetween, downloadCsv, formatDate, formatMonth, today } from '@/lib/utils'
import type { AttendanceStatus, Hosteler, ID, LeaveStatus } from '@/types'
import { Segmented, useBedLabeler, waLink } from './_ops'

type PageTab = 'attendance' | 'leaves'

export default function Attendance() {
  const [params, setParams] = useSearchParams()
  const tab: PageTab = params.get('tab') === 'leaves' ? 'leaves' : 'attendance'
  const leaves = useStore((s) => s.leaves)
  const scope = useScope()
  const pending = leaves.filter((l) => l.status === 'pending' && inScope(l.hostelId, scope)).length

  return (
    <div>
      <PageHeader title="Attendance & leave" subtitle="Daily roll call, monthly register and leave approvals" />
      <Tabs<PageTab>
        className="mb-6"
        value={tab}
        onChange={(v) => setParams(v === 'attendance' ? {} : { tab: v }, { replace: true })}
        tabs={[
          { value: 'attendance', label: 'Attendance' },
          { value: 'leaves', label: 'Leaves', count: pending },
        ]}
      />
      {tab === 'attendance' ? <AttendanceTab /> : <LeavesTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

const STATUS_OPTS: { value: AttendanceStatus; label: string; short: string; activeClass: string }[] = [
  { value: 'present', label: 'Present', short: 'P', activeClass: 'bg-emerald-600 text-white shadow-sm' },
  { value: 'absent', label: 'Absent', short: 'A', activeClass: 'bg-red-600 text-white shadow-sm' },
  { value: 'late', label: 'Late', short: 'L', activeClass: 'bg-amber-500 text-white shadow-sm' },
  { value: 'leave', label: 'Leave', short: 'LV', activeClass: 'bg-violet-600 text-white shadow-sm' },
]

const CELL_CLASS: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-700',
  absent: 'bg-red-100 text-red-700',
  late: 'bg-amber-100 text-amber-700',
  leave: 'bg-violet-100 text-violet-700',
}
const CELL_SHORT: Record<AttendanceStatus, string> = { present: 'P', absent: 'A', late: 'L', leave: 'LV' }

function AttendanceTab() {
  const [view, setView] = useState<'daily' | 'register'>('daily')
  return (
    <div className="space-y-4">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'daily', label: 'Daily roll call' },
          { value: 'register', label: 'Monthly register' },
        ]}
      />
      {view === 'daily' ? <DailyView /> : <RegisterView />}
    </div>
  )
}

function DailyView() {
  const scope = useScope()
  const scoped = useScopedHostelers()
  const attendance = useStore((s) => s.attendance)
  const leaves = useStore((s) => s.leaves)
  const markAttendance = useStore((s) => s.markAttendance)
  const markAllPresent = useStore((s) => s.markAllPresent)
  const curfew = useStore((s) => s.settings.nightCurfew)
  const orgName = useStore((s) => s.org?.name ?? 'Hostel')
  const hostelName = useHostelName()
  const beds = useBedLabeler()
  const [date, setDate] = useState(today())
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus | 'unmarked'>('all')
  const [notifyOpen, setNotifyOpen] = useState(false)

  const active = useMemo(() => scoped.filter((h) => h.status === 'active'), [scoped])
  const dayMap = useMemo(() => {
    const m = new Map<ID, AttendanceStatus>()
    attendance.filter((a) => a.date === date).forEach((a) => m.set(a.hostelerId, a.status))
    return m
  }, [attendance, date])
  const onLeave = useMemo(
    () => new Set(leaves.filter((l) => l.status === 'approved' && l.from <= date && l.to >= date).map((l) => l.hostelerId)),
    [leaves, date],
  )

  const counts = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 }
  active.forEach((h) => {
    const s = dayMap.get(h.id)
    if (s) counts[s]++
    else counts.unmarked++
  })

  const filtered = active
    .filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase()) || beds.room(h.roomId).includes(q))
    .filter((h) => {
      if (statusFilter === 'all') return true
      const s = dayMap.get(h.id)
      return statusFilter === 'unmarked' ? !s : s === statusFilter
    })

  const groups = useMemo(() => {
    const m = new Map<string, Hosteler[]>()
    filtered.forEach((h) => {
      const key = h.roomId ? `${h.hostelId}|${beds.room(h.roomId)}` : `${h.hostelId}|`
      m.set(key, [...(m.get(key) ?? []), h])
    })
    return [...m.entries()]
      .map(([key, list]) => {
        const [hid, room] = key.split('|') as [string, string]
        return { key, hostelId: hid, room, list: list.sort((a, b) => a.name.localeCompare(b.name)) }
      })
      .sort(
        (a, b) =>
          hostelName(a.hostelId).localeCompare(hostelName(b.hostelId)) ||
          (a.room ? (b.room ? a.room.localeCompare(b.room, undefined, { numeric: true }) : -1) : 1),
      )
  }, [filtered, beds, hostelName])

  const absentees = active.filter((h) => dayMap.get(h.id) === 'absent')

  const doMarkAll = () => {
    const n = markAllPresent(scope, date)
    if (n) toast.success(`${n} hostelers marked (approved leaves set to Leave)`)
    else toast.info('Everyone already has attendance for this day')
  }

  const markGroup = (list: Hosteler[], status: AttendanceStatus) => {
    list.forEach((h) => markAttendance(h.id, date, status))
    toast.success(`${list.length} marked ${status}`)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Present" value={counts.present} icon={<UserCheck className="h-5 w-5" />} tone="green" onClick={() => setStatusFilter('present')} />
        <StatCard label="Absent" value={counts.absent} icon={<UserX className="h-5 w-5" />} tone="red" onClick={() => setStatusFilter('absent')} />
        <StatCard label="Late" value={counts.late} icon={<Clock className="h-5 w-5" />} tone="amber" onClick={() => setStatusFilter('late')} />
        <StatCard label="On leave" value={counts.leave} icon={<Plane className="h-5 w-5" />} tone="violet" onClick={() => setStatusFilter('leave')} />
        <StatCard label="Not marked" value={counts.unmarked} icon={<CalendarDays className="h-5 w-5" />} tone="slate" onClick={() => setStatusFilter('unmarked')} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <Input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              if (v > today()) {
                toast.error("Can't mark attendance for a future date")
                return
              }
              setDate(v)
            }}
            className="lg:w-44"
          />
          <SearchInput value={q} onChange={setQ} placeholder="Search name or room…" className="lg:w-64" />
          <Select
            className="lg:w-40"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'unmarked', label: 'Not marked' },
              ...STATUS_OPTS.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <Button variant="outline" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setNotifyOpen(true)} disabled={!absentees.length}>
              Notify guardians ({absentees.length})
            </Button>
            <Button icon={<CheckCheck className="h-4 w-4" />} onClick={doMarkAll} disabled={!counts.unmarked}>
              Mark all present
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">
          <span>
            {formatDate(date, 'EEEE, dd MMM yyyy')} · Night curfew {curfew}
          </span>
          {date !== today() && (
            <button className="font-medium text-brand-600 hover:underline" onClick={() => setDate(today())}>
              Jump to today
            </button>
          )}
          <button
            className="font-medium text-brand-600 hover:underline"
            onClick={() => setDate(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))}
          >
            Previous day
          </button>
        </div>

        {active.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="No active hostelers" description="Check in hostelers to start taking attendance." />
        ) : groups.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="Nothing matches your filters" />
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {g.room ? `Room ${g.room}` : 'No room'}
                    {scope === 'all' && <span className="ml-2 font-normal normal-case text-slate-400">{hostelName(g.hostelId)}</span>}
                  </p>
                  <button className="text-xs font-medium text-emerald-700 hover:underline" onClick={() => markGroup(g.list, 'present')}>
                    Room present
                  </button>
                </div>
                <ul className="divide-y divide-slate-50">
                  {g.list.map((h) => {
                    const s = dayMap.get(h.id) ?? null
                    return (
                      <li key={h.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={h.name} src={h.photo} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{h.name}</p>
                            <p className="text-xs text-slate-500">
                              {beds.label(h.roomId, h.bedId)}
                              {onLeave.has(h.id) && <span className="ml-2 font-medium text-violet-600">· approved leave</span>}
                            </p>
                          </div>
                        </div>
                        <Segmented<AttendanceStatus>
                          value={s}
                          size="sm"
                          onChange={(v) => markAttendance(h.id, date, v)}
                          options={STATUS_OPTS.map((o) => ({ value: o.value, label: o.label, activeClass: o.activeClass }))}
                        />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        title="Notify guardians of absentees"
        description={`${absentees.length} absent on ${formatDate(date)}. Each link opens WhatsApp with a prefilled message.`}
        footer={
          <Button variant="outline" onClick={() => setNotifyOpen(false)}>
            Done
          </Button>
        }
      >
        {absentees.length === 0 ? (
          <p className="text-sm text-slate-500">No absentees.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {absentees.map((h) => {
              const msg = `Dear ${h.guardianName || 'Guardian'}, this is to inform you that ${h.name} was marked absent at ${hostelName(h.hostelId) !== '—' ? hostelName(h.hostelId) : orgName} on ${formatDate(date)} (night roll call, curfew ${curfew}). Please get in touch with the warden. – ${orgName}`
              return (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{h.name}</p>
                    <p className="text-xs text-slate-500">
                      {h.guardianName || 'Guardian'}
                      {h.guardianRelation ? ` (${h.guardianRelation})` : ''} · {h.guardianPhone || 'no phone'}
                    </p>
                  </div>
                  {h.guardianPhone ? (
                    <a
                      href={waLink(h.guardianPhone, msg)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : (
                    <Badge>No number</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </div>
  )
}

function RegisterView() {
  const scope = useScope()
  const scoped = useScopedHostelers({ includeCheckedOut: true })
  const attendance = useStore((s) => s.attendance)
  const beds = useBedLabeler()
  const [month, setMonth] = useState(currentMonth())
  const [q, setQ] = useState('')

  const monthStart = `${month}-01`
  const monthEnd = format(endOfMonth(parseISO(monthStart)), 'yyyy-MM-dd')
  const nDays = getDaysInMonth(parseISO(monthStart))
  const days = Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  const t = today()

  const recMap = useMemo(() => {
    const m = new Map<string, AttendanceStatus>()
    attendance
      .filter((a) => a.date.startsWith(month) && inScope(a.hostelId, scope))
      .forEach((a) => m.set(`${a.hostelerId}|${a.date}`, a.status))
    return m
  }, [attendance, month, scope])

  const rows = scoped
    .filter(
      (h) =>
        h.status !== 'reserved' &&
        h.checkInDate <= monthEnd &&
        (!h.checkOutDate || h.checkOutDate >= monthStart),
    )
    .filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => {
      const statuses = days.map((d) => recMap.get(`${h.id}|${d}`) ?? null)
      const present = statuses.filter((s) => s === 'present').length
      const late = statuses.filter((s) => s === 'late').length
      const absent = statuses.filter((s) => s === 'absent').length
      const leave = statuses.filter((s) => s === 'leave').length
      const counted = present + late + absent
      const pct = counted ? Math.round(((present + late) / counted) * 100) : null
      return { h, statuses, present, late, absent, leave, pct }
    })

  const exportCsv = () => {
    downloadCsv(`attendance-${month}.csv`, [
      ['Name', 'Room', ...days.map((d) => d.slice(8)), 'Present', 'Late', 'Absent', 'Leave', 'Attendance %'],
      ...rows.map((r) => [
        r.h.name,
        beds.room(r.h.roomId),
        ...r.statuses.map((s) => (s ? CELL_SHORT[s] : '')),
        r.present,
        r.late,
        r.absent,
        r.leave,
        r.pct === null ? '' : `${r.pct}%`,
      ]),
    ])
    toast.success('Register exported')
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <Input type="month" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="sm:w-44" />
        <SearchInput value={q} onChange={setQ} placeholder="Search hosteler…" className="sm:w-64" />
        <div className="flex flex-wrap items-center gap-2 text-xs sm:ml-auto">
          {(Object.keys(CELL_CLASS) as AttendanceStatus[]).map((s) => (
            <span key={s} className={cn('rounded px-1.5 py-0.5 font-semibold', CELL_CLASS[s])}>
              {CELL_SHORT[s]} = {s}
            </span>
          ))}
          <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={`No hostelers for ${formatMonth(month)}`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 min-w-[160px] bg-slate-50 px-3 py-2 text-left font-semibold">Hosteler</th>
                {days.map((d) => {
                  const wd = parseISO(d).getDay()
                  return (
                    <th key={d} className={cn('w-7 px-0.5 py-2 text-center font-medium', wd === 0 && 'text-red-400')}>
                      <div>{Number(d.slice(8))}</div>
                      <div className="text-[10px] font-normal">{'SMTWTFS'[wd]}</div>
                    </th>
                  )
                })}
                <th className="px-3 py-2 text-right font-semibold">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.h.id} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                    <p className="truncate font-medium text-slate-800">{r.h.name}</p>
                    <p className="text-[11px] text-slate-400">{r.h.roomId ? `Room ${beds.room(r.h.roomId)}` : r.h.status === 'checked_out' ? 'Checked out' : '—'}</p>
                  </td>
                  {r.statuses.map((s, i) => (
                    <td key={i} className="px-0.5 py-1 text-center">
                      <span
                        title={`${days[i]}: ${s ?? (days[i]! > t ? 'future' : 'not marked')}`}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded text-[10px] font-semibold',
                          s ? CELL_CLASS[s] : days[i]! > t ? 'bg-transparent' : 'bg-slate-50 text-slate-300',
                        )}
                      >
                        {s ? CELL_SHORT[s] : days[i]! > t ? '' : '·'}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">
                    {r.pct === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className={cn('font-semibold', r.pct >= 90 ? 'text-emerald-600' : r.pct >= 75 ? 'text-amber-600' : 'text-red-600')}>
                        {r.pct}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Leaves                                                              */
/* ------------------------------------------------------------------ */

function LeavesTab() {
  const scope = useScope()
  const leaves = useStore((s) => s.leaves)
  const decideLeave = useStore((s) => s.decideLeave)
  const hMap = useHostelerMap()
  const hostelName = useHostelName()
  const beds = useBedLabeler()
  const [status, setStatus] = useState<LeaveStatus | 'all'>('pending')
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const t = today()

  const scoped = leaves.filter((l) => inScope(l.hostelId, scope))
  const count = (s: LeaveStatus) => scoped.filter((l) => l.status === s).length
  const current = scoped.filter((l) => l.status === 'approved' && l.from <= t && l.to >= t)
  const rows = scoped
    .filter((l) => status === 'all' || l.status === status)
    .filter((l) => {
      if (!q) return true
      const h = hMap.get(l.hostelerId)
      const s = q.toLowerCase()
      return (h?.name ?? '').toLowerCase().includes(s) || l.destination.toLowerCase().includes(s) || l.reason.toLowerCase().includes(s)
    })
    .sort((a, b) => (status === 'pending' ? a.from.localeCompare(b.from) : b.createdAt.localeCompare(a.createdAt)))

  const decide = (id: ID, s: LeaveStatus) => {
    decideLeave(id, s)
    const name = hMap.get(leaves.find((l) => l.id === id)?.hostelerId ?? '')?.name ?? 'hosteler'
    toast.success(`Leave ${s} for ${name}`)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Pending requests" value={count('pending')} icon={<Clock className="h-5 w-5" />} tone="amber" onClick={() => setStatus('pending')} />
        <StatCard label="Currently on leave" value={current.length} icon={<Plane className="h-5 w-5" />} tone="violet" />
        <StatCard label="Approved" value={count('approved')} icon={<Check className="h-5 w-5" />} tone="green" onClick={() => setStatus('approved')} />
        <StatCard label="Rejected" value={count('rejected')} icon={<X className="h-5 w-5" />} tone="red" onClick={() => setStatus('rejected')} />
      </div>

      {current.length > 0 && (
        <Card>
          <CardHeader title="Currently on leave" subtitle={`${current.length} hosteler${current.length > 1 ? 's' : ''} away today`} />
          <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((l) => {
              const h = hMap.get(l.hostelerId)
              return (
                <li key={l.id} className="flex items-center gap-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                  <Avatar name={h?.name ?? '?'} src={h?.photo} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{h?.name ?? 'Unknown'}</p>
                    <p className="truncate text-xs text-slate-500">
                      {l.destination || '—'} · back {format(addDays(parseISO(l.to), 1), 'dd MMM')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <Tabs<LeaveStatus | 'all'>
            className="border-0"
            value={status}
            onChange={setStatus}
            tabs={[
              { value: 'pending', label: 'Pending', count: count('pending') },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
            <SearchInput value={q} onChange={setQ} placeholder="Search…" className="sm:w-56" />
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
              Add leave
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Plane className="h-6 w-6" />} title={status === 'pending' ? 'No pending requests' : 'No leaves found'} description="Leave requests from the hosteler portal show up here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Hosteler</TH>
                <TH>Dates</TH>
                <TH>Destination & reason</TH>
                <TH>Status</TH>
                <TH className="text-right">Action</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((l) => {
                const h = hMap.get(l.hostelerId)
                const days = daysBetween(l.from, l.to) + 1
                return (
                  <TR key={l.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={h?.name ?? '?'} src={h?.photo} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{h?.name ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-500">
                            {h ? beds.label(h.roomId, h.bedId) : ''}
                            {scope === 'all' ? ` · ${hostelName(l.hostelId)}` : ''}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <p className="font-medium text-slate-800">
                        {formatDate(l.from, 'dd MMM')} – {formatDate(l.to, 'dd MMM yyyy')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {days} day{days > 1 ? 's' : ''}
                      </p>
                    </TD>
                    <TD className="max-w-xs">
                      <p className="flex items-center gap-1 text-slate-800">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{l.destination || '—'}</span>
                      </p>
                      <p className="line-clamp-2 text-xs text-slate-500">{l.reason}</p>
                    </TD>
                    <TD>
                      <StatusBadge status={l.status} />
                      {l.decidedAt && <p className="mt-1 text-[11px] text-slate-400">{formatDate(l.decidedAt, 'dd MMM, hh:mm a')}</p>}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {l.status !== 'approved' && (
                          <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => decide(l.id, 'approved')}>
                            Approve
                          </Button>
                        )}
                        {l.status !== 'rejected' && (
                          <Button size="sm" variant="outline" icon={<X className="h-3.5 w-3.5" />} onClick={() => decide(l.id, 'rejected')}>
                            Reject
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <AddLeaveModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function AddLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scoped = useScopedHostelers()
  const requestLeave = useStore((s) => s.requestLeave)
  const decideLeave = useStore((s) => s.decideLeave)
  const beds = useBedLabeler()
  const [hostelerId, setHostelerId] = useState('')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [approve, setApprove] = useState(true)
  const [err, setErr] = useState<Record<string, string>>({})

  const options = scoped
    .filter((h) => h.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => ({ value: h.id, label: `${h.name}${h.roomId ? ` (Room ${beds.room(h.roomId)})` : ''}` }))

  const reset = () => {
    setHostelerId('')
    setFrom(today())
    setTo(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
    setDestination('')
    setReason('')
    setApprove(true)
    setErr({})
  }

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hostelerId) e.hostelerId = 'Select a hosteler'
    if (!from) e.from = 'Required'
    if (!to) e.to = 'Required'
    if (from && to && to < from) e.to = 'End date is before start date'
    if (!reason.trim()) e.reason = 'Reason is required'
    setErr(e)
    if (Object.keys(e).length) return
    requestLeave({ hostelerId, from, to, destination: destination.trim(), reason: reason.trim() })
    if (approve) {
      const created = useStore.getState().leaves[0]
      if (created && created.hostelerId === hostelerId) decideLeave(created.id, 'approved')
    }
    toast.success(approve ? 'Leave added and approved' : 'Leave request added')
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add leave on behalf"
      description="Record a leave for a hosteler (e.g. requested over phone)"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} icon={<LogOut className="h-4 w-4" />}>
            Save leave
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Hosteler" required error={err.hostelerId}>
          <Select value={hostelerId} onChange={(e) => setHostelerId(e.target.value)} placeholder="Select hosteler…" options={options} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required error={err.from}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" required error={err.to}>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Destination">
          <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Home – Bhopal" />
        </Field>
        <Field label="Reason" required error={err.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function" />
        </Field>
        <Switch checked={approve} onChange={setApprove} label="Approve immediately" />
      </div>
    </Modal>
  )
}
