import { useEffect, useState } from 'react'
import { Clock, Download, History, LogOut, Phone, Plus, UserCheck, Users, DoorOpen } from 'lucide-react'
import { useHostelName, useScope } from '@/api/common'
import { fetchVisitors, useCheckOutVisitor, useCreateVisitor, useVisitorStats, useVisitors, type Visitor } from '@/api/visitors'
import { toastError } from '@/api/query'
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
  Table,
  TD,
  TH,
  THead,
  TR,
  confirm,
  toast,
} from '@/components/ui'
import { cn, downloadCsv, formatDate, formatDateTime, today } from '@/lib/utils'
import { HostelerPicker, Pager, formatDuration, roomLabel, useDebounced, useNow, type HostelerHit } from './_ops'

const RELATIONS = ['Father', 'Mother', 'Brother', 'Sister', 'Relative', 'Friend', 'Guardian', 'Other']
const ID_TYPES = ['Aadhaar', 'Driving licence', 'Voter ID', 'PAN', 'Passport', 'College ID', 'Other']
const HISTORY_PAGE = 25

export default function Visitors() {
  const scope = useScope()
  const hostelName = useHostelName()
  const now = useNow()
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const dq = useDebounced(q.trim())
  useEffect(() => setPage(1), [scope, dq, from, to])

  const stats = useVisitorStats(scope)
  const insideQ = useVisitors({ hostelId: scope, inside: 'true', limit: 500 })
  const filters = { hostelId: scope, q: dq || undefined, from: from || undefined, to: to || undefined }
  const historyQ = useVisitors({ ...filters, page, limit: HISTORY_PAGE })
  const checkOut = useCheckOutVisitor()

  const inside = [...(insideQ.data?.items ?? [])].sort((a, b) => a.inTime.localeCompare(b.inTime))
  const st = stats.data

  const checkout = async (v: Visitor) => {
    const ok = await confirm({ title: `Check out ${v.name}?`, message: 'The current time will be recorded as the exit time.', confirmText: 'Check out' })
    if (!ok) return
    checkOut.mutate(v.id)
  }
  const checkingOut = (v: Visitor) => checkOut.isPending && checkOut.variables === v.id

  const duration = (inTime: string, outTime: string | null) =>
    formatDuration((outTime ? new Date(outTime).getTime() : now) - new Date(inTime).getTime())

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all: Visitor[] = []
      for (let p = 1; ; p++) {
        const res = await fetchVisitors({ ...filters, page: p, limit: 500 })
        all.push(...res.items)
        if (p >= res.pages || p >= 20) break
      }
      downloadCsv(`visitors-${today()}.csv`, [
        ['Visitor', 'Phone', 'Relation', 'Visiting', 'Room', 'Hostel', 'Purpose', 'ID proof', 'In', 'Out', 'Duration'],
        ...all.map((v) => [
          v.name,
          v.phone,
          v.relation,
          v.hostelerName,
          v.roomNumber ?? '',
          hostelName(v.hostelId),
          v.purpose,
          v.idProof,
          formatDateTime(v.inTime),
          v.outTime ? formatDateTime(v.outTime) : 'Inside',
          duration(v.inTime, v.outTime),
        ]),
      ])
      toast.success('Visitor log exported')
    } catch (e) {
      toastError(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Visitors"
        subtitle="Visitor register with entry and exit times"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
            New visitor entry
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inside now" value={st?.inside ?? '—'} icon={<DoorOpen className="h-5 w-5" />} tone="amber" />
        <StatCard label="Visitors today" value={st?.today ?? '—'} icon={<UserCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="This month" value={st?.thisMonth ?? '—'} icon={<Users className="h-5 w-5" />} />
        <StatCard
          label="Avg. visit duration"
          value={st?.avgDurationMinutes != null ? formatDuration(st.avgDurationMinutes * 60_000) : '—'}
          icon={<Clock className="h-5 w-5" />}
          tone="violet"
        />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Currently inside"
          subtitle={inside.length ? `${inside.length} visitor${inside.length > 1 ? 's' : ''} on premises` : 'No visitors on premises'}
        />
        <QueryView query={insideQ}>
          {() =>
            inside.length === 0 ? (
              <EmptyState icon={<DoorOpen className="h-6 w-6" />} title="Nobody inside" description="New visitor entries will appear here until they are checked out." />
            ) : (
              <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {inside.map((v) => {
                  const long = now - new Date(v.inTime).getTime() > 3 * 3600000
                  return (
                    <li key={v.id} className={cn('rounded-xl border p-4', long ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200')}>
                      <div className="flex items-start gap-3">
                        <Avatar name={v.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">{v.name}</p>
                          <p className="text-xs text-slate-500">
                            {v.relation || 'Visitor'} of <span className="font-medium text-slate-700">{v.hostelerName || 'Unknown'}</span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {roomLabel(v.roomNumber)}
                            {scope === 'all' ? ` · ${hostelName(v.hostelId)}` : ''}
                          </p>
                        </div>
                        <Badge tone={long ? 'amber' : 'green'}>{duration(v.inTime, null)}</Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>
                          In at {formatDate(v.inTime, 'hh:mm a')}
                          {v.purpose ? ` · ${v.purpose}` : ''}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<LogOut className="h-3.5 w-3.5" />}
                          loading={checkingOut(v)}
                          disabled={checkOut.isPending}
                          onClick={() => checkout(v)}
                        >
                          Check out
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          }
        </QueryView>
      </Card>

      <Card>
        <CardHeader title="Visitor history" />
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search visitor, phone, hosteler…" className="lg:w-72" />
          <div className="flex items-center gap-2">
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="lg:w-40" aria-label="From date" />
            <span className="text-sm text-slate-400">to</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="lg:w-40" aria-label="To date" />
          </div>
          {(from || to || q) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom('')
                setTo('')
                setQ('')
              }}
            >
              Clear
            </Button>
          )}
          <Button
            variant="outline"
            className="lg:ml-auto"
            icon={<Download className="h-4 w-4" />}
            onClick={exportCsv}
            loading={exporting}
            disabled={!historyQ.data?.total}
          >
            Export CSV
          </Button>
        </div>
        <QueryView query={historyQ}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={<History className="h-6 w-6" />} title="No visitor records" />
            ) : (
              <div className={cn(historyQ.isFetching && 'opacity-70')}>
                <Table>
                  <THead>
                    <tr>
                      <TH>Visitor</TH>
                      <TH>Visiting</TH>
                      <TH>Purpose</TH>
                      <TH>ID proof</TH>
                      <TH>In</TH>
                      <TH>Out</TH>
                      <TH>Duration</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {data.items.map((v) => (
                      <TR key={v.id}>
                        <TD>
                          <p className="font-medium text-slate-900">{v.name}</p>
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            <Phone className="h-3 w-3" />
                            {v.phone || '—'}
                            {v.relation ? ` · ${v.relation}` : ''}
                          </p>
                        </TD>
                        <TD>
                          <p className="text-slate-800">{v.hostelerName || 'Unknown'}</p>
                          <p className="text-xs text-slate-500">
                            {v.roomNumber ? `Room ${v.roomNumber}` : ''}
                            {scope === 'all' ? `${v.roomNumber ? ' · ' : ''}${hostelName(v.hostelId)}` : ''}
                          </p>
                        </TD>
                        <TD className="max-w-[180px] truncate">{v.purpose || '—'}</TD>
                        <TD className="text-xs">{v.idProof || '—'}</TD>
                        <TD className="whitespace-nowrap text-xs">{formatDateTime(v.inTime)}</TD>
                        <TD className="whitespace-nowrap text-xs">
                          {v.outTime ? (
                            formatDateTime(v.outTime)
                          ) : (
                            <button onClick={() => checkout(v)} disabled={checkOut.isPending}>
                              <Badge tone="amber">{checkingOut(v) ? 'Checking out…' : 'Inside · check out'}</Badge>
                            </button>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-xs">{duration(v.inTime, v.outTime)}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
                <Pager page={data.page} pages={data.pages} onPage={setPage} busy={historyQ.isFetching} />
              </div>
            )
          }
        </QueryView>
      </Card>

      {addOpen && <NewVisitorModal onClose={() => setAddOpen(false)} />}
    </div>
  )
}

function NewVisitorModal({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const create = useCreateVisitor()
  const [hosteler, setHosteler] = useState<HostelerHit | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relation, setRelation] = useState('Father')
  const [purpose, setPurpose] = useState('')
  const [idType, setIdType] = useState('Aadhaar')
  const [idNo, setIdNo] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hosteler) e.hosteler = 'Select who is being visited'
    if (name.trim().length < 2) e.name = 'Visitor name is required'
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (!digits) e.phone = 'Phone is required'
    else if (!/^[6-9]\d{9}$/.test(digits)) e.phone = 'Enter a valid 10-digit mobile number'
    setErr(e)
    if (Object.keys(e).length || !hosteler) return
    create.mutate(
      {
        hostelerId: hosteler.id,
        name: name.trim(),
        phone: digits,
        relation,
        purpose: purpose.trim(),
        idProof: idNo.trim() ? `${idType} – ${idNo.trim()}` : '',
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New visitor entry"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} icon={<UserCheck className="h-4 w-4" />} loading={create.isPending}>
            Check in visitor
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Visiting hosteler<span className="ml-0.5 text-red-500">*</span>
          </span>
          <HostelerPicker value={hosteler} onChange={setHosteler} hostelId={scope} error={err.hosteler} placeholder="Search by name, phone or login ID…" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visitor name" required error={err.name}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone" required error={err.phone}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label="Relation">
            <Select value={relation} onChange={(e) => setRelation(e.target.value)} options={RELATIONS.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Purpose">
            <Input value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Meeting, dropping items" />
          </Field>
          <Field label="ID proof type">
            <Select value={idType} onChange={(e) => setIdType(e.target.value)} options={ID_TYPES.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="ID number">
            <Input value={idNo} maxLength={60} onChange={(e) => setIdNo(e.target.value)} placeholder="Last 4 digits are enough" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
