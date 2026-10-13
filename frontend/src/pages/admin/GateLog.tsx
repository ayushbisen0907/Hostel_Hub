import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Download, LogIn, LogOut, MoonStar, Search, X } from 'lucide-react'
import { useStore } from '@/store'
import { bedLabel, inScope, useHostelerMap, useScope, useScopedHostelers } from '@/store/selectors'
import type { GateLog as GateLogT, Hosteler, ID } from '@/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  SearchInput,
  Select,
  Table,
  TD,
  TH,
  THead,
  TR,
  toast,
} from '@/components/ui'
import { cn, downloadCsv, formatDate, formatDateTime, toDateKey, today } from '@/lib/utils'
import { FilterBar } from './_residents'

function localTime(iso: string) {
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return '00:00'
  }
}

function localDate(iso: string) {
  try {
    return toDateKey(parseISO(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/** An IN entry after curfew (or in the small hours before 5 AM) is late. */
function isLate(g: GateLogT, curfew: string) {
  if (g.direction !== 'in') return false
  const t = localTime(g.time)
  return t >= curfew || t < '05:00'
}

export default function GateLog() {
  const navigate = useNavigate()
  const scope = useScope()
  const gateLogs = useStore((s) => s.gateLogs)
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const curfew = useStore((s) => s.settings.nightCurfew || '22:00')
  const addGateLog = useStore((s) => s.addGateLog)
  const hostelerMap = useHostelerMap()
  const residents = useScopedHostelers()

  const [pickQ, setPickQ] = useState('')
  const [picked, setPicked] = useState<Hosteler | null>(null)
  const [note, setNote] = useState('')

  const [date, setDate] = useState(today())
  const [direction, setDirection] = useState('')
  const [q, setQ] = useState('')
  const [lateOnly, setLateOnly] = useState(false)

  const db = useMemo(() => ({ rooms, beds }), [rooms, beds])

  const scopedLogs = useMemo(
    () => gateLogs.filter((g) => inScope(g.hostelId, scope)).sort((a, b) => b.time.localeCompare(a.time)),
    [gateLogs, scope],
  )

  const latest = useMemo(() => {
    const m = new Map<ID, GateLogT>()
    for (const g of scopedLogs) if (!m.has(g.hostelerId)) m.set(g.hostelerId, g)
    return m
  }, [scopedLogs])

  const active = useMemo(() => residents.filter((h) => h.status === 'active'), [residents])

  const outside = useMemo(
    () =>
      active
        .map((h) => ({ h, log: latest.get(h.id) }))
        .filter((x): x is { h: Hosteler; log: GateLogT } => x.log?.direction === 'out')
        .sort((a, b) => a.log.time.localeCompare(b.log.time)),
    [active, latest],
  )

  const suggestions = useMemo(() => {
    const term = pickQ.trim().toLowerCase()
    if (!term) return []
    return active
      .filter((h) => `${h.name} ${h.phone} ${bedLabel(db, h.bedId)}`.toLowerCase().includes(term))
      .slice(0, 6)
  }, [active, pickQ, db])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return scopedLogs.filter((g) => {
      if (date && localDate(g.time) !== date) return false
      if (direction && g.direction !== direction) return false
      if (lateOnly && !isLate(g, curfew)) return false
      if (term) {
        const h = hostelerMap.get(g.hostelerId)
        if (!h || !`${h.name} ${h.phone}`.toLowerCase().includes(term)) return false
      }
      return true
    })
  }, [scopedLogs, date, direction, lateOnly, q, hostelerMap, curfew])

  const todayStats = useMemo(() => {
    const t = today()
    const todays = scopedLogs.filter((g) => localDate(g.time) === t)
    return {
      in: todays.filter((g) => g.direction === 'in').length,
      out: todays.filter((g) => g.direction === 'out').length,
      late: todays.filter((g) => isLate(g, curfew)).length,
    }
  }, [scopedLogs, curfew])

  const mark = (h: Hosteler, dir: 'in' | 'out', n = '') => {
    addGateLog(h.id, dir, n.trim())
    toast.success(`${h.name} marked ${dir.toUpperCase()}`)
  }

  const submitQuick = (dir: 'in' | 'out') => {
    if (!picked) return toast.error('Search and select a resident first')
    mark(picked, dir, note)
    setPicked(null)
    setPickQ('')
    setNote('')
  }

  const exportCsv = () => {
    downloadCsv(`gate-log-${date || 'all'}.csv`, [
      ['Time', 'Hosteler', 'Phone', 'Room', 'Direction', 'Late', 'Note'],
      ...filtered.map((g) => {
        const h = hostelerMap.get(g.hostelerId)
        return [formatDateTime(g.time), h?.name ?? 'Unknown', h?.phone ?? '', h ? bedLabel(db, h.bedId) : '', g.direction.toUpperCase(), isLate(g, curfew) ? 'Yes' : '', g.note]
      }),
    ])
  }

  const pickedLast = picked ? latest.get(picked.id) : undefined
  const suggested: 'in' | 'out' = pickedLast?.direction === 'out' ? 'in' : 'out'

  return (
    <>
      <PageHeader
        title="Gate log"
        subtitle={`In/out register · night curfew ${curfew}`}
        actions={
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!filtered.length}>
            Export CSV
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 font-semibold text-slate-900">Quick entry</h3>
          {picked ? (
            <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5">
              <Avatar name={picked.name} src={picked.photo} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{picked.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {bedLabel(db, picked.bedId)} · last {pickedLast ? `${pickedLast.direction.toUpperCase()} at ${formatDateTime(pickedLast.time)}` : 'no entries'}
                </p>
              </div>
              <button type="button" onClick={() => setPicked(null)} className="text-slate-400 hover:text-slate-700" aria-label="Clear">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <SearchInput value={pickQ} onChange={setPickQ} placeholder="Type resident name, phone or room…" />
              {suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {suggestions.map((h) => {
                    const l = latest.get(h.id)
                    return (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked(h)
                            setPickQ('')
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <Avatar name={h.name} src={h.photo} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                            <p className="truncate text-xs text-slate-500">{bedLabel(db, h.bedId)}</p>
                          </div>
                          {l && <Badge tone={l.direction === 'in' ? 'green' : 'amber'}>{l.direction === 'in' ? 'Inside' : 'Outside'}</Badge>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {pickQ.trim() && !suggestions.length && <p className="mt-2 text-xs text-slate-500">No active resident matches “{pickQ}”.</p>}
            </div>
          )}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. going home, market" />
            <div className="flex gap-2">
              <Button
                variant={suggested === 'in' && picked ? 'success' : 'outline'}
                icon={<LogIn className="h-4 w-4" />}
                onClick={() => submitQuick('in')}
                className="flex-1 sm:flex-none"
              >
                Mark IN
              </Button>
              <Button
                variant={suggested === 'out' && picked ? 'primary' : 'outline'}
                icon={<LogOut className="h-4 w-4" />}
                onClick={() => submitQuick('out')}
                className="flex-1 sm:flex-none"
              >
                Mark OUT
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
            <div>
              <p className="text-xl font-bold text-emerald-600">{todayStats.in}</p>
              <p className="text-xs text-slate-500">In today</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-600">{todayStats.out}</p>
              <p className="text-xs text-slate-500">Out today</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-600">{todayStats.late}</p>
              <p className="text-xs text-slate-500">Late entries</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Currently outside" subtitle={`${outside.length} of ${active.length} residents`} />
          {outside.length ? (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {outside.map(({ h, log }) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={h.name} src={h.photo} size="sm" />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => navigate(`/app/hostelers/${h.id}`)} className="truncate text-sm font-medium text-slate-900 hover:underline">
                      {h.name}
                    </button>
                    <p className="truncate text-xs text-slate-500">
                      since {formatDateTime(log.time)}
                      {log.note && ` · ${log.note}`}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => mark(h, 'in')}>
                    IN
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Everyone is inside.</p>
          )}
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <FilterBar>
            <Input type="date" className="sm:w-44" value={date} onChange={(e) => setDate(e.target.value)} />
            <Select
              className="sm:w-36"
              value={direction}
              placeholder="In & out"
              options={[
                { value: 'in', label: 'IN only' },
                { value: 'out', label: 'OUT only' },
              ]}
              onChange={(e) => setDirection(e.target.value)}
            />
            <SearchInput value={q} onChange={setQ} placeholder="Search resident…" className="col-span-2 sm:w-64" />
            <Button variant={lateOnly ? 'primary' : 'outline'} size="sm" icon={<MoonStar className="h-4 w-4" />} onClick={() => setLateOnly((v) => !v)}>
              Late only
            </Button>
            {date && (
              <Button variant="ghost" size="sm" onClick={() => setDate('')}>
                All dates
              </Button>
            )}
          </FilterBar>
        </div>
        {filtered.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Hosteler</TH>
                <TH>Room</TH>
                <TH>Direction</TH>
                <TH>Note</TH>
              </tr>
            </THead>
            <tbody>
              {filtered.slice(0, 300).map((g) => {
                const h = hostelerMap.get(g.hostelerId)
                const late = isLate(g, curfew)
                return (
                  <TR key={g.id} className={cn(late && 'bg-red-50/60')} onClick={h ? () => navigate(`/app/hostelers/${h.id}`) : undefined}>
                    <TD className="whitespace-nowrap">
                      <span className={cn('font-medium', late ? 'text-red-700' : 'text-slate-900')}>{format(parseISO(g.time), 'hh:mm a')}</span>
                      {!date && <p className="text-xs text-slate-500">{formatDate(g.time)}</p>}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        {h && <Avatar name={h.name} src={h.photo} size="sm" />}
                        <span className="font-medium text-slate-900">{h?.name ?? 'Unknown'}</span>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">{h ? (h.status === 'checked_out' ? 'Checked out' : bedLabel(db, h.bedId)) : '—'}</TD>
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={g.direction === 'in' ? 'green' : 'amber'}>{g.direction === 'in' ? 'IN' : 'OUT'}</Badge>
                        {late && <Badge tone="red">Late</Badge>}
                      </div>
                    </TD>
                    <TD className="text-slate-500">{g.note || '—'}</TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Search className="h-6 w-6" />} title="No entries" description={date ? `Nothing logged on ${formatDate(date)} with these filters.` : 'No entries match these filters.'} />
        )}
        {filtered.length > 300 && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Showing latest 300 of {filtered.length}. Export CSV for all.</p>}
      </Card>
    </>
  )
}
