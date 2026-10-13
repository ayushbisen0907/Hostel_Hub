import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowRight,
  BedDouble,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  FileText,
  IndianRupee,
  LogIn,
  Megaphone,
  MessageSquareWarning,
  Receipt,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useHostels, useOrg, useScope, useScopeStore } from '@/api/common'
import { useCan, useStaffSession } from '@/api/session'
import { useDashboard, useDecideLeave, useQuickExpense, useQuickNotice, type DashboardData, type DashboardHosteler } from '@/api/dashboard'
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/api/expenses'
import type { Activity, Hostel, Meal, PaymentMode, Plan, Priority } from '@/api/types'
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Switch,
  Textarea,
} from '@/components/ui'
import { hasModule } from '@/lib/plans'
import { cn, formatDate, formatDateTime, formatMoney, formatMonth, titleCase, today } from '@/lib/utils'

const C_COLLECTED = '#2554eb'
const C_EXPENSE = '#f59e0b'
const C_VACANT = '#e2e8f0'

const PAYMENT_MODES: PaymentMode[] = ['cash', 'upi', 'card', 'bank', 'online']

/** Next meal to be served based on the local time of day. */
function nextMeal(): { meal: Meal; date: string } {
  const h = new Date().getHours()
  if (h < 10) return { meal: 'breakfast', date: today() }
  if (h < 15) return { meal: 'lunch', date: today() }
  if (h < 18) return { meal: 'snacks', date: today() }
  if (h < 22) return { meal: 'dinner', date: today() }
  return { meal: 'breakfast', date: format(addDays(new Date(), 1), 'yyyy-MM-dd') }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const ACTIVITY_ICONS: Record<Activity['kind'], { icon: ReactNode; tone: string }> = {
  checkin: { icon: <LogIn className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600' },
  checkout: { icon: <DoorOpen className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-600' },
  payment: { icon: <IndianRupee className="h-4 w-4" />, tone: 'bg-brand-50 text-brand-600' },
  complaint: { icon: <MessageSquareWarning className="h-4 w-4" />, tone: 'bg-red-50 text-red-600' },
  leave: { icon: <CalendarDays className="h-4 w-4" />, tone: 'bg-violet-50 text-violet-600' },
  document: { icon: <FileText className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600' },
  room: { icon: <BedDouble className="h-4 w-4" />, tone: 'bg-cyan-50 text-cyan-600' },
  general: { icon: <ActivityIcon className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-600' },
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(iso)
}

function bedText(h: Pick<DashboardHosteler, 'roomNumber' | 'bedLabel' | 'status'>): string {
  if (h.status === 'checked_out') return 'Checked out'
  if (!h.roomNumber) return 'No bed allotted'
  return `Room ${h.roomNumber}${h.bedLabel ? ` · Bed ${h.bedLabel}` : ''}`
}

/** Plan of the organization (falls back to the session copy while loading). */
function usePlan(): Plan {
  const { data } = useOrg()
  const staff = useStaffSession()
  return data?.plan ?? staff?.organization.plan ?? 'free'
}

/* ------------------------------------------------------------------ */
/* Setup checklist                                                     */
/* ------------------------------------------------------------------ */

interface SetupStep {
  done: boolean
  title: string
  text: string
  to: string
  cta: string
  icon: ReactNode
  allowed: boolean
}

function useSetupSteps(counts: { hostels: number; rooms: number; hostelers: number; invoices: number }): SetupStep[] {
  const can = useCan()
  return [
    { done: counts.hostels > 0, title: 'Add your hostel', text: 'Name, address and type (boys / girls / co-ed).', to: '/app/settings?tab=hostels', cta: 'Add hostel', icon: <Building2 className="h-5 w-5" />, allowed: can('hostels') },
    { done: counts.rooms > 0, title: 'Add rooms & beds', text: 'Create rooms in bulk with sharing and rent per bed.', to: '/app/rooms', cta: 'Add rooms', icon: <BedDouble className="h-5 w-5" />, allowed: can('rooms') },
    { done: counts.hostelers > 0, title: 'Check in your first hosteler', text: 'Capture details, allot a bed and collect the deposit.', to: '/app/check-in', cta: 'Check in', icon: <LogIn className="h-5 w-5" />, allowed: can('checkin') },
    { done: counts.invoices > 0, title: 'Generate monthly rent', text: 'Create rent invoices for everyone in one click.', to: '/app/fees', cta: 'Generate rent', icon: <Wallet className="h-5 w-5" />, allowed: can('fees') },
  ]
}

function SetupChecklist({ steps, title = 'Get started' }: { steps: SetupStep[]; title?: string }) {
  const navigate = useNavigate()
  const doneCount = steps.filter((s) => s.done).length
  const firstOpen = steps.findIndex((s) => !s.done)
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">
              {doneCount} of {steps.length} steps complete
            </p>
          </div>
          <span className="text-2xl font-bold text-brand-600">{Math.round((doneCount / steps.length) * 100)}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-slate-100">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <div className="flex flex-1 items-start gap-4">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', s.done ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600')}>
                {s.done ? <Check className="h-5 w-5" /> : s.icon}
              </div>
              <div>
                <p className={cn('font-medium', s.done ? 'text-slate-400 line-through' : 'text-slate-900')}>
                  {i + 1}. {s.title}
                </p>
                <p className="text-sm text-slate-500">{s.text}</p>
              </div>
            </div>
            {!s.done &&
              (s.allowed ? (
                <Button variant={i === firstOpen ? 'primary' : 'outline'} size="sm" onClick={() => navigate(s.to)} icon={<ArrowRight className="h-3.5 w-3.5" />}>
                  {s.cta}
                </Button>
              ) : (
                <span className="text-xs text-slate-400">Ask the owner</span>
              ))}
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Onboarding() {
  const staff = useStaffSession()
  const steps = useSetupSteps({ hostels: 0, rooms: 0, hostelers: 0, invoices: 0 })
  const isOwner = staff?.user.role === 'owner'
  return (
    <div>
      <PageHeader
        title={`Welcome${staff ? `, ${staff.user.name.split(' ')[0]}` : ''}!`}
        subtitle={isOwner || steps[0]!.allowed ? "Let's get your hostel set up. It takes about 10 minutes." : 'No hostel has been added yet. The owner or a manager can add one.'}
      />
      <SetupChecklist steps={steps} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Quick-action modals                                                 */
/* ------------------------------------------------------------------ */

function ExpenseModal({ open, onClose, hostels }: { open: boolean; onClose: () => void; hostels: Hostel[] }) {
  const scope = useScope()
  const blank = () => ({
    hostelId: scope !== 'all' ? scope : (hostels[0]?.id ?? ''),
    category: 'groceries' as ExpenseCategory,
    amount: '',
    date: today(),
    paidTo: '',
    mode: 'upi' as PaymentMode,
    note: '',
  })
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const save = useQuickExpense(() => {
    setForm(blank())
    setError('')
    onClose()
  })

  const submit = () => {
    const amount = Number(form.amount)
    if (!form.hostelId) return setError('Select a hostel.')
    if (!amount || amount < 1) return setError('Enter a valid amount.')
    if (!form.date) return setError('Pick a date.')
    setError('')
    save.mutate({ hostelId: form.hostelId, category: form.category, amount, date: form.date, paidTo: form.paidTo.trim(), mode: form.mode, note: form.note.trim() })
  }

  return (
    <Modal
      open={open}
      onClose={() => !save.isPending && onClose()}
      title="Add expense"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save expense
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <Field label="Hostel" required>
          <Select value={form.hostelId} onChange={(e) => setForm({ ...form, hostelId: e.target.value })} options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
        </Field>
        <Field label="Category" required>
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
        </Field>
        <Field label="Amount (₹)" required>
          <Input type="number" min={1} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
        </Field>
        <Field label="Date" required>
          <Input type="date" value={form.date} max={today()} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Paid to">
          <Input value={form.paidTo} maxLength={120} onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="Vendor / person" />
        </Field>
        <Field label="Payment mode">
          <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as PaymentMode })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function NoticeModal({ open, onClose, hostels }: { open: boolean; onClose: () => void; hostels: Hostel[] }) {
  const scope = useScope()
  const blank = () => ({ hostelId: scope as string, title: '', body: '', priority: 'medium' as Priority, pinned: false })
  const [form, setForm] = useState(blank)
  const [error, setError] = useState('')
  const save = useQuickNotice(() => {
    setForm(blank())
    setError('')
    onClose()
  })

  const submit = () => {
    if (form.title.trim().length < 3) return setError('Enter a title (at least 3 characters).')
    if (!form.body.trim()) return setError('Write the notice.')
    setError('')
    save.mutate({
      hostelId: form.hostelId === 'all' ? null : form.hostelId,
      title: form.title.trim(),
      body: form.body.trim(),
      priority: form.priority,
      pinned: form.pinned,
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => !save.isPending && onClose()}
      title="Post notice"
      description="Visible to hostelers on their portal."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Post notice
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Audience">
            <Select value={form.hostelId} onChange={(e) => setForm({ ...form, hostelId: e.target.value })} options={[{ value: 'all', label: 'All hostels' }, ...hostels.map((h) => ({ value: h.id, label: h.name }))]} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} options={(['low', 'medium', 'high'] as Priority[]).map((p) => ({ value: p, label: titleCase(p) }))} />
          </Field>
        </div>
        <Field label="Title" required>
          <Input value={form.title} maxLength={150} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </Field>
        <Field label="Message" required>
          <Textarea rows={4} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <Switch checked={form.pinned} onChange={(v) => setForm({ ...form, pinned: v })} label="Pin to top" />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const hostels = useHostels()
  if (hostels.isLoading) return <LoadingState />
  if (hostels.error || !hostels.data) return <ErrorState error={hostels.error} onRetry={() => void hostels.refetch()} />
  if (hostels.data.length === 0) return <Onboarding />
  return <Overview hostels={hostels.data} />
}

function Overview({ hostels }: { hostels: Hostel[] }) {
  const scope = useScope()
  const staff = useStaffSession()
  const can = useCan()
  const plan = usePlan()
  const navigate = useNavigate()
  const setScope = useScopeStore((s) => s.setHostelId)

  const nm = nextMeal()
  const query = useDashboard({ hostelId: scope, meal: nm.meal, date: nm.date })

  const [expenseOpen, setExpenseOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)

  const canExpense = can('expenses') && hasModule(plan, 'expenses')
  const canNotice = can('notices') && hasModule(plan, 'notices')
  const scopeName = scope === 'all' ? `All hostels (${hostels.length})` : (hostels.find((h) => h.id === scope)?.name ?? '')

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${staff?.user.name.split(' ')[0] ?? 'there'}`}
        subtitle={`${format(new Date(), 'EEEE, dd MMMM yyyy')} · ${scopeName}`}
        actions={
          <>
            {can('checkin') && (
              <Button icon={<LogIn className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>
                New check-in
              </Button>
            )}
            {can('fees') && (
              <Button variant="outline" icon={<Wallet className="h-4 w-4" />} onClick={() => navigate('/app/fees')}>
                Record payment
              </Button>
            )}
            {canExpense && (
              <Button variant="outline" icon={<Receipt className="h-4 w-4" />} onClick={() => setExpenseOpen(true)}>
                Add expense
              </Button>
            )}
            {canNotice && (
              <Button variant="outline" icon={<Megaphone className="h-4 w-4" />} onClick={() => setNoticeOpen(true)}>
                Post notice
              </Button>
            )}
          </>
        }
      />

      {query.isLoading ? (
        <LoadingState label="Loading dashboard…" />
      ) : query.error || !query.data ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <OverviewBody data={query.data} hostels={hostels} plan={plan} onPickHostel={setScope} />
      )}

      {canExpense && <ExpenseModal key={`exp-${scope}`} open={expenseOpen} onClose={() => setExpenseOpen(false)} hostels={hostels} />}
      {canNotice && <NoticeModal key={`ntc-${scope}`} open={noticeOpen} onClose={() => setNoticeOpen(false)} hostels={hostels} />}
    </div>
  )
}

function HostelerRow({ h, right }: { h: DashboardHosteler; right: ReactNode }) {
  const can = useCan()
  const body = (
    <>
      <Avatar name={h.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
        <p className="truncate text-xs text-slate-500">{bedText(h)}</p>
      </div>
      {right}
    </>
  )
  return (
    <li>
      {can('hostelers') ? (
        <Link to={`/app/hostelers/${h.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-5 py-3">{body}</div>
      )}
    </li>
  )
}

function OverviewBody({ data, hostels, plan, onPickHostel }: { data: DashboardData; hostels: Hostel[]; plan: Plan; onPickHostel: (id: string) => void }) {
  const navigate = useNavigate()
  const can = useCan()
  const decide = useDecideLeave()
  const scope = useScope()
  const todayStr = today()

  const steps = useSetupSteps({ hostels: hostels.length, ...data.setup })
  const setupDone = steps.every((s) => s.done)

  const hasAttendance = hasModule(plan, 'attendance')
  const canDecideLeaves = hasAttendance && can('attendance')
  const hasMess = hasModule(plan, 'mess')

  const chart = useMemo(
    () => data.last6Months.map((m) => ({ month: formatDate(`${m.month}-01`, 'MMM'), Collected: m.collected, Expenses: m.expenses })),
    [data.last6Months],
  )
  const occ = data.occupancy
  const donut = [
    { name: 'Occupied', value: occ.occupied, color: C_COLLECTED },
    { name: 'Vacant', value: occ.vacant, color: C_VACANT },
  ]
  const tm = data.thisMonth
  const recent = data.recentActivity.slice(0, 8)
  const go = (to: string, ok: boolean) => (ok ? () => navigate(to) : undefined)

  return (
    <>
      {!setupDone && <SetupChecklist steps={steps} title="Finish setting up" />}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Occupancy"
          value={`${occ.occupied} / ${occ.total}`}
          hint={`${occ.rate}% occupied · ${occ.vacant} vacant beds`}
          icon={<BedDouble className="h-5 w-5" />}
          onClick={go('/app/rooms', can('rooms'))}
        />
        <StatCard
          label="Active hostelers"
          value={data.hostelers.active}
          hint={`${data.hostelers.reserved} reserved / upcoming`}
          tone="violet"
          icon={<Users className="h-5 w-5" />}
          onClick={go('/app/hostelers', can('hostelers'))}
        />
        <StatCard
          label={`Collected · ${formatMonth(tm.month)}`}
          value={formatMoney(tm.collected)}
          hint={`of ${formatMoney(tm.billed)} billed (${tm.rate}%)`}
          tone="green"
          icon={<IndianRupee className="h-5 w-5" />}
          onClick={go('/app/fees', can('fees'))}
        />
        <StatCard
          label="Outstanding dues"
          value={formatMoney(data.totalDues)}
          hint={data.totalDues > 0 ? 'Across all unpaid invoices' : 'All clear'}
          tone="amber"
          icon={<Wallet className="h-5 w-5" />}
          onClick={go('/app/fees', can('fees'))}
        />
        <StatCard
          label="Open complaints"
          value={data.openComplaints}
          hint={`${data.highPriorityComplaints} high priority`}
          tone="red"
          icon={<MessageSquareWarning className="h-5 w-5" />}
          onClick={go('/app/complaints', can('complaints'))}
        />
        {hasAttendance ? (
          <StatCard
            label="Pending leaves"
            value={data.pendingLeaves.count}
            hint="Awaiting approval"
            tone="violet"
            icon={<ClipboardCheck className="h-5 w-5" />}
            onClick={go('/app/attendance?tab=leaves', can('attendance'))}
          />
        ) : (
          <StatCard
            label="Upcoming check-ins"
            value={data.upcomingCheckIns.length}
            hint="Reserved beds"
            tone="violet"
            icon={<CalendarClock className="h-5 w-5" />}
          />
        )}
        {hasMess ? (
          <StatCard
            label={`Mess · ${titleCase(data.mess.meal)}${data.mess.date !== todayStr ? ' (tomorrow)' : ''}`}
            value={data.mess.expected}
            hint={`expected of ${data.mess.members} mess members`}
            tone="slate"
            icon={<UtensilsCrossed className="h-5 w-5" />}
            onClick={go('/app/mess', can('mess'))}
          />
        ) : (
          <StatCard
            label="Check-outs due"
            value={data.expectedCheckOuts.length}
            hint="In the next 30 days"
            tone="slate"
            icon={<DoorOpen className="h-5 w-5" />}
          />
        )}
        <StatCard
          label="Collection rate"
          value={`${tm.rate}%`}
          hint={`${formatMoney(Math.max(tm.outstanding, 0))} left to collect this month`}
          tone={tm.rate >= 80 ? 'green' : tm.rate >= 50 ? 'amber' : 'red'}
          icon={<Receipt className="h-5 w-5" />}
          onClick={go('/app/fees', can('fees'))}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Collection vs expenses" subtitle="Last 6 months · rent & fee payments (deposits excluded)" />
          <div className="h-72 px-2 py-4 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} barGap={2} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)}
                />
                <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v: number) => formatMoney(v)} contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#475569' }} />
                <Bar dataKey="Collected" fill={C_COLLECTED} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Expenses" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Bed occupancy" subtitle={`${occ.total} beds in active rooms`} />
          <div className="relative h-56">
            {occ.total === 0 ? (
              <EmptyState
                title="No beds yet"
                description="Add rooms to see occupancy."
                action={
                  can('rooms') ? (
                    <Link to="/app/rooms">
                      <Button size="sm">Add rooms</Button>
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="85%" paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                      {donut.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v} beds`} contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-slate-900">{occ.rate}%</span>
                  <span className="text-xs text-slate-500">occupied</span>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 px-5 py-4 text-center">
            <div>
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: C_COLLECTED }} />
                Occupied
              </p>
              <p className="mt-0.5 font-semibold text-slate-900">{occ.occupied}</p>
            </div>
            <div>
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                Vacant
              </p>
              <p className="mt-0.5 font-semibold text-slate-900">{occ.vacant}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Maintenance</p>
              <p className="mt-0.5 font-semibold text-slate-900">{data.maintenanceBeds}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Leaves + dues */}
      <div className={cn('grid gap-6', hasAttendance && 'lg:grid-cols-2')}>
        {hasAttendance && (
          <Card>
            <CardHeader
              title="Pending leave requests"
              subtitle={`${data.pendingLeaves.count} awaiting approval`}
              action={
                can('attendance') ? (
                  <Link to="/app/attendance?tab=leaves" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                    View all
                  </Link>
                ) : undefined
              }
            />
            {data.pendingLeaves.items.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No pending requests" description="Leave requests from hostelers will show up here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.pendingLeaves.items.map((l) => {
                  const name = l.hostelerName ?? 'Hosteler'
                  const busy = decide.isPending && decide.variables?.id === l.id
                  return (
                    <li key={l.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {formatDate(l.from, 'dd MMM')} – {formatDate(l.to, 'dd MMM')} · {l.destination || l.reason}
                          </p>
                        </div>
                      </div>
                      {canDecideLeaves && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="success"
                            icon={<Check className="h-3.5 w-3.5" />}
                            disabled={decide.isPending}
                            loading={busy && decide.variables?.decision === 'approve'}
                            onClick={() => decide.mutate({ id: l.id, decision: 'approve', name })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<X className="h-3.5 w-3.5" />}
                            disabled={decide.isPending}
                            loading={busy && decide.variables?.decision === 'reject'}
                            onClick={() => decide.mutate({ id: l.id, decision: 'reject', name })}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <CardHeader
            title="Top dues"
            subtitle="Hostelers with the highest outstanding balance"
            action={
              can('fees') ? (
                <Link to="/app/fees" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                  Fees
                </Link>
              ) : undefined
            }
          />
          {data.topDues.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No outstanding dues" description="Everyone is paid up." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.topDues.map((h) => (
                <HostelerRow key={h.id} h={h} right={<span className="text-sm font-semibold text-red-600">{formatMoney(h.dues)}</span>} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Upcoming + checkouts + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming check-ins" subtitle="Reserved beds" action={<CalendarClock className="h-5 w-5 text-slate-400" />} />
          {data.upcomingCheckIns.length === 0 ? (
            <EmptyState title="No reservations" description="Reserve a bed from Check-in to see it here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.upcomingCheckIns.slice(0, 6).map((h) => (
                <HostelerRow
                  key={h.id}
                  h={h}
                  right={<span className={cn('text-xs font-medium', h.checkInDate < todayStr ? 'text-red-600' : 'text-slate-600')}>{formatDate(h.checkInDate, 'dd MMM')}</span>}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Expected check-outs" subtitle="Next 30 days" action={<DoorOpen className="h-5 w-5 text-slate-400" />} />
          {data.expectedCheckOuts.length === 0 ? (
            <EmptyState title="Nobody leaving soon" description="Hostelers with an expected check-out date in the next 30 days appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.expectedCheckOuts.slice(0, 6).map((h) => (
                <HostelerRow
                  key={h.id}
                  h={h}
                  right={
                    <span className={cn('flex items-center gap-1 text-xs font-medium', h.overdue ? 'text-red-600' : 'text-slate-600')}>
                      {h.overdue && <AlertCircle className="h-3.5 w-3.5" />}
                      {formatDate(h.expectedCheckOut, 'dd MMM')}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" action={<ActivityIcon className="h-5 w-5 text-slate-400" />} />
          {recent.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="space-y-0.5 px-3 py-2">
              {recent.map((a) => {
                const meta = ACTIVITY_ICONS[a.kind] ?? ACTIVITY_ICONS.general
                return (
                  <li key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', meta.tone)}>{meta.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700">{a.message}</p>
                      <p className="text-xs text-slate-400" title={formatDateTime(a.createdAt)}>
                        {timeAgo(a.createdAt)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Hostels quick summary when viewing all */}
      {scope === 'all' && hostels.length > 1 && (
        <Card>
          <CardHeader title="Your hostels" subtitle="Click to switch the dashboard to a hostel" />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {hostels.map((h) => {
              const c = h.counts
              const total = c?.beds ?? 0
              const occupied = c?.occupied ?? 0
              const rate = total ? Math.round((occupied / total) * 100) : 0
              return (
                <button
                  key={h.id}
                  onClick={() => onPickHostel(h.id)}
                  className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-slate-900">{h.name}</p>
                    <span className="text-sm font-semibold text-brand-600">{rate}%</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {titleCase(h.type)} · {h.city}
                  </p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${rate}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {occupied} of {total} beds occupied
                  </p>
                </button>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}
