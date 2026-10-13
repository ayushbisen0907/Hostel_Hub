import { useMemo, useState } from 'react'
import {
  Armchair,
  Check,
  ChevronDown,
  CircleHelp,
  Droplets,
  MessageCircle,
  MessageSquareWarning,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  UtensilsCrossed,
  Wifi,
  Zap,
} from 'lucide-react'
import { useCommentOnComplaint, useMyComplaints, useRaiseComplaint } from '@/api/portal'
import type { Complaint, ComplaintCategory, ComplaintStatus, Priority } from '@/api/types'
import { Badge, Button, Card, EmptyState, Field, Input, QueryView, StatusBadge, Tabs, Textarea } from '@/components/ui'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { PortalTitle, SectionTitle } from './_shared'

const CATEGORIES: { value: ComplaintCategory; label: string; icon: typeof Zap; tone: string }[] = [
  { value: 'electrical', label: 'Electrical', icon: Zap, tone: 'text-amber-600 bg-amber-50' },
  { value: 'plumbing', label: 'Plumbing', icon: Droplets, tone: 'text-sky-600 bg-sky-50' },
  { value: 'internet', label: 'Wi-Fi', icon: Wifi, tone: 'text-violet-600 bg-violet-50' },
  { value: 'cleaning', label: 'Cleaning', icon: Sparkles, tone: 'text-emerald-600 bg-emerald-50' },
  { value: 'furniture', label: 'Furniture', icon: Armchair, tone: 'text-orange-600 bg-orange-50' },
  { value: 'food', label: 'Food', icon: UtensilsCrossed, tone: 'text-rose-600 bg-rose-50' },
  { value: 'security', label: 'Security', icon: ShieldAlert, tone: 'text-red-600 bg-red-50' },
  { value: 'other', label: 'Other', icon: CircleHelp, tone: 'text-slate-600 bg-slate-100' },
]
const CAT = new Map(CATEGORIES.map((c) => [c.value, c]))

const PRIORITIES: { value: Priority; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'Can wait' },
  { value: 'medium', label: 'Medium', hint: 'Soon' },
  { value: 'high', label: 'High', hint: 'Urgent' },
]

const STEPS: { status: ComplaintStatus; label: string }[] = [
  { status: 'open', label: 'Raised' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'resolved', label: 'Resolved' },
]

function Timeline({ c }: { c: Complaint }) {
  const idx = STEPS.findIndex((s) => s.status === c.status)
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i <= idx
        return (
          <div key={s.status} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? (c.status === 'resolved' ? 'bg-emerald-500 text-white' : 'bg-brand-600 text-white') : 'bg-slate-200 text-slate-500',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('mt-1 whitespace-nowrap text-[11px]', done ? 'font-medium text-slate-700' : 'text-slate-400')}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('mx-1 mb-4 h-0.5 flex-1 rounded', i < idx ? (c.status === 'resolved' ? 'bg-emerald-500' : 'bg-brand-600') : 'bg-slate-200')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ComplaintCard({ c }: { c: Complaint }) {
  const addComment = useCommentOnComplaint()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const cat = CAT.get(c.category) ?? CATEGORIES[CATEGORIES.length - 1]!
  const Icon = cat.icon

  const send = () => {
    const t = text.trim()
    if (!t || addComment.isPending) return
    addComment.mutate({ id: c.id, text: t }, { onSuccess: () => setText('') })
  }

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-4 text-left">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', cat.tone)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-slate-900">{c.title}</p>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {cat.label} · {formatDate(c.createdAt)}
            {c.comments.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-0.5">
                <MessageCircle className="h-3 w-3" /> {c.comments.length}
              </span>
            )}
          </p>
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      <div className="px-4 pb-4">
        <Timeline c={c} />
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={c.priority} label={`${c.priority[0]!.toUpperCase()}${c.priority.slice(1)} priority`} />
            {c.resolvedAt && <Badge tone="green">Resolved {formatDate(c.resolvedAt)}</Badge>}
          </div>
          {c.description && <p className="whitespace-pre-line text-sm text-slate-700">{c.description}</p>}

          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Conversation</p>
          {c.comments.length === 0 ? (
            <p className="text-sm text-slate-500">No comments yet. The warden will update you here.</p>
          ) : (
            <ul className="space-y-2">
              {c.comments.map((cm, i) => {
                const mine = cm.byKind === 'hosteler'
                return (
                  <li key={cm.id ?? i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                        mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-700',
                      )}
                    >
                      {!mine && <p className="text-xs font-semibold text-slate-900">{cm.by}</p>}
                      <p className="whitespace-pre-line">{cm.text}</p>
                      <p className={cn('mt-0.5 text-[10px]', mine ? 'text-white/70' : 'text-slate-400')}>{formatDateTime(cm.at)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={c.status === 'resolved' ? 'Still an issue? Add a comment…' : 'Add a comment…'}
              className="h-11 rounded-xl"
              maxLength={1000}
            />
            <Button
              onClick={send}
              disabled={!text.trim()}
              loading={addComment.isPending}
              icon={addComment.isPending ? undefined : <Send className="h-4 w-4" />}
              className="h-11 rounded-xl"
              aria-label="Send comment"
            />
          </div>
        </div>
      )}
    </Card>
  )
}

type Filter = 'active' | 'resolved' | 'all'

export default function Complaints() {
  const complaintsQ = useMyComplaints()
  const raise = useRaiseComplaint()

  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState<ComplaintCategory | ''>('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>('active')

  const mine = useMemo(() => [...(complaintsQ.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [complaintsQ.data])

  const active = mine.filter((c) => c.status !== 'resolved')
  const resolved = mine.filter((c) => c.status === 'resolved')
  const list = filter === 'active' ? active : filter === 'resolved' ? resolved : mine

  const submit = () => {
    const e: Record<string, string> = {}
    if (!category) e.category = 'Choose a category'
    if (title.trim().length < 3) e.title = 'Give a short title (at least 3 characters)'
    if (description.trim().length > 2000) e.description = 'Keep the details under 2000 characters'
    setErrors(e)
    if (Object.keys(e).length) return
    raise.mutate(
      { category: category as ComplaintCategory, priority, title: title.trim(), description: description.trim() },
      {
        onSuccess: () => {
          setCategory('')
          setPriority('medium')
          setTitle('')
          setDescription('')
          setShowForm(false)
          setFilter('active')
        },
      },
    )
  }

  return (
    <div className="pb-4">
      <PortalTitle
        title="Help & complaints"
        subtitle="Something broken? Let us know and track the fix."
        action={
          !showForm && (
            <Button onClick={() => setShowForm(true)} icon={<Plus className="h-4 w-4" />} className="rounded-xl">
              New
            </Button>
          )
        }
      />

      {showForm && (
        <Card className="mb-2 p-4">
          <p className="mb-3 font-semibold text-slate-900">Raise a complaint</p>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">
                Category<span className="ml-0.5 text-red-500">*</span>
              </p>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2.5 text-xs font-medium transition active:scale-95',
                      category === c.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', c.tone)}>
                      <c.icon className="h-4 w-4" />
                    </span>
                    {c.label}
                  </button>
                ))}
              </div>
              {errors.category && <p className="mt-1 text-xs text-red-600">{errors.category}</p>}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Priority</p>
              <div className="grid grid-cols-3 gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      'rounded-xl border-2 px-2 py-2 text-sm font-medium transition',
                      priority === p.value
                        ? p.value === 'high'
                          ? 'border-red-500 bg-red-50 text-red-700'
                          : p.value === 'medium'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-slate-500 bg-slate-50 text-slate-700'
                        : 'border-slate-200 text-slate-600',
                    )}
                  >
                    {p.label}
                    <span className="block text-[11px] font-normal opacity-70">{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <Field label="Title" required error={errors.title}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fan not working" maxLength={80} />
            </Field>
            <Field label="Details" error={errors.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem, since when, and anything that helps us fix it faster."
                rows={4}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" size="lg" className="flex-1 rounded-xl" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button size="lg" className="flex-1 rounded-xl" onClick={submit} loading={raise.isPending}>
                Submit
              </Button>
            </div>
          </div>
        </Card>
      )}

      <SectionTitle>My complaints</SectionTitle>
      <Tabs<Filter>
        className="mb-3"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'active', label: 'Active', count: active.length },
          { value: 'resolved', label: 'Resolved', count: resolved.length },
          { value: 'all', label: 'All', count: mine.length },
        ]}
      />
      <QueryView query={complaintsQ}>
        {() =>
      list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquareWarning className="h-5 w-5" />}
            title={filter === 'active' ? 'No active complaints' : 'Nothing here'}
            description="Raise a complaint whenever something needs fixing."
            action={
              !showForm && (
                <Button variant="outline" onClick={() => setShowForm(true)} icon={<Plus className="h-4 w-4" />}>
                  Raise complaint
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <ComplaintCard key={c.id} c={c} />
          ))}
        </div>
      )
        }
      </QueryView>
    </div>
  )
}
