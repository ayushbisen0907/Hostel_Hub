import { useMemo, useState } from 'react'
import { parseISO } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Pencil, Plus, Receipt, Tag, Trash2, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react'
import { lastMonths, useStore } from '@/store'
import { inScope, useHostelName, useScope } from '@/store/selectors'
import type { Expense, ExpenseCategory, PaymentMode } from '@/types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
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
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { currentMonth, downloadCsv, formatDate, formatMoney, formatMonth, sum, today } from '@/lib/utils'
import { PAYMENT_MODES, modeLabel } from './_fees'

/** Fixed order = fixed color; a category keeps its color regardless of filters. */
const CATEGORIES: { value: ExpenseCategory; label: string; color: string }[] = [
  { value: 'electricity', label: 'Electricity', color: '#2a78d6' },
  { value: 'water', label: 'Water', color: '#eb6834' },
  { value: 'groceries', label: 'Groceries', color: '#1baf7a' },
  { value: 'salary', label: 'Salary', color: '#eda100' },
  { value: 'maintenance', label: 'Maintenance', color: '#e87ba4' },
  { value: 'internet', label: 'Internet', color: '#008300' },
  { value: 'rent', label: 'Rent', color: '#4a3aa7' },
  { value: 'other', label: 'Other', color: '#e34948' },
]
const catInfo = (c: ExpenseCategory) => CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[CATEGORIES.length - 1]!

const BAR_COLOR = '#2a78d6'

function prevMonth(month: string): string {
  return lastMonths(2, parseISO(`${month}-01`))[0]!
}

export default function Expenses() {
  const scope = useScope()
  const expenses = useStore((s) => s.expenses)
  const deleteExpense = useStore((s) => s.deleteExpense)
  const hostelName = useHostelName()

  const [month, setMonth] = useState(currentMonth())
  const [category, setCategory] = useState<ExpenseCategory | ''>('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)

  const scoped = useMemo(() => expenses.filter((e) => inScope(e.hostelId, scope)), [expenses, scope])
  const refMonth = month || currentMonth()

  const stats = useMemo(() => {
    const cur = scoped.filter((e) => e.date.startsWith(refMonth))
    const prev = scoped.filter((e) => e.date.startsWith(prevMonth(refMonth)))
    const curTotal = sum(cur, (e) => e.amount)
    const prevTotal = sum(prev, (e) => e.amount)
    const change = prevTotal ? Math.round(((curTotal - prevTotal) / prevTotal) * 100) : null
    const byCat = CATEGORIES.map((c) => ({ ...c, amount: sum(cur.filter((e) => e.category === c.value), (e) => e.amount) }))
    const top = [...byCat].sort((a, b) => b.amount - a.amount)[0]
    return { curTotal, prevTotal, change, byCat, top: top && top.amount > 0 ? top : null, count: cur.length }
  }, [scoped, refMonth])

  const trend = useMemo(
    () =>
      lastMonths(6, parseISO(`${refMonth}-01`)).map((m) => ({
        month: m,
        label: formatDate(`${m}-01`, 'MMM'),
        amount: sum(scoped.filter((e) => e.date.startsWith(m) && (!category || e.category === category)), (e) => e.amount),
      })),
    [scoped, refMonth, category],
  )

  const pieData = stats.byCat.filter((c) => c.amount > 0)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return scoped
      .filter((e) => !month || e.date.startsWith(month))
      .filter((e) => !category || e.category === category)
      .filter(
        (e) =>
          !needle ||
          e.paidTo.toLowerCase().includes(needle) ||
          e.note.toLowerCase().includes(needle) ||
          catInfo(e.category).label.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [scoped, month, category, q])

  const rowsTotal = sum(rows, (e) => e.amount)

  const remove = async (e: Expense) => {
    const ok = await confirm({
      title: 'Delete expense?',
      message: `${catInfo(e.category).label} · ${formatMoney(e.amount)} paid to ${e.paidTo || '—'} on ${formatDate(e.date)} will be removed.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    deleteExpense(e.id)
    toast.success('Expense deleted')
  }

  const exportCsv = () =>
    downloadCsv(`expenses-${month || 'all'}.csv`, [
      ['Date', 'Hostel', 'Category', 'Paid to', 'Mode', 'Amount', 'Note'],
      ...rows.map((e) => [e.date, hostelName(e.hostelId), catInfo(e.category).label, e.paidTo, modeLabel(e.mode), e.amount, e.note]),
    ])

  const up = stats.change !== null && stats.change > 0

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track what it costs to run your hostels"
        actions={
          <>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add expense
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label={`Spent in ${formatMonth(refMonth)}`}
          value={formatMoney(stats.curTotal)}
          hint={`${stats.count} expense${stats.count === 1 ? '' : 's'}`}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label={`vs ${formatMonth(prevMonth(refMonth))}`}
          value={stats.change === null ? '—' : `${up ? '+' : ''}${stats.change}%`}
          hint={`${formatMoney(stats.prevTotal)} last month`}
          tone={stats.change === null ? 'slate' : up ? 'red' : 'green'}
          icon={up ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
        />
        <StatCard
          label="Top category"
          value={stats.top ? stats.top.label : '—'}
          hint={
            stats.top
              ? `${formatMoney(stats.top.amount)} · ${stats.curTotal ? Math.round((stats.top.amount / stats.curTotal) * 100) : 0}% of the month`
              : 'No expenses this month'
          }
          tone="violet"
          icon={<Tag className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Last 6 months"
            subtitle={category ? `${catInfo(category).label} expenses per month` : 'Total expenses per month'}
          />
          <div className="h-64 px-2 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickFormatter={(v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(v: number) => [formatMoney(v), 'Spent']}
                  labelFormatter={(_l, p) => {
                    const m = (p?.[0]?.payload as { month?: string } | undefined)?.month
                    return m ? formatMonth(m) : ''
                  }}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                />
                <Bar dataKey="amount" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="By category" subtitle={formatMonth(refMonth)} />
          {pieData.length === 0 ? (
            <EmptyState icon={<Tag className="h-6 w-6" />} title="Nothing spent yet" description={`No expenses recorded for ${formatMonth(refMonth)}.`} />
          ) : (
            <div className="flex flex-col items-center gap-4 p-4 sm:flex-row lg:flex-col xl:flex-row">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="amount" nameKey="label" innerRadius="58%" outerRadius="100%" stroke="#fff" strokeWidth={2} paddingAngle={0}>
                      {pieData.map((c) => (
                        <Cell key={c.value} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [formatMoney(v), n]} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-1.5 text-sm">
                {pieData
                  .slice()
                  .sort((a, b) => b.amount - a.amount)
                  .map((c) => (
                    <li key={c.value}>
                      <button
                        type="button"
                        onClick={() => setCategory(category === c.value ? '' : c.value)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-slate-50"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
                        <span className="flex-1 truncate text-slate-700">{c.label}</span>
                        <span className="tabular-nums text-slate-500">{Math.round((c.amount / stats.curTotal) * 100)}%</span>
                        <span className="w-20 text-right font-medium tabular-nums text-slate-900">{formatMoney(c.amount)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search paid to, note…" className="lg:w-72" />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Month" />
            {month && (
              <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setMonth('')}>
                All months
              </Button>
            )}
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory | '')}
              options={[{ value: '', label: 'All categories' }, ...CATEGORIES]}
              className="w-44"
            />
          </div>
          <p className="text-sm text-slate-500">
            {rows.length} item{rows.length === 1 ? '' : 's'} · <span className="font-semibold text-slate-900">{formatMoney(rowsTotal)}</span>
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No expenses found"
            description="Record electricity bills, groceries, salaries and more to see where the money goes."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Add expense
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Category</TH>
                <TH>Paid to</TH>
                {scope === 'all' && <TH>Hostel</TH>}
                <TH>Mode</TH>
                <TH>Note</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((e) => {
                const c = catInfo(e.category)
                return (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{formatDate(e.date)}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                        {c.label}
                      </span>
                    </TD>
                    <TD className="font-medium text-slate-800">{e.paidTo || '—'}</TD>
                    {scope === 'all' && <TD className="whitespace-nowrap">{hostelName(e.hostelId)}</TD>}
                    <TD>
                      <Badge>{modeLabel(e.mode)}</Badge>
                    </TD>
                    <TD className="max-w-[220px] truncate text-slate-500">{e.note || '—'}</TD>
                    <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(e.amount)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <IconButton label="Edit" onClick={() => setEditing(e)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => void remove(e)}>
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <ExpenseModal value={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Add / edit modal                                                    */
/* ------------------------------------------------------------------ */

interface Draft {
  hostelId: string
  category: ExpenseCategory
  amount: string
  date: string
  paidTo: string
  mode: PaymentMode
  note: string
}

function ExpenseModal({ value, onClose }: { value: Expense | 'new' | null; onClose: () => void }) {
  const scope = useScope()
  const hostels = useStore((s) => s.hostels)
  const addExpense = useStore((s) => s.addExpense)
  const updateExpense = useStore((s) => s.updateExpense)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [loaded, setLoaded] = useState<Expense | 'new' | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})

  if (value !== loaded) {
    setLoaded(value)
    setErrors({})
    if (value === 'new') {
      setDraft({
        hostelId: scope !== 'all' ? scope : hostels[0]?.id ?? '',
        category: 'groceries',
        amount: '',
        date: today(),
        paidTo: '',
        mode: 'upi',
        note: '',
      })
    } else if (value) {
      setDraft({
        hostelId: value.hostelId,
        category: value.category,
        amount: String(value.amount),
        date: value.date,
        paidTo: value.paidTo,
        mode: value.mode,
        note: value.note,
      })
    } else setDraft(null)
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const save = () => {
    if (!draft) return
    const errs: Partial<Record<keyof Draft, string>> = {}
    const amount = Number(draft.amount)
    if (!draft.hostelId) errs.hostelId = 'Choose a hostel'
    if (!draft.amount || !Number.isFinite(amount) || amount <= 0) errs.amount = 'Enter an amount greater than zero'
    if (!draft.date) errs.date = 'Choose a date'
    if (Object.keys(errs).length) return setErrors(errs)
    const data = {
      hostelId: draft.hostelId,
      category: draft.category,
      amount,
      date: draft.date,
      paidTo: draft.paidTo.trim(),
      mode: draft.mode,
      note: draft.note.trim(),
    }
    if (value === 'new') {
      addExpense(data)
      toast.success(`${formatMoney(amount)} expense added`)
    } else if (value) {
      updateExpense(value.id, data)
      toast.success('Expense updated')
    }
    onClose()
  }

  return (
    <Modal
      open={value !== null && draft !== null}
      onClose={onClose}
      title={value === 'new' ? 'Add expense' : 'Edit expense'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{value === 'new' ? 'Add expense' : 'Save changes'}</Button>
        </>
      }
    >
      {draft && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hostel" required error={errors.hostelId} className="sm:col-span-2">
            <Select
              value={draft.hostelId}
              onChange={(e) => set('hostelId', e.target.value)}
              placeholder={hostels.length ? undefined : 'Create a hostel first'}
              options={hostels.map((h) => ({ value: h.id, label: h.name }))}
            />
          </Field>
          <Field label="Category" required>
            <Select value={draft.category} onChange={(e) => set('category', e.target.value as ExpenseCategory)} options={CATEGORIES} />
          </Field>
          <Field label="Amount (₹)" required error={errors.amount}>
            <Input type="number" inputMode="decimal" min={1} value={draft.amount} onChange={(e) => set('amount', e.target.value)} autoFocus />
          </Field>
          <Field label="Date" required error={errors.date}>
            <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Payment mode">
            <Select value={draft.mode} onChange={(e) => set('mode', e.target.value as PaymentMode)} options={PAYMENT_MODES} />
          </Field>
          <Field label="Paid to" className="sm:col-span-2">
            <Input value={draft.paidTo} onChange={(e) => set('paidTo', e.target.value)} placeholder="e.g. State Electricity Board, Sharma Kirana" />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Textarea value={draft.note} onChange={(e) => set('note', e.target.value)} rows={2} placeholder="Optional details, bill number…" />
          </Field>
        </div>
      )}
    </Modal>
  )
}
