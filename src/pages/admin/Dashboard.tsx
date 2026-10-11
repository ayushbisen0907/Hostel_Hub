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
import { lastMonths, useStore } from '@/store'
import { bedLabel, hostelerDues, inScope, invoiceBalance, occupancy, useScope } from '@/store/selectors'
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Switch,
  Textarea,
  toast,
} from '@/components/ui'
import { cn, formatDate, formatDateTime, formatMoney, formatMonth, currentMonth, sum, titleCase, today } from '@/lib/utils'
import type { Activity, ExpenseCategory, Meal, PaymentMode, Priority } from '@/types'

const C_COLLECTED = '#2554eb'
const C_EXPENSE = '#f59e0b'
const C_VACANT = '#e2e8f0'

const EXPENSE_CATEGORIES: ExpenseCategory[] = ['electricity', 'water', 'groceries', 'salary', 'maintenance', 'internet', 'rent', 'other']
const PAYMENT_MODES: PaymentMode[] = ['cash', 'upi', 'card', 'bank', 'online']

/** Next meal to be served based on the current time of day. */
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

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

function Onboarding() {
  const org = useStore((s) => s.org)
  const hostels = useStore((s) => s.hostels.length)
  const rooms = useStore((s) => s.rooms.length)
  const hostelers = useStore((s) => s.hostelers.length)
  const invoices = useStore((s) => s.invoices.length)
  const loadDemo = useStore((s) => s.loadDemo)
  const navigate = useNavigate()

  const steps = [
    { done: hostels > 0, title: 'Add your hostel', text: 'Name, address and type (boys / girls / co-ed).', to: '/app/settings?tab=hostels', cta: 'Add hostel', icon: <Building2 className="h-5 w-5" /> },
    { done: rooms > 0, title: 'Add rooms & beds', text: 'Create rooms in bulk with sharing and rent per bed.', to: '/app/rooms', cta: 'Add rooms', icon: <BedDouble className="h-5 w-5" /> },
    { done: hostelers > 0, title: 'Check in your first hosteler', text: 'Capture details, allot a bed and collect the deposit.', to: '/app/check-in', cta: 'Check in', icon: <LogIn className="h-5 w-5" /> },
    { done: invoices > 0, title: 'Generate monthly rent', text: 'Create rent invoices for everyone in one click.', to: '/app/fees', cta: 'Generate rent', icon: <Wallet className="h-5 w-5" /> },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div>
      <PageHeader title={`Welcome${org ? `, ${org.ownerName.split(' ')[0]}` : ''}!`} subtitle="Let's get your hostel set up. It takes about 10 minutes." />
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900">Get started</h3>
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
              {!s.done && (
                <Button variant={i === doneCount ? 'primary' : 'outline'} size="sm" onClick={() => navigate(s.to)} icon={<ArrowRight className="h-3.5 w-3.5" />}>
                  {s.cta}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>
      <Card className="mt-6 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-slate-900">Want to look around first?</p>
          <p className="text-sm text-slate-500">Load a demo hostel with sample rooms, residents and payments. This replaces the current workspace.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            loadDemo()
            toast.success('Demo data loaded')
          }}
        >
          Load demo data
        </Button>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Quick-action modals                                                 */
/* ------------------------------------------------------------------ */

function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hostels = useStore((s) => s.hostels)
  const addExpense = useStore((s) => s.addExpense)
  const scope = useScope()
  const [form, setForm] = useState({
    hostelId: scope !== 'all' ? scope : hostels[0]?.id ?? '',
    category: 'groceries' as ExpenseCategory,
    amount: '',
    date: today(),
    paidTo: '',
    mode: 'upi' as PaymentMode,
    note: '',
  })
  const [error, setError] = useState('')

  const save = () => {
    const amount = Number(form.amount)
    if (!form.hostelId) return setError('Select a hostel.')
    if (!amount || amount <= 0) return setError('Enter a valid amount.')
    addExpense({ hostelId: form.hostelId, category: form.category, amount, date: form.date, paidTo: form.paidTo.trim(), mode: form.mode, note: form.note.trim() })
    toast.success(`Expense of ${formatMoney(amount)} added`)
    setForm((f) => ({ ...f, amount: '', paidTo: '', note: '' }))
    setError('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add expense"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save expense</Button>
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
          <Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
        </Field>
        <Field label="Date" required>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Paid to">
          <Input value={form.paidTo} onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="Vendor / person" />
        </Field>
        <Field label="Payment mode">
          <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as PaymentMode })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function NoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hostels = useStore((s) => s.hostels)
  const addNotice = useStore((s) => s.addNotice)
  const scope = useScope()
  const [form, setForm] = useState({ hostelId: scope, title: '', body: '', priority: 'medium' as Priority, pinned: false })
  const [error, setError] = useState('')

  const save = () => {
    if (!form.title.trim()) return setError('Enter a title.')
    if (!form.body.trim()) return setError('Write the notice.')
    addNotice({
      hostelId: form.hostelId === 'all' ? null : form.hostelId,
      title: form.title.trim(),
      body: form.body.trim(),
      priority: form.priority,
      pinned: form.pinned,
    })
    toast.success('Notice posted')
    setForm((f) => ({ ...f, title: '', body: '', pinned: false }))
    setError('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post notice"
      description="Visible to hostelers on their portal."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Post notice</Button>
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
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </Field>
        <Field label="Message" required>
          <Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
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
  const hostelsCount = useStore((s) => s.hostels.length)
  if (hostelsCount === 0) return <Onboarding />
  return <Overview />
}

function Overview() {
  const scope = useScope()
  const org = useStore((s) => s.org)
  const hostels = useStore((s) => s.hostels)
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const hostelers = useStore((s) => s.hostelers)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const expenses = useStore((s) => s.expenses)
  const complaints = useStore((s) => s.complaints)
  const leaves = useStore((s) => s.leaves)
  const mealOptOuts = useStore((s) => s.mealOptOuts)
  const activities = useStore((s) => s.activities)
  const decideLeave = useStore((s) => s.decideLeave)
  const navigate = useNavigate()

  const [expenseOpen, setExpenseOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)

  const month = currentMonth()
  const todayStr = today()

  const data = useMemo(() => {
    const hMap = new Map(hostelers.map((h) => [h.id, h]))
    const scopedHostelers = hostelers.filter((h) => inScope(h.hostelId, scope))
    const active = scopedHostelers.filter((h) => h.status === 'active')
    const occ = occupancy({ beds, rooms }, scope)
    const maintenanceBeds = beds.filter((b) => {
      const r = rooms.find((x) => x.id === b.roomId)
      return r && r.status === 'maintenance' && inScope(r.hostelId, scope)
    }).length

    const scopedInvoices = invoices.filter((i) => !i.cancelled && inScope(i.hostelId, scope))
    const billed = sum(scopedInvoices.filter((i) => i.month === month), (i) => i.total)
    const rentPayments = payments.filter((p) => p.invoiceId !== null && p.note !== 'Security deposit' && inScope(p.hostelId, scope))
    const collected = sum(rentPayments.filter((p) => p.date.slice(0, 7) === month), (p) => p.amount)
    const outstanding = sum(scopedInvoices, (i) => invoiceBalance({ payments }, i))

    const openComplaints = complaints.filter((c) => c.status !== 'resolved' && inScope(c.hostelId, scope))
    const pendingLeaves = leaves
      .filter((l) => l.status === 'pending' && inScope(l.hostelId, scope))
      .sort((a, b) => a.from.localeCompare(b.from))

    // Mess headcount for next meal
    const nm = nextMeal()
    const onLeave = new Set(leaves.filter((l) => l.status === 'approved' && l.from <= nm.date && l.to >= nm.date).map((l) => l.hostelerId))
    const optedOut = new Set(mealOptOuts.filter((o) => o.date === nm.date && o.meal === nm.meal).map((o) => o.hostelerId))
    const messEligible = active.filter((h) => h.messOpted)
    const headcount = messEligible.filter((h) => !onLeave.has(h.id) && !optedOut.has(h.id)).length

    // Chart: last 6 months
    const months = lastMonths(6)
    const chart = months.map((m) => ({
      month: formatDate(`${m}-01`, 'MMM'),
      Collected: sum(rentPayments.filter((p) => p.date.slice(0, 7) === m), (p) => p.amount),
      Expenses: sum(expenses.filter((e) => e.date.slice(0, 7) === m && inScope(e.hostelId, scope)), (e) => e.amount),
    }))

    // Lists
    const dues = scopedHostelers
      .map((h) => ({ h, dues: hostelerDues({ invoices, payments }, h.id) }))
      .filter((x) => x.dues > 0)
      .sort((a, b) => b.dues - a.dues)
      .slice(0, 6)
    const upcoming = scopedHostelers.filter((h) => h.status === 'reserved').sort((a, b) => a.checkInDate.localeCompare(b.checkInDate)).slice(0, 6)
    const in30 = format(addDays(new Date(), 30), 'yyyy-MM-dd')
    const checkouts = active
      .filter((h) => h.expectedCheckOut && h.expectedCheckOut <= in30)
      .sort((a, b) => (a.expectedCheckOut ?? '').localeCompare(b.expectedCheckOut ?? ''))
      .slice(0, 6)

    return {
      hMap,
      active,
      occ,
      maintenanceBeds,
      billed,
      collected,
      outstanding,
      openComplaints,
      pendingLeaves,
      nm,
      headcount,
      messEligible: messEligible.length,
      chart,
      dues,
      upcoming,
      checkouts,
    }
  }, [scope, hostelers, beds, rooms, invoices, payments, expenses, complaints, leaves, mealOptOuts, month])

  const scopeName = scope === 'all' ? `All hostels (${hostels.length})` : hostels.find((h) => h.id === scope)?.name ?? ''
  const collectionPct = data.billed ? Math.round((data.collected / data.billed) * 100) : 0
  const donut = [
    { name: 'Occupied', value: data.occ.occupied, color: C_COLLECTED },
    { name: 'Vacant', value: data.occ.vacant, color: C_VACANT },
  ]
  const recent = activities.slice(0, 8)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${org?.ownerName.split(' ')[0] ?? 'there'}`}
        subtitle={`${format(new Date(), 'EEEE, dd MMMM yyyy')} · ${scopeName}`}
        actions={
          <>
            <Button icon={<LogIn className="h-4 w-4" />} onClick={() => navigate('/app/check-in')}>New check-in</Button>
            <Button variant="outline" icon={<Wallet className="h-4 w-4" />} onClick={() => navigate('/app/fees')}>Record payment</Button>
            <Button variant="outline" icon={<Receipt className="h-4 w-4" />} onClick={() => setExpenseOpen(true)}>Add expense</Button>
            <Button variant="outline" icon={<Megaphone className="h-4 w-4" />} onClick={() => setNoticeOpen(true)}>Post notice</Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Occupancy"
          value={`${data.occ.occupied} / ${data.occ.total}`}
          hint={`${data.occ.rate}% occupied · ${data.occ.vacant} vacant beds`}
          icon={<BedDouble className="h-5 w-5" />}
          onClick={() => navigate('/app/rooms')}
        />
        <StatCard
          label="Active hostelers"
          value={data.active.length}
          hint={`${data.upcoming.length} reserved / upcoming`}
          tone="violet"
          icon={<Users className="h-5 w-5" />}
          onClick={() => navigate('/app/hostelers')}
        />
        <StatCard
          label={`Collected · ${formatMonth(month)}`}
          value={formatMoney(data.collected)}
          hint={`of ${formatMoney(data.billed)} billed (${collectionPct}%)`}
          tone="green"
          icon={<IndianRupee className="h-5 w-5" />}
          onClick={() => navigate('/app/fees')}
        />
        <StatCard
          label="Outstanding dues"
          value={formatMoney(data.outstanding)}
          hint={`${data.dues.length ? 'Across all unpaid invoices' : 'All clear'}`}
          tone="amber"
          icon={<Wallet className="h-5 w-5" />}
          onClick={() => navigate('/app/fees')}
        />
        <StatCard
          label="Open complaints"
          value={data.openComplaints.length}
          hint={`${data.openComplaints.filter((c) => c.priority === 'high').length} high priority`}
          tone="red"
          icon={<MessageSquareWarning className="h-5 w-5" />}
          onClick={() => navigate('/app/complaints')}
        />
        <StatCard
          label="Pending leaves"
          value={data.pendingLeaves.length}
          hint="Awaiting your approval"
          tone="violet"
          icon={<ClipboardCheck className="h-5 w-5" />}
          onClick={() => navigate('/app/attendance?tab=leaves')}
        />
        <StatCard
          label={`Mess · ${titleCase(data.nm.meal)}${data.nm.date !== todayStr ? ' (tomorrow)' : ''}`}
          value={data.headcount}
          hint={`expected of ${data.messEligible} mess members`}
          tone="slate"
          icon={<UtensilsCrossed className="h-5 w-5" />}
          onClick={() => navigate('/app/mess')}
        />
        <StatCard
          label="Collection rate"
          value={`${collectionPct}%`}
          hint={`${formatMoney(Math.max(data.billed - data.collected, 0))} left to collect this month`}
          tone={collectionPct >= 80 ? 'green' : collectionPct >= 50 ? 'amber' : 'red'}
          icon={<Receipt className="h-5 w-5" />}
          onClick={() => navigate('/app/fees')}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Collection vs expenses" subtitle="Last 6 months · rent & fee payments (deposits excluded)" />
          <div className="h-72 px-2 py-4 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart} barGap={2} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  tickFormatter={(v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  formatter={(v: number) => formatMoney(v)}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#475569' }} />
                <Bar dataKey="Collected" fill={C_COLLECTED} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Expenses" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Bed occupancy" subtitle={`${data.occ.total} beds in active rooms`} />
          <div className="relative h-56">
            {data.occ.total === 0 ? (
              <EmptyState title="No beds yet" description="Add rooms to see occupancy." action={<Link to="/app/rooms"><Button size="sm">Add rooms</Button></Link>} />
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
                  <span className="text-3xl font-bold text-slate-900">{data.occ.rate}%</span>
                  <span className="text-xs text-slate-500">occupied</span>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 px-5 py-4 text-center">
            <div>
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: C_COLLECTED }} />Occupied</p>
              <p className="mt-0.5 font-semibold text-slate-900">{data.occ.occupied}</p>
            </div>
            <div>
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-slate-300" />Vacant</p>
              <p className="mt-0.5 font-semibold text-slate-900">{data.occ.vacant}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Maintenance</p>
              <p className="mt-0.5 font-semibold text-slate-900">{data.maintenanceBeds}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Leaves + dues */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pending leave requests"
            subtitle={`${data.pendingLeaves.length} awaiting approval`}
            action={<Link to="/app/attendance?tab=leaves" className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>}
          />
          {data.pendingLeaves.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No pending requests" description="Leave requests from hostelers will show up here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.pendingLeaves.slice(0, 5).map((l) => {
                const h = data.hMap.get(l.hostelerId)
                return (
                  <li key={l.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={h?.name ?? '?'} src={h?.photo} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{h?.name ?? 'Unknown'}</p>
                        <p className="truncate text-xs text-slate-500">
                          {formatDate(l.from, 'dd MMM')} – {formatDate(l.to, 'dd MMM')} · {l.destination || l.reason}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() => {
                          decideLeave(l.id, 'approved')
                          toast.success(`Leave approved for ${h?.name ?? 'hosteler'}`)
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => {
                          decideLeave(l.id, 'rejected')
                          toast.info(`Leave rejected for ${h?.name ?? 'hosteler'}`)
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Top dues"
            subtitle="Hostelers with the highest outstanding balance"
            action={<Link to="/app/fees" className="text-sm font-medium text-brand-600 hover:text-brand-700">Fees</Link>}
          />
          {data.dues.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No outstanding dues" description="Everyone is paid up." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.dues.map(({ h, dues }) => (
                <li key={h.id}>
                  <Link to={`/app/hostelers/${h.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Avatar name={h.name} src={h.photo} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                      <p className="truncate text-xs text-slate-500">{h.status === 'checked_out' ? 'Checked out' : bedLabel({ rooms, beds }, h.bedId)}</p>
                    </div>
                    <span className="text-sm font-semibold text-red-600">{formatMoney(dues)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Upcoming + checkouts + activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming check-ins" subtitle="Reserved beds" action={<CalendarClock className="h-5 w-5 text-slate-400" />} />
          {data.upcoming.length === 0 ? (
            <EmptyState title="No reservations" description="Reserve a bed from Check-in to see it here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.upcoming.map((h) => (
                <li key={h.id}>
                  <Link to={`/app/hostelers/${h.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Avatar name={h.name} src={h.photo} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                      <p className="truncate text-xs text-slate-500">{bedLabel({ rooms, beds }, h.bedId)}</p>
                    </div>
                    <span className={cn('text-xs font-medium', h.checkInDate < todayStr ? 'text-red-600' : 'text-slate-600')}>
                      {formatDate(h.checkInDate, 'dd MMM')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Expected check-outs" subtitle="Next 30 days" action={<DoorOpen className="h-5 w-5 text-slate-400" />} />
          {data.checkouts.length === 0 ? (
            <EmptyState title="Nobody leaving soon" description="Hostelers with an expected check-out date in the next 30 days appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.checkouts.map((h) => {
                const overdue = (h.expectedCheckOut ?? '') < todayStr
                return (
                  <li key={h.id}>
                    <Link to={`/app/hostelers/${h.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                      <Avatar name={h.name} src={h.photo} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                        <p className="truncate text-xs text-slate-500">{bedLabel({ rooms, beds }, h.bedId)}</p>
                      </div>
                      <span className={cn('flex items-center gap-1 text-xs font-medium', overdue ? 'text-red-600' : 'text-slate-600')}>
                        {overdue && <AlertCircle className="h-3.5 w-3.5" />}
                        {formatDate(h.expectedCheckOut, 'dd MMM')}
                      </span>
                    </Link>
                  </li>
                )
              })}
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
                      <p className="text-xs text-slate-400" title={formatDateTime(a.at)}>{timeAgo(a.at)}</p>
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
              const o = occupancy({ beds, rooms }, h.id)
              return (
                <button
                  key={h.id}
                  onClick={() => useStore.getState().setCurrentHostel(h.id)}
                  className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-slate-900">{h.name}</p>
                    <span className="text-sm font-semibold text-brand-600">{o.rate}%</span>
                  </div>
                  <p className="text-xs text-slate-500">{titleCase(h.type)} · {h.city}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${o.rate}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{o.occupied} of {o.total} beds occupied</p>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      {hostels.length > 0 && <ExpenseModal key={`exp-${scope}`} open={expenseOpen} onClose={() => setExpenseOpen(false)} />}
      <NoticeModal key={`ntc-${scope}`} open={noticeOpen} onClose={() => setNoticeOpen(false)} />
    </div>
  )
}

