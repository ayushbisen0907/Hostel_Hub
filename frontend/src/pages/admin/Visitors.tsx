import { useEffect, useMemo, useState } from 'react'
import { Clock, Download, History, LogOut, Phone, Plus, UserCheck, Users, DoorOpen } from 'lucide-react'
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
  Table,
  TD,
  TH,
  THead,
  TR,
  confirm,
  toast,
} from '@/components/ui'
import { cn, downloadCsv, formatDate, formatDateTime, today } from '@/lib/utils'
import type { ID } from '@/types'
import { formatDuration, useBedLabeler } from './_ops'

const RELATIONS = ['Father', 'Mother', 'Brother', 'Sister', 'Relative', 'Friend', 'Guardian', 'Other']
const ID_TYPES = ['Aadhaar', 'Driving licence', 'Voter ID', 'PAN', 'Passport', 'College ID', 'Other']

function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export default function Visitors() {
  const scope = useScope()
  const visitors = useStore((s) => s.visitors)
  const checkoutVisitor = useStore((s) => s.checkoutVisitor)
  const hMap = useHostelerMap()
  const hostelName = useHostelName()
  const beds = useBedLabeler()
  const now = useNow()
  const [addOpen, setAddOpen] = useState(false)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const scoped = useMemo(() => visitors.filter((v) => inScope(v.hostelId, scope)), [visitors, scope])
  const inside = scoped.filter((v) => !v.outTime).sort((a, b) => a.inTime.localeCompare(b.inTime))
  const t = today()
  const todayCount = scoped.filter((v) => formatDate(v.inTime, 'yyyy-MM-dd') === t).length
  const month = t.slice(0, 7)
  const monthCount = scoped.filter((v) => formatDate(v.inTime, 'yyyy-MM') === month).length
  const done = scoped.filter((v) => v.outTime)
  const avgMs = done.length ? done.reduce((a, v) => a + (new Date(v.outTime!).getTime() - new Date(v.inTime).getTime()), 0) / done.length : 0

  const history = scoped
    .filter((v) => {
      const d = formatDate(v.inTime, 'yyyy-MM-dd')
      return (!from || d >= from) && (!to || d <= to)
    })
    .filter((v) => {
      if (!q) return true
      const s = q.toLowerCase()
      const h = hMap.get(v.hostelerId)
      return v.name.toLowerCase().includes(s) || v.phone.includes(s) || (h?.name ?? '').toLowerCase().includes(s) || v.purpose.toLowerCase().includes(s)
    })
    .sort((a, b) => b.inTime.localeCompare(a.inTime))

  const checkout = async (id: ID, name: string) => {
    const ok = await confirm({ title: `Check out ${name}?`, message: 'The current time will be recorded as the exit time.', confirmText: 'Check out' })
    if (!ok) return
    checkoutVisitor(id)
    toast.success(`${name} checked out`)
  }

  const duration = (inTime: string, outTime: string | null) =>
    formatDuration((outTime ? new Date(outTime).getTime() : now) - new Date(inTime).getTime())

  const exportCsv = () => {
    downloadCsv(`visitors-${t}.csv`, [
      ['Visitor', 'Phone', 'Relation', 'Visiting', 'Room', 'Hostel', 'Purpose', 'ID proof', 'In', 'Out', 'Duration'],
      ...history.map((v) => {
        const h = hMap.get(v.hostelerId)
        return [
          v.name,
          v.phone,
          v.relation,
          h?.name ?? '',
          h ? beds.room(h.roomId) : '',
          hostelName(v.hostelId),
          v.purpose,
          v.idProof,
          formatDateTime(v.inTime),
          v.outTime ? formatDateTime(v.outTime) : 'Inside',
          duration(v.inTime, v.outTime),
        ]
      }),
    ])
    toast.success('Visitor log exported')
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
        <StatCard label="Inside now" value={inside.length} icon={<DoorOpen className="h-5 w-5" />} tone="amber" />
        <StatCard label="Visitors today" value={todayCount} icon={<UserCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="This month" value={monthCount} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Avg. visit duration" value={done.length ? formatDuration(avgMs) : '—'} icon={<Clock className="h-5 w-5" />} tone="violet" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Currently inside" subtitle={inside.length ? `${inside.length} visitor${inside.length > 1 ? 's' : ''} on premises` : 'No visitors on premises'} />
        {inside.length === 0 ? (
          <EmptyState icon={<DoorOpen className="h-6 w-6" />} title="Nobody inside" description="New visitor entries will appear here until they are checked out." />
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {inside.map((v) => {
              const h = hMap.get(v.hostelerId)
              const long = now - new Date(v.inTime).getTime() > 3 * 3600000
              return (
                <li key={v.id} className={cn('rounded-xl border p-4', long ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200')}>
                  <div className="flex items-start gap-3">
                    <Avatar name={v.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{v.name}</p>
                      <p className="text-xs text-slate-500">
                        {v.relation} of <span className="font-medium text-slate-700">{h?.name ?? 'Unknown'}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {h ? beds.label(h.roomId, h.bedId) : ''}
                        {scope === 'all' ? ` · ${hostelName(v.hostelId)}` : ''}
                      </p>
                    </div>
                    <Badge tone={long ? 'amber' : 'green'}>{duration(v.inTime, null)}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>In at {formatDate(v.inTime, 'hh:mm a')}{v.purpose ? ` · ${v.purpose}` : ''}</span>
                    <Button size="sm" variant="outline" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => checkout(v.id, v.name)}>
                      Check out
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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
          <Button variant="outline" className="lg:ml-auto" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!history.length}>
            Export CSV
          </Button>
        </div>
        {history.length === 0 ? (
          <EmptyState icon={<History className="h-6 w-6" />} title="No visitor records" />
        ) : (
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
              {history.map((v) => {
                const h = hMap.get(v.hostelerId)
                return (
                  <TR key={v.id}>
                    <TD>
                      <p className="font-medium text-slate-900">{v.name}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="h-3 w-3" />
                        {v.phone || '—'} · {v.relation}
                      </p>
                    </TD>
                    <TD>
                      <p className="text-slate-800">{h?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-500">
                        {h?.roomId ? `Room ${beds.room(h.roomId)}` : ''}
                        {scope === 'all' ? `${h?.roomId ? ' · ' : ''}${hostelName(v.hostelId)}` : ''}
                      </p>
                    </TD>
                    <TD className="max-w-[180px] truncate">{v.purpose || '—'}</TD>
                    <TD className="text-xs">{v.idProof || '—'}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(v.inTime)}</TD>
                    <TD className="whitespace-nowrap text-xs">
                      {v.outTime ? (
                        formatDateTime(v.outTime)
                      ) : (
                        <button onClick={() => checkout(v.id, v.name)}>
                          <Badge tone="amber">Inside · check out</Badge>
                        </button>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{duration(v.inTime, v.outTime)}</TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <NewVisitorModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function NewVisitorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scoped = useScopedHostelers()
  const addVisitor = useStore((s) => s.addVisitor)
  const beds = useBedLabeler()
  const hostelName = useHostelName()
  const scope = useScope()
  const [search, setSearch] = useState('')
  const [hostelerId, setHostelerId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relation, setRelation] = useState('Father')
  const [purpose, setPurpose] = useState('')
  const [idType, setIdType] = useState('Aadhaar')
  const [idNo, setIdNo] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})

  const active = scoped.filter((h) => h.status === 'active')
  const matches = active
    .filter((h) => {
      if (!search) return true
      const s = search.toLowerCase()
      return h.name.toLowerCase().includes(s) || h.phone.includes(s) || beds.room(h.roomId).includes(s)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8)
  const selected = active.find((h) => h.id === hostelerId)

  const reset = () => {
    setSearch('')
    setHostelerId('')
    setName('')
    setPhone('')
    setRelation('Father')
    setPurpose('')
    setIdType('Aadhaar')
    setIdNo('')
    setErr({})
  }
  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hostelerId) e.hosteler = 'Select who is being visited'
    if (!name.trim()) e.name = 'Visitor name is required'
    const digits = phone.replace(/\D/g, '')
    if (!digits) e.phone = 'Phone is required'
    else if (digits.length < 10) e.phone = 'Enter a valid phone number'
    setErr(e)
    if (Object.keys(e).length) return
    addVisitor({
      hostelerId,
      name: name.trim(),
      phone: phone.trim(),
      relation,
      purpose: purpose.trim(),
      idProof: idNo.trim() ? `${idType} – ${idNo.trim()}` : '',
    })
    toast.success(`${name.trim()} checked in`)
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="New visitor entry"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} icon={<UserCheck className="h-4 w-4" />}>
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
          {selected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={selected.name} src={selected.photo} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{selected.name}</p>
                  <p className="text-xs text-slate-500">
                    {beds.label(selected.roomId, selected.bedId)}
                    {scope === 'all' ? ` · ${hostelName(selected.hostelId)}` : ''}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setHostelerId('')}>
                Change
              </Button>
            </div>
          ) : (
            <div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search by name, phone or room…" />
              <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {matches.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">No hostelers found</li>}
                {matches.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setHostelerId(h.id)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <Avatar name={h.name} src={h.photo} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                        <p className="text-xs text-slate-500">
                          {beds.label(h.roomId, h.bedId)}
                          {scope === 'all' ? ` · ${hostelName(h.hostelId)}` : ''}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {err.hosteler && <span className="mt-1 block text-xs text-red-600">{err.hosteler}</span>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Visitor name" required error={err.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone" required error={err.phone}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label="Relation">
            <Select value={relation} onChange={(e) => setRelation(e.target.value)} options={RELATIONS.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Purpose">
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Meeting, dropping items" />
          </Field>
          <Field label="ID proof type">
            <Select value={idType} onChange={(e) => setIdType(e.target.value)} options={ID_TYPES.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="ID number">
            <Input value={idNo} onChange={(e) => setIdNo(e.target.value)} placeholder="Last 4 digits are enough" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
