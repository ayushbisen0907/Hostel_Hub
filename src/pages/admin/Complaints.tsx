import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Columns3,
  List,
  Loader,
  MessageSquare,
  Plus,
  Send,
  Timer,
  Trash2,
  User,
  Wrench,
} from 'lucide-react'
import { useStore } from '@/store'
import { inScope, useHostelName, useHostelerMap, useRoomMap, useScope } from '@/store/selectors'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Table,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatDateTime, titleCase, today } from '@/lib/utils'
import type { Complaint, ComplaintCategory, ComplaintStatus, ID, Priority } from '@/types'
import { COMPLAINT_CATEGORIES, HostelSelect, PRIORITIES, Segmented, formatDuration, timeAgo, useHostelPicker } from './_ops'

const COLUMNS: { status: ComplaintStatus; label: string; icon: ReactNode; tone: string }[] = [
  { status: 'open', label: 'Open', icon: <AlertCircle className="h-4 w-4 text-red-500" />, tone: 'border-t-red-400' },
  { status: 'in_progress', label: 'In progress', icon: <Loader className="h-4 w-4 text-brand-500" />, tone: 'border-t-brand-500' },
  { status: 'resolved', label: 'Resolved', icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, tone: 'border-t-emerald-500' },
]
const STATUS_OPTIONS = COLUMNS.map((c) => ({ value: c.status, label: c.label }))
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export default function Complaints() {
  const scope = useScope()
  const complaints = useStore((s) => s.complaints)
  const updateComplaint = useStore((s) => s.updateComplaint)
  const hMap = useHostelerMap()
  const roomMap = useRoomMap()
  const hostelName = useHostelName()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [category, setCategory] = useState<ComplaintCategory | 'all'>('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<ID | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [dragId, setDragId] = useState<ID | null>(null)

  const scoped = useMemo(() => complaints.filter((c) => inScope(c.hostelId, scope)), [complaints, scope])
  const filtered = scoped
    .filter((c) => category === 'all' || c.category === category)
    .filter((c) => priority === 'all' || c.priority === priority)
    .filter((c) => {
      if (!q) return true
      const s = q.toLowerCase()
      return (
        c.title.toLowerCase().includes(s) ||
        c.description.toLowerCase().includes(s) ||
        (c.hostelerId ? (hMap.get(c.hostelerId)?.name ?? '').toLowerCase().includes(s) : false) ||
        (c.roomId ? (roomMap.get(c.roomId)?.number ?? '').includes(s) : false)
      )
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt))

  const month = today().slice(0, 7)
  const openCount = scoped.filter((c) => c.status === 'open').length
  const progressCount = scoped.filter((c) => c.status === 'in_progress').length
  const resolvedMonth = scoped.filter((c) => c.status === 'resolved' && c.resolvedAt && c.resolvedAt.slice(0, 7) === month).length
  const resolved = scoped.filter((c) => c.status === 'resolved' && c.resolvedAt)
  const avgMs = resolved.length
    ? resolved.reduce((a, c) => a + (new Date(c.resolvedAt!).getTime() - new Date(c.createdAt).getTime()), 0) / resolved.length
    : 0

  const selected = openId ? complaints.find((c) => c.id === openId) ?? null : null

  const moveTo = (id: ID, status: ComplaintStatus) => {
    const c = complaints.find((x) => x.id === id)
    if (!c || c.status === status) return
    updateComplaint(id, { status })
    toast.success(`"${c.title}" moved to ${titleCase(status)}`)
  }

  const where = (c: Complaint) => {
    const parts: string[] = []
    if (c.hostelerId) parts.push(hMap.get(c.hostelerId)?.name ?? 'Former hosteler')
    if (c.roomId) parts.push(`Room ${roomMap.get(c.roomId)?.number ?? '?'}`)
    if (scope === 'all') parts.push(hostelName(c.hostelId))
    return parts.join(' · ') || 'Common area'
  }

  return (
    <div>
      <PageHeader
        title="Complaints"
        subtitle="Track maintenance and service issues to resolution"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
            New complaint
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={openCount} icon={<AlertCircle className="h-5 w-5" />} tone="red" />
        <StatCard label="In progress" value={progressCount} icon={<Wrench className="h-5 w-5" />} />
        <StatCard label="Resolved this month" value={resolvedMonth} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <StatCard
          label="Avg. resolution time"
          value={resolved.length ? formatDuration(avgMs) : '—'}
          icon={<Timer className="h-5 w-5" />}
          tone="violet"
          hint={resolved.length ? `across ${resolved.length} resolved` : undefined}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search title, hosteler, room…" className="lg:w-72" />
          <Select
            className="lg:w-40"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            options={[{ value: 'all', label: 'All categories' }, ...COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))]}
          />
          <Select
            className="lg:w-36"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))]}
          />
          {view === 'list' && (
            <Select
              className="lg:w-36"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              options={[{ value: 'all', label: 'All statuses' }, ...STATUS_OPTIONS]}
            />
          )}
          <Segmented
            className="lg:ml-auto"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: <span className="flex items-center gap-1.5"><Columns3 className="h-4 w-4" />Board</span> },
              { value: 'list', label: <span className="flex items-center gap-1.5"><List className="h-4 w-4" />List</span> },
            ]}
          />
        </div>
      </Card>

      {view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = filtered.filter((c) => c.status === col.status)
            return (
              <div
                key={col.status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) moveTo(dragId, col.status)
                  setDragId(null)
                }}
                className={cn('flex flex-col rounded-xl border border-t-4 border-slate-200 bg-slate-100/60', col.tone)}
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {col.icon}
                    {col.label}
                  </p>
                  <Badge>{items.length}</Badge>
                </div>
                <div className="flex max-h-[70vh] min-h-[120px] flex-col gap-2 overflow-y-auto px-3 pb-3">
                  {items.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Nothing here</p>}
                  {items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setOpenId(c.id)}
                      className={cn(
                        'rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-300 hover:shadow',
                        dragId === c.id && 'opacity-50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{c.title}</p>
                        <StatusBadge status={c.priority} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone="blue">{titleCase(c.category)}</Badge>
                        {c.comments.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                            <MessageSquare className="h-3 w-3" />
                            {c.comments.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="flex min-w-0 items-center gap-1">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{where(c)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {c.status === 'resolved' && c.resolvedAt ? `in ${formatDuration(new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime())}` : timeAgo(c.createdAt)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          {filtered.filter((c) => statusFilter === 'all' || c.status === statusFilter).length === 0 ? (
            <EmptyState icon={<Wrench className="h-6 w-6" />} title="No complaints" description="All clear! New complaints from hostelers appear here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Complaint</TH>
                  <TH>Category</TH>
                  <TH>Priority</TH>
                  <TH>Raised by</TH>
                  <TH>Age</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {filtered
                  .filter((c) => statusFilter === 'all' || c.status === statusFilter)
                  .map((c) => (
                    <TR key={c.id} onClick={() => setOpenId(c.id)}>
                      <TD className="max-w-xs">
                        <p className="truncate font-medium text-slate-900">{c.title}</p>
                        <p className="truncate text-xs text-slate-500">{c.description}</p>
                      </TD>
                      <TD>{titleCase(c.category)}</TD>
                      <TD>
                        <StatusBadge status={c.priority} />
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{where(c)}</TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">{timeAgo(c.createdAt)}</TD>
                      <TD>
                        <StatusBadge status={c.status} />
                      </TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {selected && <DetailModal complaint={selected} onClose={() => setOpenId(null)} />}
      <NewComplaintModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}

function DetailModal({ complaint: c, onClose }: { complaint: Complaint; onClose: () => void }) {
  const staff = useStore((s) => s.staff)
  const updateComplaint = useStore((s) => s.updateComplaint)
  const addComment = useStore((s) => s.addComplaintComment)
  const deleteComplaint = useStore((s) => s.deleteComplaint)
  const hMap = useHostelerMap()
  const roomMap = useRoomMap()
  const hostelName = useHostelName()
  const [text, setText] = useState('')

  const h = c.hostelerId ? hMap.get(c.hostelerId) : undefined
  const hostelStaff = staff.filter((s) => s.hostelId === c.hostelId && (s.active || s.id === c.assignedStaffId))
  const assigned = staff.find((s) => s.id === c.assignedStaffId)

  const send = () => {
    if (!text.trim()) return
    addComment(c.id, 'Admin', text.trim())
    setText('')
  }

  const remove = async () => {
    const ok = await confirm({ title: 'Delete complaint?', message: `"${c.title}" and its comments will be permanently deleted.`, confirmText: 'Delete', danger: true })
    if (!ok) return
    deleteComplaint(c.id)
    toast.success('Complaint deleted')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={c.title}
      description={`Raised ${formatDateTime(c.createdAt)}${c.resolvedAt ? ` · Resolved ${formatDateTime(c.resolvedAt)}` : ''}`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
            Delete
          </Button>
          {c.status !== 'resolved' && (
            <Button
              variant="success"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={() => {
                updateComplaint(c.id, { status: 'resolved' })
                toast.success('Marked as resolved')
              }}
            >
              Mark resolved
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={c.status} />
          <StatusBadge status={c.priority} label={`${titleCase(c.priority)} priority`} />
          <Badge tone="blue">{titleCase(c.category)}</Badge>
          {assigned && <Badge tone="violet">Assigned: {assigned.name}</Badge>}
        </div>

        <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{c.description || 'No description.'}</p>

        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hosteler</p>
            <p className="mt-1 text-slate-800">{h?.name ?? '—'}</p>
            {h && <p className="text-xs text-slate-500">{h.phone}</p>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room</p>
            <p className="mt-1 text-slate-800">{c.roomId ? `Room ${roomMap.get(c.roomId)?.number ?? '?'}` : '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hostel</p>
            <p className="mt-1 text-slate-800">{hostelName(c.hostelId)}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status">
            <Select
              value={c.status}
              onChange={(e) => {
                updateComplaint(c.id, { status: e.target.value as ComplaintStatus })
                toast.success('Status updated')
              }}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="Priority">
            <Select
              value={c.priority}
              onChange={(e) => updateComplaint(c.id, { priority: e.target.value as Priority })}
              options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
            />
          </Field>
          <Field label="Assign to">
            <Select
              value={c.assignedStaffId ?? ''}
              onChange={(e) => {
                const v = e.target.value || null
                updateComplaint(c.id, {
                  assignedStaffId: v,
                  ...(v && c.status === 'open' ? { status: 'in_progress' as ComplaintStatus } : {}),
                })
                toast.success(v ? 'Staff assigned' : 'Unassigned')
              }}
              placeholder="Unassigned"
              options={hostelStaff.map((s) => ({ value: s.id, label: `${s.name} (${titleCase(s.role)})` }))}
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MessageSquare className="h-4 w-4" /> Comments ({c.comments.length})
          </p>
          {c.comments.length === 0 ? (
            <p className="text-sm text-slate-400">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {c.comments.map((cm) => (
                <li key={cm.id} className="flex gap-3">
                  <Avatar name={cm.by} size="sm" />
                  <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs">
                      <span className="font-semibold text-slate-800">{cm.by}</span>
                      <span className="ml-2 text-slate-400">{formatDateTime(cm.at)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{cm.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Write an update for the hosteler…"
            />
            <Button icon={<Send className="h-4 w-4" />} onClick={send} disabled={!text.trim()}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function NewComplaintModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hostelId: defaultHostel } = useHostelPicker()
  const hostelers = useStore((s) => s.hostelers)
  const rooms = useStore((s) => s.rooms)
  const addComplaint = useStore((s) => s.addComplaint)
  const [hostelId, setHostelId] = useState('')
  const [hostelerId, setHostelerId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [category, setCategory] = useState<ComplaintCategory>('electrical')
  const [priority, setPriority] = useState<Priority>('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})

  const hid = hostelId || defaultHostel
  const hostelHostelers = hostelers.filter((h) => h.hostelId === hid && h.status === 'active').sort((a, b) => a.name.localeCompare(b.name))
  const hostelRooms = rooms.filter((r) => r.hostelId === hid).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))

  const reset = () => {
    setHostelId('')
    setHostelerId('')
    setRoomId('')
    setCategory('electrical')
    setPriority('medium')
    setTitle('')
    setDescription('')
    setErr({})
  }
  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hid) e.hostel = 'Select a hostel'
    if (!title.trim()) e.title = 'Title is required'
    setErr(e)
    if (Object.keys(e).length) return
    addComplaint({
      hostelId: hid,
      hostelerId: hostelerId || null,
      roomId: roomId || null,
      category,
      priority,
      title: title.trim(),
      description: description.trim(),
    })
    toast.success('Complaint logged')
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New complaint"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit}>Create complaint</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hostel" required error={err.hostel}>
            <HostelSelect
              value={hid}
              onChange={(v) => {
                setHostelId(v)
                setHostelerId('')
                setRoomId('')
              }}
            />
          </Field>
          <Field label="Hosteler" hint="Optional">
            <Select
              value={hostelerId}
              onChange={(e) => {
                const v = e.target.value
                setHostelerId(v)
                const h = hostelers.find((x) => x.id === v)
                if (h?.roomId) setRoomId(h.roomId)
              }}
              placeholder="— None / staff reported —"
              options={hostelHostelers.map((h) => ({ value: h.id, label: h.name }))}
            />
          </Field>
          <Field label="Room" hint="Optional">
            <Select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="— Common area —"
              options={hostelRooms.map((r) => ({ value: r.id, label: `Room ${r.number}` }))}
            />
          </Field>
          <Field label="Category" required>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
              options={COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))}
            />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Priority</span>
          <Segmented<Priority>
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium', activeClass: 'bg-amber-500 text-white shadow-sm' },
              { value: 'high', label: 'High', activeClass: 'bg-red-600 text-white shadow-sm' },
            ]}
          />
        </div>
        <Field label="Title" required error={err.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fan not working" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details that help the staff fix it…" />
        </Field>
      </div>
    </Modal>
  )
}
