import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
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
import { useHostelName, useOrg, useScope, useSettings } from '@/api/common'
import {
  useAttendance,
  useAttendanceRegister,
  useCreateLeave,
  useCurrentLeaves,
  useDecideLeave,
  useLeaves,
  useMarkAllPresent,
  useMarkAttendance,
  type AttendanceStatus,
  type Leave,
  type LeaveStatus,
  type RosterItem,
} from '@/api/attendance'
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
  QueryView,
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
import { HostelerPicker, Segmented, roomLabel, waLink, type HostelerHit } from './_ops'

type PageTab = 'attendance' | 'leaves'

export default function Attendance() {
  const [params, setParams] = useSearchParams()
  const tab: PageTab = params.get('tab') === 'leaves' ? 'leaves' : 'attendance'
  const scope = useScope()
  const leaves = useLeaves(scope)
  const pending = leaves.data?.filter((l) => l.status === 'pending').length

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
  const { nightCurfew: curfew } = useSettings()
  const orgName = useOrg().data?.name ?? 'Hostel'
  const hostelName = useHostelName()
  const [date, setDate] = useState(today())
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus | 'unmarked'>('all')
  const [notifyOpen, setNotifyOpen] = useState(false)

  const query = useAttendance(scope, date)
  const mark = useMarkAttendance(scope, date)
  const markAll = useMarkAllPresent()

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const counts = query.data?.summary ?? { total: 0, present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 }

  const s = q.trim().toLowerCase()
  const filtered = items
    .filter((h) => !s || h.name.toLowerCase().includes(s) || (h.roomNumber ?? '').toLowerCase().includes(s))
    .filter((h) => (statusFilter === 'all' ? true : statusFilter === 'unmarked' ? !h.status : h.status === statusFilter))

  const groups = useMemo(() => {
    const m = new Map<string, RosterItem[]>()
    filtered.forEach((h) => {
      const key = `${h.hostelId}|${h.roomNumber ?? ''}`
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
  }, [filtered, hostelName])

  const absentees = items.filter((h) => h.status === 'absent')

  const doMarkAll = () => markAll.mutate({ date, hostelId: scope === 'all' ? undefined : scope })

  const markGroup = (list: RosterItem[], status: AttendanceStatus) =>
    mark.mutate({ hostelerIds: list.map((h) => h.hostelerId), status }, { onSuccess: (n) => toast.success(`${n} marked ${status}`) })

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
            <Button icon={<CheckCheck className="h-4 w-4" />} onClick={doMarkAll} loading={markAll.isPending} disabled={!counts.unmarked}>
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
          <button className="font-medium text-brand-600 hover:underline" onClick={() => setDate(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))}>
            Previous day
          </button>
        </div>

        <QueryView query={query}>
          {() =>
            items.length === 0 ? (
              <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="No active hostelers" description="Check in hostelers to start taking attendance." />
            ) : groups.length === 0 ? (
              <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="Nothing matches your filters" />
            ) : (
              <div className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <div key={g.key}>
                    <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {roomLabel(g.room)}
                        {scope === 'all' && <span className="ml-2 font-normal normal-case text-slate-400">{hostelName(g.hostelId)}</span>}
                      </p>
                      <button
                        className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                        disabled={mark.isPending}
                        onClick={() => markGroup(g.list, 'present')}
                      >
                        Room present
                      </button>
                    </div>
                    <ul className="divide-y divide-slate-50">
                      {g.list.map((h) => (
                        <li key={h.hostelerId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={h.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{h.name}</p>
                              <p className="text-xs text-slate-500">
                                {roomLabel(h.roomNumber)}
                                {h.onApprovedLeave && <span className="ml-2 font-medium text-violet-600">· approved leave</span>}
                              </p>
                            </div>
                          </div>
                          <Segmented<AttendanceStatus>
                            value={h.status}
                            size="sm"
                            onChange={(v) => v !== h.status && mark.mutate({ hostelerIds: [h.hostelerId], status: v })}
                            options={STATUS_OPTS.map((o) => ({ value: o.value, label: o.label, activeClass: o.activeClass }))}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          }
        </QueryView>
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
              const place = hostelName(h.hostelId)
              const msg = `Dear ${h.guardianName || 'Guardian'}, this is to inform you that ${h.name} was marked absent at ${place !== '—' ? place : orgName} on ${formatDate(date)} (night roll call, curfew ${curfew}). Please get in touch with the warden. – ${orgName}`
              return (
                <li key={h.hostelerId} className="flex items-center justify-between gap-3 py-3">
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
  const [month, setMonth] = useState(currentMonth())
  const [q, setQ] = useState('')
  const query = useAttendanceRegister(scope, month)
  const t = today()

  const days = query.data?.days ?? []
  const s = q.trim().toLowerCase()
  const rows = (query.data?.items ?? []).filter((r) => !s || r.name.toLowerCase().includes(s))

  const exportCsv = () => {
    downloadCsv(`attendance-${month}.csv`, [
      ['Name', 'Login ID', 'Room', ...days.map((d) => d.slice(8)), 'Present', 'Late', 'Absent', 'Leave', 'Attendance %'],
      ...rows.map((r) => [
        r.name,
        r.loginId,
        r.roomNumber ?? '',
        ...days.map((d) => (r.days[d] ? CELL_SHORT[r.days[d]!] : '')),
        r.present,
        r.late,
        r.absent,
        r.leave,
        r.percentage === null ? '' : `${r.percentage}%`,
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
          {(Object.keys(CELL_CLASS) as AttendanceStatus[]).map((st) => (
            <span key={st} className={cn('rounded px-1.5 py-0.5 font-semibold', CELL_CLASS[st])}>
              {CELL_SHORT[st]} = {st}
            </span>
          ))}
          <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </div>
      </div>
      <QueryView query={query}>
        {() =>
          rows.length === 0 ? (
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
                    <tr key={r.hostelerId} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                        <p className="truncate font-medium text-slate-800">{r.name}</p>
                        <p className="text-[11px] text-slate-400">{roomLabel(r.roomNumber, '—')}</p>
                      </td>
                      {days.map((d) => {
                        const st = r.days[d]
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            <span
                              title={`${d}: ${st ?? (d > t ? 'future' : 'not marked')}`}
                              className={cn(
                                'flex h-6 w-6 items-center justify-center rounded text-[10px] font-semibold',
                                st ? CELL_CLASS[st] : d > t ? 'bg-transparent' : 'bg-slate-50 text-slate-300',
                              )}
                            >
                              {st ? CELL_SHORT[st] : d > t ? '' : '·'}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5 text-right">
                        {r.percentage === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={cn(
                              'font-semibold',
                              r.percentage >= 90 ? 'text-emerald-600' : r.percentage >= 75 ? 'text-amber-600' : 'text-red-600',
                            )}
                          >
                            {r.percentage}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryView>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Leaves                                                              */
/* ------------------------------------------------------------------ */

function LeavesTab() {
  const scope = useScope()
  const hostelName = useHostelName()
  const leavesQ = useLeaves(scope)
  const currentQ = useCurrentLeaves(scope)
  const decide = useDecideLeave()
  const [status, setStatus] = useState<LeaveStatus | 'all'>('pending')
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const all = leavesQ.data ?? []
  const current = currentQ.data ?? []
  const count = (st: LeaveStatus) => all.filter((l) => l.status === st).length
  const s = q.trim().toLowerCase()
  const rows = all
    .filter((l) => status === 'all' || l.status === status)
    .filter(
      (l) =>
        !s ||
        l.hostelerName.toLowerCase().includes(s) ||
        l.destination.toLowerCase().includes(s) ||
        l.reason.toLowerCase().includes(s),
    )
    .sort((a, b) => (status === 'pending' ? a.from.localeCompare(b.from) : b.createdAt.localeCompare(a.createdAt)))

  const act = (l: Leave, action: 'approve' | 'reject') => decide.mutate({ id: l.id, action, name: l.hostelerName })
  const busy = (l: Leave, action: 'approve' | 'reject') => decide.isPending && decide.variables?.id === l.id && decide.variables.action === action

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Pending requests" value={leavesQ.data ? count('pending') : '—'} icon={<Clock className="h-5 w-5" />} tone="amber" onClick={() => setStatus('pending')} />
        <StatCard label="Currently on leave" value={currentQ.data ? current.length : '—'} icon={<Plane className="h-5 w-5" />} tone="violet" />
        <StatCard label="Approved" value={leavesQ.data ? count('approved') : '—'} icon={<Check className="h-5 w-5" />} tone="green" onClick={() => setStatus('approved')} />
        <StatCard label="Rejected" value={leavesQ.data ? count('rejected') : '—'} icon={<X className="h-5 w-5" />} tone="red" onClick={() => setStatus('rejected')} />
      </div>

      {current.length > 0 && (
        <Card>
          <CardHeader title="Currently on leave" subtitle={`${current.length} hosteler${current.length > 1 ? 's' : ''} away today`} />
          <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                <Avatar name={l.hostelerName || '?'} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{l.hostelerName || 'Unknown'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {l.destination || '—'} · back {format(addDays(parseISO(l.to), 1), 'dd MMM')}
                  </p>
                </div>
              </li>
            ))}
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
              { value: 'pending', label: 'Pending', count: leavesQ.data ? count('pending') : undefined },
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
        <QueryView query={leavesQ}>
          {() =>
            rows.length === 0 ? (
              <EmptyState
                icon={<Plane className="h-6 w-6" />}
                title={status === 'pending' ? 'No pending requests' : 'No leaves found'}
                description="Leave requests from the hosteler portal show up here."
              />
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
                    const days = daysBetween(l.from, l.to) + 1
                    return (
                      <TR key={l.id}>
                        <TD>
                          <div className="flex items-center gap-3">
                            <Avatar name={l.hostelerName || '?'} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{l.hostelerName || 'Unknown'}</p>
                              <p className="text-xs text-slate-500">
                                {roomLabel(l.roomNumber)}
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
                          {l.status === 'pending' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="success"
                                icon={<Check className="h-3.5 w-3.5" />}
                                loading={busy(l, 'approve')}
                                disabled={decide.isPending}
                                onClick={() => act(l, 'approve')}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                icon={<X className="h-3.5 w-3.5" />}
                                loading={busy(l, 'reject')}
                                disabled={decide.isPending}
                                onClick={() => act(l, 'reject')}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Decided</span>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Table>
            )
          }
        </QueryView>
      </Card>

      {addOpen && <AddLeaveModal onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function AddLeaveModal({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const create = useCreateLeave()
  const [hosteler, setHosteler] = useState<HostelerHit | null>(null)
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [approve, setApprove] = useState(true)
  const [err, setErr] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hosteler) e.hosteler = 'Select a hosteler'
    if (!from) e.from = 'Required'
    if (!to) e.to = 'Required'
    if (from && to && to < from) e.to = 'End date is before start date'
    if (reason.trim().length < 2) e.reason = 'Reason is required'
    setErr(e)
    if (Object.keys(e).length || !hosteler) return
    create.mutate(
      { hostelerId: hosteler.id, from, to, destination: destination.trim(), reason: reason.trim(), approve },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add leave on behalf"
      description="Record a leave for a hosteler (e.g. requested over phone)"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} icon={<LogOut className="h-4 w-4" />} loading={create.isPending}>
            Save leave
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Hosteler<span className="ml-0.5 text-red-500">*</span>
          </span>
          <HostelerPicker value={hosteler} onChange={setHosteler} hostelId={scope} error={err.hosteler} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required error={err.from}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" required error={err.to}>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Destination">
          <Input value={destination} maxLength={200} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Home – Bhopal" />
        </Field>
        <Field label="Reason" required error={err.reason}>
          <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function" />
        </Field>
        <Switch checked={approve} onChange={setApprove} label="Approve immediately" />
      </div>
    </Modal>
  )
}
