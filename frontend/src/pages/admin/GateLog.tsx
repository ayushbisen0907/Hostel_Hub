import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Download, LogIn, LogOut, MoonStar, Search, X } from 'lucide-react'
import { useScope, useSettings } from '@/api/common'
import { toastError, useApiMutation } from '@/api/query'
import { GATE_INVALIDATE, gateApi, useGateLogs, useOutside, type GateDirection, type GateLogRow } from '@/api/gate'
import type { HostelerRow } from '@/api/hostelers'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
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
import { cn, downloadCsv, formatDate, formatDateTime, today } from '@/lib/utils'
import { FilterBar, HostelerAvatar, HostelerSearch, Pager, bedText } from './_residents'

const PAGE_SIZE = 100

function timeOf(iso: string, pattern = 'hh:mm a') {
  try {
    return format(parseISO(iso), pattern)
  } catch {
    return iso
  }
}

function roomOf(g: { roomNumber: string | null; bedLabel: string | null }) {
  return g.roomNumber ? `Room ${g.roomNumber}${g.bedLabel ? ` · ${g.bedLabel}` : ''}` : '—'
}

export default function GateLog() {
  const navigate = useNavigate()
  const scope = useScope()
  const curfew = useSettings().nightCurfew || '22:00'

  const [picked, setPicked] = useState<HostelerRow | null>(null)
  const [note, setNote] = useState('')

  const [date, setDate] = useState(today())
  const [direction, setDirection] = useState('')
  const [q, setQ] = useState('')
  const [lateOnly, setLateOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  useEffect(() => setPage(1), [date, direction, scope])

  const filters = { hostelId: scope, date: date || undefined, direction: (direction || undefined) as GateDirection | undefined }
  const list = useGateLogs({ ...filters, page, limit: PAGE_SIZE })
  const todayQ = useGateLogs({ hostelId: scope, date: today(), limit: 500 })
  const outsideQ = useOutside(scope)
  const pickedLastQ = useGateLogs({ hostelerId: picked?.id, limit: 1 }, !!picked)

  const mark = useApiMutation(gateApi.create, { invalidate: GATE_INVALIDATE })

  const todayStats = useMemo(() => {
    const items = todayQ.data?.items ?? []
    return {
      in: items.filter((g) => g.direction === 'in').length,
      out: items.filter((g) => g.direction === 'out').length,
      late: items.filter((g) => g.late).length,
    }
  }, [todayQ.data])

  const term = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      (list.data?.items ?? []).filter((g) => {
        if (lateOnly && !g.late) return false
        if (term && !`${g.hostelerName ?? ''} ${g.hostelerLoginId ?? ''} ${g.roomNumber ?? ''}`.toLowerCase().includes(term)) return false
        return true
      }),
    [list.data, lateOnly, term],
  )

  const submitQuick = (dir: GateDirection) => {
    if (!picked) return
    const name = picked.name
    mark.mutate(
      { hostelerId: picked.id, direction: dir, note: note.trim() },
      {
        onSuccess: (g) => {
          toast.success(`${name} marked ${dir.toUpperCase()}${g.late ? ' (late)' : ''}`)
          setPicked(null)
          setNote('')
        },
      },
    )
  }

  const markIn = (id: string, name: string) =>
    mark.mutate(
      { hostelerId: id, direction: 'in', note: '' },
      { onSuccess: (g) => toast.success(`${name} marked IN${g.late ? ' (late)' : ''}`) },
    )

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all: GateLogRow[] = []
      for (let p = 1; p <= 100; p++) {
        const r = await gateApi.list({ ...filters, page: p, limit: 500 })
        all.push(...r.items)
        if (p >= r.pages) break
      }
      const out = all.filter((g) => (!lateOnly || g.late) && (!term || `${g.hostelerName ?? ''} ${g.hostelerLoginId ?? ''}`.toLowerCase().includes(term)))
      downloadCsv(`gate-log-${date || 'all'}.csv`, [
        ['Time', 'Hosteler', 'Hosteler ID', 'Room', 'Direction', 'Late', 'Note'],
        ...out.map((g) => [formatDateTime(g.time), g.hostelerName ?? 'Unknown', g.hostelerLoginId ?? '', roomOf(g), g.direction.toUpperCase(), g.late ? 'Yes' : '', g.note]),
      ])
    } catch (e) {
      toastError(e)
    } finally {
      setExporting(false)
    }
  }

  const pickedLast = pickedLastQ.data?.items[0]
  const suggested: GateDirection = pickedLast?.direction === 'out' ? 'in' : 'out'
  const outside = outsideQ.data ?? []

  return (
    <>
      <PageHeader
        title="Gate log"
        subtitle={`In/out register · night curfew ${curfew}`}
        actions={
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => void exportCsv()} loading={exporting} disabled={!rows.length}>
            Export CSV
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-3 font-semibold text-slate-900">Quick entry</h3>
          {picked ? (
            <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5">
              <HostelerAvatar h={picked} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{picked.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {bedText(picked)} · last{' '}
                  {pickedLastQ.isLoading
                    ? '…'
                    : pickedLast
                      ? `${pickedLast.direction.toUpperCase()} at ${formatDateTime(pickedLast.time)}`
                      : 'no entries'}
                </p>
              </div>
              <button type="button" onClick={() => setPicked(null)} className="text-slate-400 hover:text-slate-700" aria-label="Clear">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <HostelerSearch
              onPick={setPicked}
              status="active"
              placeholder="Type resident name, phone or Hosteler ID…"
              emptyText="No checked-in resident matches."
            />
          )}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. going home, market" />
            <div className="flex gap-2">
              <Button
                variant={suggested === 'in' && picked ? 'success' : 'outline'}
                icon={<LogIn className="h-4 w-4" />}
                onClick={() => submitQuick('in')}
                disabled={!picked}
                loading={mark.isPending && mark.variables?.direction === 'in' && mark.variables.hostelerId === picked?.id}
                className="flex-1 sm:flex-none"
              >
                Mark IN
              </Button>
              <Button
                variant={suggested === 'out' && picked ? 'primary' : 'outline'}
                icon={<LogOut className="h-4 w-4" />}
                onClick={() => submitQuick('out')}
                disabled={!picked}
                loading={mark.isPending && mark.variables?.direction === 'out' && mark.variables.hostelerId === picked?.id}
                className="flex-1 sm:flex-none"
              >
                Mark OUT
              </Button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
            <div>
              <p className="text-xl font-bold text-emerald-600">{todayQ.data ? todayStats.in : '…'}</p>
              <p className="text-xs text-slate-500">In today</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-600">{todayQ.data ? todayStats.out : '…'}</p>
              <p className="text-xs text-slate-500">Out today</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-600">{todayQ.data ? todayStats.late : '…'}</p>
              <p className="text-xs text-slate-500">Late entries</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Currently outside" subtitle={outsideQ.data ? `${outside.length} resident(s)` : undefined} />
          {outsideQ.isLoading ? (
            <LoadingState className="py-8" />
          ) : outsideQ.error ? (
            <ErrorState error={outsideQ.error} onRetry={() => void outsideQ.refetch()} className="py-8" />
          ) : outside.length ? (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {outside.map(({ hosteler: h, log }) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar name={h.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => navigate(`/app/hostelers/${h.id}`)} className="truncate text-sm font-medium text-slate-900 hover:underline">
                      {h.name}
                    </button>
                    <p className="truncate text-xs text-slate-500">
                      since {formatDateTime(log.time)}
                      {log.note && ` · ${log.note}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markIn(h.id, h.name)}
                    loading={mark.isPending && mark.variables?.hostelerId === h.id}
                    disabled={mark.isPending}
                  >
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
            <Input type="date" className="sm:w-44" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
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
            <SearchInput value={q} onChange={setQ} placeholder="Filter this page by resident…" className="col-span-2 sm:w-64" />
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
        {list.isLoading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          <Table className={cn(list.isPlaceholderData && 'opacity-60')}>
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
              {rows.map((g) => (
                <TR key={g.id} className={cn(g.late && 'bg-red-50/60')} onClick={() => navigate(`/app/hostelers/${g.hostelerId}`)}>
                  <TD className="whitespace-nowrap">
                    <span className={cn('font-medium', g.late ? 'text-red-700' : 'text-slate-900')}>{timeOf(g.time)}</span>
                    {!date && <p className="text-xs text-slate-500">{formatDate(timeOf(g.time, 'yyyy-MM-dd'))}</p>}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Avatar name={g.hostelerName ?? '?'} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{g.hostelerName ?? 'Unknown'}</p>
                        {g.hostelerLoginId && <p className="font-mono text-xs text-slate-500">{g.hostelerLoginId}</p>}
                      </div>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">{roomOf(g)}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={g.direction === 'in' ? 'green' : 'amber'}>{g.direction === 'in' ? 'IN' : 'OUT'}</Badge>
                      {g.late && <Badge tone="red">Late</Badge>}
                    </div>
                  </TD>
                  <TD className="text-slate-500">{g.note || '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No entries"
            description={date ? `Nothing logged on ${formatDate(date)} with these filters.` : 'No entries match these filters.'}
          />
        )}
        {list.data && (
          <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} busy={list.isFetching} noun="entries" />
        )}
      </Card>
    </>
  )
}
