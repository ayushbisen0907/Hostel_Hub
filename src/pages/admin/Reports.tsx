import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { lastMonths, useStore } from '@/store'
import { inScope, invoiceBalance, useScope } from '@/store/selectors'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, ProgressBar, StatCard, Table, TD, TH, THead, TR } from '@/components/ui'
import { cn, daysBetween, downloadCsv, formatDate, formatMoney, formatMonth, sum, titleCase, today } from '@/lib/utils'
import type { ExpenseCategory } from '@/types'

const C_INCOME = '#2554eb'
const C_EXPENSE = '#f59e0b'
const C_NET = '#10b981'

/** Fixed category → color (color follows the entity, never its rank). */
const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  salary: '#2554eb',
  groceries: '#f59e0b',
  electricity: '#10b981',
  maintenance: '#8b5cf6',
  water: '#06b6d4',
  internet: '#ec4899',
  rent: '#a16207',
  other: '#64748b',
}

const RANGES = [3, 6, 12] as const
type Range = (typeof RANGES)[number]

const tooltipStyle = { borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }
const axisTick = { fill: '#64748b', fontSize: 12 }
const moneyTick = (v: number) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={onClick} className="no-print">
      Export CSV
    </Button>
  )
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {children}
    </Card>
  )
}

export default function Reports() {
  const scope = useScope()
  const hostels = useStore((s) => s.hostels)
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const hostelers = useStore((s) => s.hostelers)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const expenses = useStore((s) => s.expenses)

  const [range, setRange] = useState<Range>(6)
  const months = useMemo(() => lastMonths(range), [range])
  const scopeName = scope === 'all' ? 'All hostels' : hostels.find((h) => h.id === scope)?.name ?? ''
  const fileTag = `${scopeName.replace(/\s+/g, '-').toLowerCase()}-${months[0]}-to-${months[months.length - 1]}`

  const r = useMemo(() => {
    const monthSet = new Set(months)
    const inRange = (date: string) => monthSet.has(date.slice(0, 7))
    const isDeposit = (p: { invoiceId: string | null; note: string }) => p.invoiceId === null || p.note === 'Security deposit'

    const sPayments = payments.filter((p) => inScope(p.hostelId, scope))
    const sExpenses = expenses.filter((e) => inScope(e.hostelId, scope))
    const sInvoices = invoices.filter((i) => !i.cancelled && inScope(i.hostelId, scope))

    /* P&L */
    const pnl = months.map((m) => {
      const income = sum(sPayments.filter((p) => !isDeposit(p) && p.date.slice(0, 7) === m), (p) => p.amount)
      const deposits = sum(sPayments.filter((p) => isDeposit(p) && p.date.slice(0, 7) === m), (p) => p.amount)
      const exp = sum(sExpenses.filter((e) => e.date.slice(0, 7) === m), (e) => e.amount)
      return { month: m, label: formatDate(`${m}-01`, 'MMM yy'), Income: income, Expenses: exp, Net: income - exp, deposits }
    })
    const totalIncome = sum(pnl, (x) => x.Income)
    const totalExpenses = sum(pnl, (x) => x.Expenses)
    const totalDeposits = sum(pnl, (x) => x.deposits)

    const expRange = sExpenses.filter((e) => inRange(e.date))
    const byCategory = (Object.keys(CATEGORY_COLORS) as ExpenseCategory[])
      .map((c) => {
        const list = expRange.filter((e) => e.category === c)
        return { category: c, name: titleCase(c), value: sum(list, (e) => e.amount), count: list.length, color: CATEGORY_COLORS[c] }
      })
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)

    /* Collection */
    const collection = months.map((m) => {
      const list = sInvoices.filter((i) => i.month === m)
      const billed = sum(list, (i) => i.total)
      const ids = new Set(list.map((i) => i.id))
      const collected = Math.min(sum(sPayments.filter((p) => p.invoiceId && ids.has(p.invoiceId)), (p) => p.amount), billed)
      return { month: m, invoices: list.length, billed, collected, pending: billed - collected, pct: billed ? Math.round((collected / billed) * 100) : 0 }
    })
    const totBilled = sum(collection, (c) => c.billed)
    const totCollected = sum(collection, (c) => c.collected)

    /* Occupancy */
    const scopedHostels = hostels.filter((h) => inScope(h.id, scope))
    const occByHostel = scopedHostels.map((h) => {
      const hr = rooms.filter((x) => x.hostelId === h.id && x.status === 'active')
      const ids = new Set(hr.map((x) => x.id))
      const hb = beds.filter((b) => ids.has(b.roomId))
      const occ = hb.filter((b) => b.hostelerId).length
      return {
        id: h.id,
        name: h.name,
        type: h.type,
        rooms: hr.length,
        maintenance: rooms.filter((x) => x.hostelId === h.id && x.status === 'maintenance').length,
        beds: hb.length,
        occupied: occ,
        vacant: hb.length - occ,
        rate: hb.length ? Math.round((occ / hb.length) * 100) : 0,
      }
    })
    const roomTypes = (['ac', 'non-ac'] as const).map((t) => {
      const tr = rooms.filter((x) => x.type === t && x.status === 'active' && inScope(x.hostelId, scope))
      const ids = new Set(tr.map((x) => x.id))
      const tb = beds.filter((b) => ids.has(b.roomId))
      const occ = tb.filter((b) => b.hostelerId).length
      return {
        type: t,
        label: t === 'ac' ? 'AC' : 'Non-AC',
        rooms: tr.length,
        beds: tb.length,
        occupied: occ,
        rate: tb.length ? Math.round((occ / tb.length) * 100) : 0,
        avgRent: tr.length ? Math.round(sum(tr, (x) => x.rentPerBed) / tr.length) : 0,
      }
    })
    const sharing = Array.from(new Set(rooms.filter((x) => x.status === 'active' && inScope(x.hostelId, scope)).map((x) => x.sharing)))
      .sort((a, b) => a - b)
      .map((n) => {
        const tr = rooms.filter((x) => x.sharing === n && x.status === 'active' && inScope(x.hostelId, scope))
        const ids = new Set(tr.map((x) => x.id))
        const tb = beds.filter((b) => ids.has(b.roomId))
        const occ = tb.filter((b) => b.hostelerId).length
        return { sharing: n, rooms: tr.length, beds: tb.length, occupied: occ, rate: tb.length ? Math.round((occ / tb.length) * 100) : 0 }
      })

    /* Dues aging */
    const t = today()
    const hMap = new Map(hostelers.map((h) => [h.id, h]))
    const dueRows = sInvoices
      .map((i) => ({ inv: i, balance: invoiceBalance({ payments }, i) }))
      .filter((x) => x.balance > 0)
      .map((x) => ({ ...x, days: daysBetween(x.inv.dueDate, t), hosteler: hMap.get(x.inv.hostelerId) }))
      .sort((a, b) => b.days - a.days)
    const buckets = [
      { key: 'notdue', label: 'Not yet due', test: (d: number) => d <= 0, tone: 'slate' as const },
      { key: '0-30', label: '1–30 days', test: (d: number) => d > 0 && d <= 30, tone: 'amber' as const },
      { key: '31-60', label: '31–60 days', test: (d: number) => d > 30 && d <= 60, tone: 'red' as const },
      { key: '60+', label: '60+ days', test: (d: number) => d > 60, tone: 'red' as const },
    ].map((b) => {
      const list = dueRows.filter((x) => b.test(x.days))
      return { ...b, count: list.length, amount: sum(list, (x) => x.balance), hostelers: new Set(list.map((x) => x.inv.hostelerId)).size }
    })
    const totalDues = sum(dueRows, (x) => x.balance)

    return {
      pnl,
      totalIncome,
      totalExpenses,
      totalDeposits,
      byCategory,
      collection,
      totBilled,
      totCollected,
      occByHostel,
      roomTypes,
      sharing,
      dueRows,
      buckets,
      totalDues,
    }
  }, [months, scope, hostels, rooms, beds, hostelers, invoices, payments, expenses])

  const net = r.totalIncome - r.totalExpenses
  const margin = r.totalIncome ? Math.round((net / r.totalIncome) * 100) : 0
  const collPct = r.totBilled ? Math.round((r.totCollected / r.totBilled) * 100) : 0
  const totalBeds = sum(r.occByHostel, (h) => h.beds)
  const totalOcc = sum(r.occByHostel, (h) => h.occupied)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle={`${scopeName} · ${formatMonth(months[0]!)} – ${formatMonth(months[months.length - 1]!)}`}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
              {RANGES.map((n) => (
                <button
                  key={n}
                  onClick={() => setRange(n)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition',
                    range === n ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {n} months
                </button>
              ))}
            </div>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatMoney(r.totalIncome)} hint={`+ ${formatMoney(r.totalDeposits)} deposits held`} tone="brand" />
        <StatCard label="Expenses" value={formatMoney(r.totalExpenses)} hint={`${r.byCategory.length} categories`} tone="amber" />
        <StatCard label="Net profit" value={formatMoney(net)} hint={`${margin}% margin`} tone={net >= 0 ? 'green' : 'red'} />
        <StatCard label="Collection rate" value={`${collPct}%`} hint={`${formatMoney(r.totCollected)} of ${formatMoney(r.totBilled)}`} tone="violet" />
      </div>

      {/* P&L */}
      <Section
        title="Profit & Loss"
        subtitle="Income = rent & fee payments received (security deposits excluded). Expenses by date paid."
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(`profit-loss-${fileTag}.csv`, [
                ['Month', 'Income', 'Expenses', 'Net', 'Deposits received (not income)'],
                ...r.pnl.map((p) => [formatMonth(p.month), p.Income, p.Expenses, p.Net, p.deposits]),
                ['Total', r.totalIncome, r.totalExpenses, net, r.totalDeposits],
              ])
            }
          />
        }
      >
        <div className="h-72 px-2 pt-4 sm:px-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={r.pnl} barGap={2} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={axisTick} />
              <YAxis tickLine={false} axisLine={false} width={60} tick={axisTick} tickFormatter={moneyTick} />
              <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v: number) => formatMoney(v)} contentStyle={tooltipStyle} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Income" fill={C_INCOME} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="Expenses" fill={C_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line dataKey="Net" type="monotone" stroke={C_NET} strokeWidth={2} dot={{ r: 4, fill: C_NET, stroke: '#fff', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Table className="mt-2 border-t border-slate-100">
          <THead>
            <tr>
              <TH>Month</TH>
              <TH className="text-right">Income</TH>
              <TH className="text-right">Expenses</TH>
              <TH className="text-right">Net</TH>
              <TH className="text-right">Deposits</TH>
            </tr>
          </THead>
          <tbody>
            {r.pnl.map((p) => (
              <TR key={p.month}>
                <TD className="font-medium">{formatMonth(p.month)}</TD>
                <TD className="text-right">{formatMoney(p.Income)}</TD>
                <TD className="text-right">{formatMoney(p.Expenses)}</TD>
                <TD className={cn('text-right font-semibold', p.Net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{formatMoney(p.Net)}</TD>
                <TD className="text-right text-slate-500">{formatMoney(p.deposits)}</TD>
              </TR>
            ))}
            <TR className="bg-slate-50 font-semibold">
              <TD>Total</TD>
              <TD className="text-right">{formatMoney(r.totalIncome)}</TD>
              <TD className="text-right">{formatMoney(r.totalExpenses)}</TD>
              <TD className={cn('text-right', net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{formatMoney(net)}</TD>
              <TD className="text-right text-slate-500">{formatMoney(r.totalDeposits)}</TD>
            </TR>
          </tbody>
        </Table>
      </Section>

      {/* Expense breakdown */}
      <Section
        title="Expense breakdown"
        subtitle="By category for the selected period"
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(`expenses-by-category-${fileTag}.csv`, [
                ['Category', 'Entries', 'Amount', 'Share %'],
                ...r.byCategory.map((c) => [c.name, c.count, c.value, r.totalExpenses ? ((c.value / r.totalExpenses) * 100).toFixed(1) : '0']),
                ['Total', sum(r.byCategory, (c) => c.count), r.totalExpenses, '100'],
              ])
            }
          />
        }
      >
        {r.byCategory.length === 0 ? (
          <EmptyState
            title="No expenses recorded"
            description="Expenses you add appear here."
            action={
              <Link to="/app/expenses" className="no-print">
                <Button size="sm">Go to expenses</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid items-center gap-4 p-5 md:grid-cols-2">
            <div className="relative h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={r.byCategory} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke="#fff" strokeWidth={2}>
                    {r.byCategory.map((c) => (
                      <Cell key={c.category} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v)} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-slate-500">Total</span>
                <span className="text-xl font-bold text-slate-900">{formatMoney(r.totalExpenses)}</span>
              </div>
            </div>
            <ul className="space-y-3">
              {r.byCategory.map((c) => {
                const pct = r.totalExpenses ? (c.value / r.totalExpenses) * 100 : 0
                return (
                  <li key={c.category}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                        <span className="text-xs text-slate-400">({c.count})</span>
                      </span>
                      <span className="font-medium text-slate-900">
                        {formatMoney(c.value)} <span className="text-xs font-normal text-slate-500">· {pct.toFixed(1)}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.color }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Section>

      {/* Collection */}
      <Section
        title="Collection report"
        subtitle="Billed per invoice month vs amount collected against those invoices"
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(`collection-${fileTag}.csv`, [
                ['Month', 'Invoices', 'Billed', 'Collected', 'Pending', 'Collection %'],
                ...r.collection.map((c) => [formatMonth(c.month), c.invoices, c.billed, c.collected, c.pending, c.pct]),
                ['Total', sum(r.collection, (c) => c.invoices), r.totBilled, r.totCollected, r.totBilled - r.totCollected, collPct],
              ])
            }
          />
        }
      >
        <Table>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Billed</TH>
              <TH className="text-right">Collected</TH>
              <TH className="text-right">Pending</TH>
              <TH className="w-48">Collection</TH>
            </tr>
          </THead>
          <tbody>
            {r.collection.map((c) => (
              <TR key={c.month}>
                <TD className="font-medium">{formatMonth(c.month)}</TD>
                <TD className="text-right">{c.invoices}</TD>
                <TD className="text-right">{formatMoney(c.billed)}</TD>
                <TD className="text-right text-emerald-700">{formatMoney(c.collected)}</TD>
                <TD className={cn('text-right', c.pending > 0 ? 'text-red-600' : 'text-slate-500')}>{formatMoney(c.pending)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ProgressBar value={c.pct} tone={c.pct >= 90 ? 'green' : c.pct >= 60 ? 'amber' : 'red'} />
                    </div>
                    <span className="w-10 text-right text-xs font-medium text-slate-600">{c.billed ? `${c.pct}%` : '—'}</span>
                  </div>
                </TD>
              </TR>
            ))}
            <TR className="bg-slate-50 font-semibold">
              <TD>Total</TD>
              <TD className="text-right">{sum(r.collection, (c) => c.invoices)}</TD>
              <TD className="text-right">{formatMoney(r.totBilled)}</TD>
              <TD className="text-right text-emerald-700">{formatMoney(r.totCollected)}</TD>
              <TD className="text-right text-red-600">{formatMoney(r.totBilled - r.totCollected)}</TD>
              <TD className="text-right text-xs">{collPct}%</TD>
            </TR>
          </tbody>
        </Table>
      </Section>

      {/* Occupancy */}
      <Section
        title="Occupancy report"
        subtitle={`Current snapshot · ${totalOcc} of ${totalBeds} beds occupied`}
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(`occupancy-${fileTag}.csv`, [
                ['Hostel', 'Type', 'Active rooms', 'Rooms in maintenance', 'Beds', 'Occupied', 'Vacant', 'Occupancy %'],
                ...r.occByHostel.map((h) => [h.name, titleCase(h.type), h.rooms, h.maintenance, h.beds, h.occupied, h.vacant, h.rate]),
                [],
                ['Room type', 'Rooms', 'Beds', 'Occupied', 'Occupancy %', 'Avg rent / bed'],
                ...r.roomTypes.map((t) => [t.label, t.rooms, t.beds, t.occupied, t.rate, t.avgRent]),
                [],
                ['Sharing', 'Rooms', 'Beds', 'Occupied', 'Occupancy %'],
                ...r.sharing.map((s) => [`${s.sharing}-sharing`, s.rooms, s.beds, s.occupied, s.rate]),
              ])
            }
          />
        }
      >
        {r.occByHostel.length === 0 ? (
          <EmptyState title="No hostels" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Hostel</TH>
                  <TH className="text-right">Rooms</TH>
                  <TH className="text-right">Beds</TH>
                  <TH className="text-right">Occupied</TH>
                  <TH className="text-right">Vacant</TH>
                  <TH className="w-48">Rate</TH>
                </tr>
              </THead>
              <tbody>
                {r.occByHostel.map((h) => (
                  <TR key={h.id}>
                    <TD>
                      <p className="font-medium text-slate-900">{h.name}</p>
                      <p className="text-xs text-slate-500">
                        {titleCase(h.type)}
                        {h.maintenance > 0 && ` · ${h.maintenance} room${h.maintenance > 1 ? 's' : ''} in maintenance`}
                      </p>
                    </TD>
                    <TD className="text-right">{h.rooms}</TD>
                    <TD className="text-right">{h.beds}</TD>
                    <TD className="text-right">{h.occupied}</TD>
                    <TD className="text-right">{h.vacant}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <ProgressBar value={h.rate} />
                        </div>
                        <span className="w-10 text-right text-xs font-medium text-slate-600">{h.rate}%</span>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-6 border-t border-slate-100 p-5 md:grid-cols-2">
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-800">By room type</p>
                <div className="space-y-3">
                  {r.roomTypes.map((t) => (
                    <div key={t.type} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800">{t.label}</span>
                        <span className="text-slate-600">
                          {t.occupied}/{t.beds} beds · <span className="font-semibold text-slate-900">{t.rate}%</span>
                        </span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar value={t.rate} />
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {t.rooms} rooms · avg {formatMoney(t.avgRent)} / bed
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-800">By sharing</p>
                {r.sharing.length === 0 ? (
                  <p className="text-sm text-slate-500">No active rooms.</p>
                ) : (
                  <div className="space-y-3">
                    {r.sharing.map((s) => (
                      <div key={s.sharing} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0 text-slate-700">{s.sharing === 1 ? 'Single' : `${s.sharing}-sharing`}</span>
                        <div className="flex-1">
                          <ProgressBar value={s.rate} tone="green" />
                        </div>
                        <span className="w-28 shrink-0 text-right text-xs text-slate-600">
                          {s.occupied}/{s.beds} · {s.rate}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Section>

      {/* Dues aging */}
      <Section
        title="Dues aging"
        subtitle={`${formatMoney(r.totalDues)} outstanding across ${r.dueRows.length} invoices · as of ${formatDate(today())}`}
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(`dues-aging-${fileTag}.csv`, [
                ['Hosteler', 'Phone', 'Invoice', 'Month', 'Due date', 'Days overdue', 'Bucket', 'Balance'],
                ...r.dueRows.map((x) => [
                  x.hosteler?.name ?? '',
                  x.hosteler?.phone ?? '',
                  x.inv.number,
                  formatMonth(x.inv.month),
                  x.inv.dueDate,
                  Math.max(x.days, 0),
                  x.days <= 0 ? 'Not yet due' : x.days <= 30 ? '1-30' : x.days <= 60 ? '31-60' : '60+',
                  x.balance,
                ]),
              ])
            }
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
          {r.buckets.map((b) => (
            <div key={b.key} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-600">{b.label}</p>
                <Badge tone={b.tone}>{b.count}</Badge>
              </div>
              <p className={cn('mt-2 text-xl font-bold', b.key === 'notdue' ? 'text-slate-900' : b.key === '0-30' ? 'text-amber-600' : 'text-red-600')}>
                {formatMoney(b.amount)}
              </p>
              <p className="text-xs text-slate-500">
                {b.hostelers} hosteler{b.hostelers === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>
        {r.dueRows.length === 0 ? (
          <EmptyState title="No outstanding dues" description="All invoices are fully paid." />
        ) : (
          <Table className="border-t border-slate-100">
            <THead>
              <tr>
                <TH>Hosteler</TH>
                <TH>Invoice</TH>
                <TH>Due date</TH>
                <TH className="text-right">Overdue</TH>
                <TH className="text-right">Balance</TH>
              </tr>
            </THead>
            <tbody>
              {r.dueRows.slice(0, 25).map((x) => (
                <TR key={x.inv.id}>
                  <TD>
                    {x.hosteler ? (
                      <Link to={`/app/hostelers/${x.hosteler.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                        {x.hosteler.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD>
                    <span className="font-mono text-xs">{x.inv.number}</span>
                    <span className="ml-2 text-xs text-slate-500">{formatMonth(x.inv.month)}</span>
                  </TD>
                  <TD>{formatDate(x.inv.dueDate)}</TD>
                  <TD className="text-right">
                    {x.days <= 0 ? (
                      <span className="text-slate-500">Not due</span>
                    ) : (
                      <span className={x.days > 30 ? 'font-medium text-red-600' : 'text-amber-600'}>{x.days} days</span>
                    )}
                  </TD>
                  <TD className="text-right font-semibold">{formatMoney(x.balance)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        {r.dueRows.length > 25 && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Showing the 25 oldest of {r.dueRows.length} invoices. Export CSV for the full list.
          </p>
        )}
      </Section>
    </div>
  )
}
