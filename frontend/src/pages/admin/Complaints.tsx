import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { get } from '@/api/client'
import { useHostelName, useScope } from '@/api/common'
import { useCan } from '@/api/session'
import {
  useAddComplaintComment,
  useAssignees,
  useComplaint,
  useComplaintStats,
  useComplaints,
  useCreateComplaint,
  useDeleteComplaint,
  useUpdateComplaint,
  type ComplaintItem,
  type ComplaintPatch,
} from '@/api/complaints'
import type { ComplaintCategory, ComplaintStatus, ID, ListResponse, Priority, Room } from '@/api/types'
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
  QueryView,
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
} from '@/components/ui'
import { cn, formatDateTime, titleCase } from '@/lib/utils'
import {
  COMPLAINT_CATEGORIES,
  HostelSelect,
  HostelerPicker,
  PRIORITIES,
  Segmented,
  formatDuration,
  timeAgo,
  useDebounced,
  useHostelPicker,
  type HostelerHit,
} from './_ops'

const COLUMNS: { status: ComplaintStatus; label: string; icon: ReactNode; tone: string }[] = [
  { status: 'open', label: 'Open', icon: <AlertCircle className="h-4 w-4 text-red-500" />, tone: 'border-t-red-400' },
  { status: 'in_progress', label: 'In progress', icon: <Loader className="h-4 w-4 text-brand-500" />, tone: 'border-t-brand-500' },
  { status: 'resolved', label: 'Resolved', icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, tone: 'border-t-emerald-500' },
]
const STATUS_OPTIONS = COLUMNS.map((c) => ({ value: c.status, label: c.label }))
const STATUS_LABEL: Record<ComplaintStatus, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export default function Complaints() {
  const scope = useScope()
  const hostelName = useHostelName()
  const [view, setView] = useState<'board' | 'list'>('board')
  const [category, setCategory] = useState<ComplaintCategory | 'all'>('all')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q.trim())
  const [openId, setOpenId] = useState<ID | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [dragId, setDragId] = useState<ID | null>(null)

  const query = useComplaints({
    hostelId: scope,
    category: category === 'all' ? undefined : category,
    priority: priority === 'all' ? undefined : priority,
    q: debouncedQ || undefined,
  })
  const stats = useComplaintStats(scope)
  const update = useUpdateComplaint()

  const filtered = [...(query.data ?? [])].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt),
  )
  const listRows = filtered.filter((c) => statusFilter === 'all' || c.status === statusFilter)
  const selectedFromList = openId ? query.data?.find((c) => c.id === openId) : undefined

  const moveTo = (id: ID, status: ComplaintStatus) => {
    const c = query.data?.find((x) => x.id === id)
    if (!c || c.status === status) return
    update.mutate({ id, body: { status }, success: `"${c.title}" moved to ${STATUS_LABEL[status]}` })
  }

  const where = (c: ComplaintItem) => {
    const parts: string[] = []
    if (c.hostelerId) parts.push(c.hostelerName ?? 'Former hosteler')
    if (c.roomNumber) parts.push(`Room ${c.roomNumber}`)
    if (scope === 'all') parts.push(hostelName(c.hostelId))
    return parts.join(' · ') || 'Common area'
  }

  const st = stats.data

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
        <StatCard label="Open" value={st?.open ?? '—'} icon={<AlertCircle className="h-5 w-5" />} tone="red" />
        <StatCard label="In progress" value={st?.inProgress ?? '—'} icon={<Wrench className="h-5 w-5" />} />
        <StatCard label="Resolved this month" value={st?.resolvedThisMonth ?? '—'} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <StatCard
          label="Avg. resolution time"
          value={st?.avgResolutionHours != null ? formatDuration(st.avgResolutionHours * 3_600_000) : '—'}
          icon={<Timer className="h-5 w-5" />}
          tone="violet"
          hint={st?.resolvedTotal ? `across ${st.resolvedTotal} resolved` : undefined}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search title or hosteler…" className="lg:w-72" />
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
              {
                value: 'board',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Columns3 className="h-4 w-4" />
                    Board
                  </span>
                ),
              },
              {
                value: 'list',
                label: (
                  <span className="flex items-center gap-1.5">
                    <List className="h-4 w-4" />
                    List
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <QueryView query={query}>
        {() =>
          view === 'board' ? (
            <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-3', query.isFetching && 'opacity-80')}>
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
                    className={cn('flex min-w-0 flex-col rounded-xl border border-t-4 border-slate-200 bg-slate-100/60', col.tone)}
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
                      {items.map((c) => {
                        const moving = update.isPending && update.variables?.id === c.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            draggable={!moving}
                            onDragStart={() => setDragId(c.id)}
                            onDragEnd={() => setDragId(null)}
                            onClick={() => setOpenId(c.id)}
                            className={cn(
                              'rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-brand-300 hover:shadow',
                              (dragId === c.id || moving) && 'opacity-50',
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium text-slate-900">{c.title}</p>
                              <StatusBadge status={c.priority} />
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.description}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge tone="blue">{titleCase(c.category)}</Badge>
                              {c.assignedStaffName && <Badge tone="violet">{c.assignedStaffName}</Badge>}
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
                                {c.status === 'resolved' && c.resolvedAt
                                  ? `in ${formatDuration(new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime())}`
                                  : timeAgo(c.createdAt)}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Card>
              {listRows.length === 0 ? (
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
                    {listRows.map((c) => (
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
          )
        }
      </QueryView>

      {openId && <DetailModal id={openId} initial={selectedFromList} onClose={() => setOpenId(null)} />}
      {newOpen && <NewComplaintModal onClose={() => setNewOpen(false)} />}
    </div>
  )
}

function DetailModal({ id, initial, onClose }: { id: ID; initial?: ComplaintItem; onClose: () => void }) {
  const query = useComplaint(id, initial)
  const c = query.data
  const hostelName = useHostelName()
  const assignees = useAssignees(c?.hostelId ?? null)
  const update = useUpdateComplaint()
  const addComment = useAddComplaintComment()
  const remove = useDeleteComplaint()
  const [text, setText] = useState('')

  const patchIt = (body: ComplaintPatch, success: string) => update.mutate({ id, body, success })

  const send = () => {
    if (!text.trim() || addComment.isPending) return
    addComment.mutate({ id, text: text.trim() }, { onSuccess: () => setText('') })
  }

  const doDelete = async () => {
    if (!c) return
    const ok = await confirm({ title: 'Delete complaint?', message: `"${c.title}" and its comments will be permanently deleted.`, confirmText: 'Delete', danger: true })
    if (!ok) return
    remove.mutate(id, { onSuccess: onClose })
  }

  const staffOptions = (assignees.data ?? [])
    .filter((s) => s.active || s.id === c?.assignedStaffId)
    .map((s) => ({ value: s.id, label: `${s.name} (${titleCase(s.role)})${s.active ? '' : ' – inactive'}` }))
  const busy = update.isPending

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={c?.title ?? 'Complaint'}
      description={c ? `Raised ${formatDateTime(c.createdAt)}${c.resolvedAt ? ` · Resolved ${formatDateTime(c.resolvedAt)}` : ''}` : undefined}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-red-600 hover:bg-red-50"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={doDelete}
            loading={remove.isPending}
            disabled={!c}
          >
            Delete
          </Button>
          {c && c.status !== 'resolved' && (
            <Button
              variant="success"
              icon={<CheckCircle2 className="h-4 w-4" />}
              loading={busy && update.variables?.body.status === 'resolved'}
              disabled={busy}
              onClick={() => patchIt({ status: 'resolved' }, 'Marked as resolved')}
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
      <QueryView query={query}>
        {(c) => (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={c.status} />
              <StatusBadge status={c.priority} label={`${titleCase(c.priority)} priority`} />
              <Badge tone="blue">{titleCase(c.category)}</Badge>
              {c.assignedStaffName && <Badge tone="violet">Assigned: {c.assignedStaffName}</Badge>}
            </div>

            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{c.description || 'No description.'}</p>

            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Hosteler</p>
                <p className="mt-1 text-slate-800">{c.hostelerId ? (c.hostelerName ?? 'Former hosteler') : '—'}</p>
                {c.hostelerPhone && (
                  <a href={`tel:${c.hostelerPhone}`} className="text-xs text-slate-500 hover:text-brand-600">
                    {c.hostelerPhone}
                  </a>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room</p>
                <p className="mt-1 text-slate-800">{c.roomNumber ? `Room ${c.roomNumber}` : '—'}</p>
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
                  disabled={busy}
                  onChange={(e) => patchIt({ status: e.target.value as ComplaintStatus }, 'Status updated')}
                  options={STATUS_OPTIONS}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={c.priority}
                  disabled={busy}
                  onChange={(e) => patchIt({ priority: e.target.value as Priority }, 'Priority updated')}
                  options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
                />
              </Field>
              <Field label="Assign to" hint={assignees.data && !staffOptions.length ? 'Add staff on the Staff page' : undefined}>
                <Select
                  value={c.assignedStaffId ?? ''}
                  disabled={busy || assignees.isLoading}
                  onChange={(e) => {
                    const v = e.target.value || null
                    patchIt(
                      { assignedStaffId: v, ...(v && c.status === 'open' ? { status: 'in_progress' as ComplaintStatus } : {}) },
                      v ? 'Staff assigned' : 'Unassigned',
                    )
                  }}
                  placeholder="Unassigned"
                  options={staffOptions}
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
                          {cm.byKind === 'hosteler' && <span className="ml-1 text-slate-400">(hosteler)</span>}
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
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Write an update for the hosteler…"
                />
                <Button icon={<Send className="h-4 w-4" />} onClick={send} loading={addComment.isPending} disabled={!text.trim()}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        )}
      </QueryView>
    </Modal>
  )
}

function useRoomOptions(hostelId: ID | null) {
  const can = useCan()
  return useQuery({
    queryKey: ['rooms', 'options', hostelId],
    queryFn: async () => (await get<ListResponse<Room>>('/rooms', { hostelId })).items,
    enabled: !!hostelId && can('rooms'),
    staleTime: 60_000,
  })
}

function NewComplaintModal({ onClose }: { onClose: () => void }) {
  const { hostelId: defaultHostel } = useHostelPicker()
  const create = useCreateComplaint()
  const [hostelId, setHostelId] = useState('')
  const [hosteler, setHosteler] = useState<HostelerHit | null>(null)
  const [roomId, setRoomId] = useState('')
  const [category, setCategory] = useState<ComplaintCategory>('electrical')
  const [priority, setPriority] = useState<Priority>('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})

  const hid = hostelId || defaultHostel || ''
  const rooms = useRoomOptions(hid || null)
  const roomOptions = [...(rooms.data ?? [])]
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => ({ value: r.id, label: `Room ${r.number}` }))

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hid) e.hostel = 'Select a hostel'
    if (title.trim().length < 3) e.title = 'Title must be at least 3 characters'
    setErr(e)
    if (Object.keys(e).length) return
    create.mutate(
      {
        hostelId: hid,
        hostelerId: hosteler?.id ?? null,
        roomId: roomId || null,
        category,
        priority,
        title: title.trim(),
        description: description.trim(),
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New complaint"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Create complaint
          </Button>
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
                setHosteler(null)
                setRoomId('')
              }}
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
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Hosteler <span className="font-normal text-slate-400">(optional – leave empty if staff reported)</span>
          </span>
          {hid ? (
            <HostelerPicker
              value={hosteler}
              hostelId={hid}
              onChange={(h) => {
                setHosteler(h)
                if (h?.roomId) setRoomId(h.roomId)
              }}
            />
          ) : (
            <p className="text-sm text-slate-400">Select a hostel first</p>
          )}
        </div>
        <Field label="Room" hint="Optional">
          <Select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={rooms.isLoading ? 'Loading rooms…' : '— Common area —'}
            options={roomOptions}
          />
        </Field>
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
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fan not working" />
        </Field>
        <Field label="Description">
          <Textarea value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="Details that help the staff fix it…" />
        </Field>
      </div>
    </Modal>
  )
}
