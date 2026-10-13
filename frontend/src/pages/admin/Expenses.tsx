import { useEffect, useState } from 'react'
import { format, parseISO, subMonths } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Pencil, Plus, Receipt, Tag, Trash2, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react'
import { useHostels, useScope } from '@/api/common'
import { toastError } from '@/api/query'
import type { ID, PaymentMode } from '@/api/types'
import {
  expensesApi,
  useCreateExpense,
  useDeleteExpense,
  useExpenseSummary,
  useExpenses,
  useUpdateExpense,
  type Expense,
  type ExpenseCategory,
} from '@/api/expenses'
import { fetchAllPages } from '@/api/fees'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
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
} from '@/components/ui'
import { currentMonth, downloadCsv, formatDate, formatMoney, formatMonth, today } from '@/lib/utils'
import { PAYMENT_MODES, Pager, modeLabel, useDebounced } from './_fees'

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
const PAGE_SIZE = 50

function prevMonth(month: string): string {
  return format(subMonths(parseISO(`${month}-01`), 1), 'yyyy-MM')
}

export default function Expenses() {
  const scope = useScope()
  const [month, setMonth] = useState(currentMonth())
  const [category, setCategory] = useState<ExpenseCategory | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [busyId, setBusyId] = useState<ID | null>(null)
  const [exporting, setExporting] = useState(false)
  const dq = useDebounced(q.trim())

  useEffect(() => setPage(1), [scope, month, category, dq])

  const refMonth = month || currentMonth()
  const summaryQ = useExpenseSummary({ months: 6, month: refMonth, hostelId: scope })
  const filters = { hostelId: scope, month, category, q: dq }
  const listQ = useExpenses({ ...filters, page, limit: PAGE_SIZE })
  const deleteExpense = useDeleteExpense()

  const summary = summaryQ.data
  const cur = summary?.months[summary.months.length - 1]
  const curTotal = summary?.current.total ?? 0
  const prevTotal = summary?.current.previousTotal ?? 0
  const change = summary?.current.change ?? null
  const byCat = CATEGORIES.map((c) => ({ ...c, amount: cur?.byCategory[c.value] ?? 0 }))
  const top = [...byCat].sort((a, b) => b.amount - a.amount)[0]
  const topCat = top && top.amount > 0 ? top : null
  const pieData = byCat.filter((c) => c.amount > 0)
  const trend = (summary?.months ?? []).map((m) => ({
    month: m.month,
    label: formatDate(`${m.month}-01`, 'MMM'),
    amount: category ? m.byCategory[category] : m.total,
  }))

  const list = listQ.data
  const rows = list?.items ?? []

  const remove = async (e: Expense) => {
    const ok = await confirm({
      title: 'Delete expense?',
      message: `${catInfo(e.category).label} · ${formatMoney(e.amount)} paid to ${e.paidTo || '—'} on ${formatDate(e.date)} will be removed.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusyId(e.id)
    deleteExpense.mutate(e.id, { onSettled: () => setBusyId(null) })
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(expensesApi.list, { ...filters })
      downloadCsv(`expenses-${month || 'all'}.csv`, [
        ['Date', 'Hostel', 'Category', 'Paid to', 'Mode', 'Amount', 'Note'],
        ...all.map((e) => [e.date, e.hostelName, catInfo(e.category).label, e.paidTo, modeLabel(e.mode), e.amount, e.note]),
      ])
    } catch (err) {
      toastError(err, 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const up = change !== null && change > 0
  const sv = (v: string) => (summary ? v : summaryQ.isLoading ? '…' : '—')

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track what it costs to run your hostels"
        actions={
          <>
            <Button
              variant="outline"
              icon={<Download className="h-4 w-4" />}
              onClick={() => void exportCsv()}
              loading={exporting}
              disabled={!list?.total}
            >
              Export CSV
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add expense
            </Button>
          </>
        }
      />

      {summaryQ.error && !summary ? (
        <Card>
          <ErrorState error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label={`Spent in ${formatMonth(refMonth)}`}
              value={sv(formatMoney(curTotal))}
              hint={cur ? `${cur.count} expense${cur.count === 1 ? '' : 's'}` : undefined}
              icon={<Wallet className="h-5 w-5" />}
            />
            <StatCard
              label={`vs ${formatMonth(prevMonth(refMonth))}`}
              value={sv(change === null ? '—' : `${up ? '+' : ''}${change}%`)}
              hint={summary ? `${formatMoney(prevTotal)} last month` : undefined}
              tone={change === null ? 'slate' : up ? 'red' : 'green'}
              icon={up ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            />
            <StatCard
              label="Top category"
              value={sv(topCat ? topCat.label : '—')}
              hint={
                !summary
                  ? undefined
                  : topCat
                    ? `${formatMoney(topCat.amount)} · ${curTotal ? Math.round((topCat.amount / curTotal) * 100) : 0}% of the month`
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
                {!summary ? (
                  <LoadingState className="h-full py-0" />
                ) : (
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
                )}
              </div>
            </Card>

            <Card className="min-w-0 lg:col-span-2">
              <CardHeader title="By category" subtitle={formatMonth(refMonth)} />
              {!summary ? (
                <LoadingState />
              ) : pieData.length === 0 ? (
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
                  <ul className="min-w-0 flex-1 space-y-1.5 self-stretch text-sm">
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
                            <span className="tabular-nums text-slate-500">{curTotal ? Math.round((c.amount / curTotal) * 100) : 0}%</span>
                            <span className="w-20 text-right font-medium tabular-nums text-slate-900">{formatMoney(c.amount)}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

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
          {list && (
            <p className="text-sm text-slate-500">
              {list.total} item{list.total === 1 ? '' : 's'} · <span className="font-semibold text-slate-900">{formatMoney(list.totalAmount)}</span>
            </p>
          )}
        </div>
        {listQ.isLoading ? (
          <LoadingState label="Loading expenses…" />
        ) : listQ.error && !list ? (
          <ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} />
        ) : rows.length === 0 ? (
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
          <>
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
                      {scope === 'all' && <TD className="whitespace-nowrap">{e.hostelName || '—'}</TD>}
                      <TD>
                        <Badge>{modeLabel(e.mode)}</Badge>
                      </TD>
                      <TD className="max-w-[220px] truncate text-slate-500">{e.note || '—'}</TD>
                      <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(e.amount)}</TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <IconButton label="Edit" onClick={() => setEditing(e)} disabled={busyId === e.id}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label="Delete"
                            className="hover:bg-red-50 hover:text-red-600"
                            disabled={busyId === e.id}
                            onClick={() => void remove(e)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
            {list && <Pager page={list.page} pages={list.pages} onChange={setPage} busy={listQ.isFetching} />}
          </>
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
  const hostelsQ = useHostels()
  const hostels = hostelsQ.data ?? []
  const create = useCreateExpense(onClose)
  const update = useUpdateExpense(onClose)
  const saving = create.isPending || update.isPending

  const [draft, setDraft] = useState<Draft | null>(null)
  const [loaded, setLoaded] = useState<Expense | 'new' | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})

  if (value !== loaded) {
    setLoaded(value)
    setErrors({})
    if (value === 'new') {
      setDraft({
        hostelId: scope !== 'all' ? scope : (hostels[0]?.id ?? ''),
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

  // hostels may arrive after the modal opened
  if (draft && !draft.hostelId && value === 'new' && hostels[0]) setDraft({ ...draft, hostelId: hostels[0].id })

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const save = () => {
    if (!draft) return
    const errs: Partial<Record<keyof Draft, string>> = {}
    const amount = Number(draft.amount)
    if (!draft.hostelId) errs.hostelId = 'Choose a hostel'
    if (!draft.amount || !Number.isFinite(amount) || amount < 1) errs.amount = 'Enter an amount of at least ₹1'
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
    if (value === 'new') create.mutate(data)
    else if (value) update.mutate({ id: value.id, ...data })
  }

  return (
    <Modal
      open={value !== null && draft !== null}
      onClose={onClose}
      title={value === 'new' ? 'Add expense' : 'Edit expense'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {value === 'new' ? 'Add expense' : 'Save changes'}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hostel" required error={errors.hostelId} className="sm:col-span-2">
            <Select
              value={draft.hostelId}
              onChange={(e) => set('hostelId', e.target.value)}
              placeholder={hostelsQ.isLoading ? 'Loading…' : hostels.length ? undefined : 'Create a hostel first'}
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
            <Input
              value={draft.paidTo}
              onChange={(e) => set('paidTo', e.target.value)}
              maxLength={120}
              placeholder="e.g. State Electricity Board, Sharma Kirana"
            />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Textarea value={draft.note} onChange={(e) => set('note', e.target.value)} rows={2} maxLength={500} placeholder="Optional details, bill number…" />
          </Field>
        </div>
      )}
    </Modal>
  )
}
