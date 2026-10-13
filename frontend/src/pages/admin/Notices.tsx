import { useState, type ReactNode } from 'react'
import { Building2, Globe, Megaphone, MessageCircle, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import { useHostelName, useScope } from '@/store/selectors'
import {
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
  StatusBadge,
  Switch,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatDateTime, titleCase } from '@/lib/utils'
import type { ID, Notice, Priority } from '@/types'
import { HostelSelect, PRIORITIES, Segmented, timeAgo, waShareLink } from './_ops'

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export default function Notices() {
  const scope = useScope()
  const notices = useStore((s) => s.notices)
  const updateNotice = useStore((s) => s.updateNotice)
  const deleteNotice = useStore((s) => s.deleteNotice)
  const orgName = useStore((s) => s.org?.name ?? '')
  const hostelName = useHostelName()
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')

  const visible = notices
    .filter((n) => scope === 'all' || n.hostelId === null || n.hostelId === scope)
    .filter((n) => priority === 'all' || n.priority === priority)
    .filter((n) => !q || n.title.toLowerCase().includes(q.toLowerCase()) || n.body.toLowerCase().includes(q.toLowerCase()))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (a.pinned && b.pinned ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    )
  const pinnedCount = visible.filter((n) => n.pinned).length

  const remove = async (n: Notice) => {
    const ok = await confirm({ title: 'Delete notice?', message: `"${n.title}" will be removed from the notice board.`, confirmText: 'Delete', danger: true })
    if (!ok) return
    deleteNotice(n.id)
    toast.success('Notice deleted')
  }

  const shareText = (n: Notice) =>
    `📢 *${n.title}*${n.priority === 'high' ? ' (Important)' : ''}\n\n${n.body}\n\n— ${n.hostelId ? hostelName(n.hostelId) : orgName || 'Hostel management'}`

  return (
    <div>
      <PageHeader
        title="Notice board"
        subtitle="Announcements shown on the hosteler portal"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New notice
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search notices…" className="sm:w-72" />
          <Select
            className="sm:w-40"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))]}
          />
          <p className="text-sm text-slate-500 sm:ml-auto">
            {visible.length} notice{visible.length === 1 ? '' : 's'}
            {pinnedCount ? ` · ${pinnedCount} pinned` : ''}
          </p>
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="h-6 w-6" />}
            title="No notices"
            description="Post rules, events, maintenance schedules or fee reminders for your hostelers."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                New notice
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((n) => (
            <Card
              key={n.id}
              className={cn(
                'flex flex-col border-l-4',
                n.priority === 'high' ? 'border-l-red-500' : n.priority === 'medium' ? 'border-l-amber-400' : 'border-l-slate-300',
                n.pinned && 'ring-1 ring-brand-200',
              )}
            >
              <div className="flex-1 p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {n.pinned && (
                    <Badge tone="blue">
                      <Pin className="h-3 w-3" /> Pinned
                    </Badge>
                  )}
                  <StatusBadge status={n.priority} label={`${titleCase(n.priority)} priority`} />
                  <Badge tone={n.hostelId ? 'slate' : 'violet'}>
                    {n.hostelId ? <Building2 className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                    {n.hostelId ? hostelName(n.hostelId) : 'All hostels'}
                  </Badge>
                </div>
                <h3 className="text-base font-semibold text-slate-900">{n.title}</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-2.5">
                <span className="text-xs text-slate-400" title={formatDateTime(n.createdAt)}>
                  Posted {timeAgo(n.createdAt)}
                </span>
                <div className="flex items-center gap-1">
                  <a
                    href={waShareLink(shareText(n))}
                    target="_blank"
                    rel="noreferrer"
                    title="Share on WhatsApp"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </a>
                  <IconBtn
                    label={n.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => {
                      updateNotice(n.id, { pinned: !n.pinned })
                      toast.success(n.pinned ? 'Notice unpinned' : 'Notice pinned')
                    }}
                  >
                    {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </IconBtn>
                  <IconBtn label="Edit" onClick={() => setEditing(n)}>
                    <Pencil className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn label="Delete" onClick={() => remove(n)} danger>
                    <Trash2 className="h-4 w-4" />
                  </IconBtn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <NoticeModal notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function IconBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function NoticeModal({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const scope = useScope()
  const addNotice = useStore((s) => s.addNotice)
  const updateNotice = useStore((s) => s.updateNotice)
  const [title, setTitle] = useState(notice?.title ?? '')
  const [body, setBody] = useState(notice?.body ?? '')
  const [target, setTarget] = useState<string>(notice ? notice.hostelId ?? 'all' : scope)
  const [priority, setPriority] = useState<Priority>(notice?.priority ?? 'medium')
  const [pinned, setPinned] = useState(notice?.pinned ?? false)
  const [err, setErr] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Title is required'
    if (!body.trim()) e.body = 'Write the notice text'
    setErr(e)
    if (Object.keys(e).length) return
    const data = {
      title: title.trim(),
      body: body.trim(),
      hostelId: target === 'all' ? null : (target as ID),
      priority,
      pinned,
    }
    if (notice) {
      updateNotice(notice.id, data)
      toast.success('Notice updated')
    } else {
      addNotice(data)
      toast.success('Notice posted')
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={notice ? 'Edit notice' : 'New notice'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{notice ? 'Save changes' : 'Post notice'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required error={err.title}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Water supply off on Sunday" />
        </Field>
        <Field label="Message" required error={err.body}>
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details for hostelers…" />
        </Field>
        <Field label="Show to">
          <HostelSelect value={target} onChange={setTarget} includeAll />
        </Field>
        <div className="flex flex-wrap items-end justify-between gap-4">
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
          <Switch checked={pinned} onChange={setPinned} label="Pin to top" />
        </div>
      </div>
    </Modal>
  )
}
