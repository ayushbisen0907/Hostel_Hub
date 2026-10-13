import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format, subMonths } from 'date-fns'
import { useHostels, useScope } from '@/api/common'
import { useCan } from '@/api/session'
import { useCollectionReport, useDuesAgingReport, useOccupancyReport, usePnlReport, type AgingBucket } from '@/api/reports'
import type { ExpenseCategory } from '@/api/expenses'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, ProgressBar, QueryView, StatCard, Table, TD, TH, THead, TR, type BadgeTone } from '@/components/ui'
import { cn, downloadCsv, formatDate, formatMoney, formatMonth, sum, titleCase } from '@/lib/utils'

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

const BUCKET_TONES: Record<AgingBucket, BadgeTone> = { notdue: 'slate', '1-30': 'amber', '31-60': 'red', '60+': 'red' }
const BUCKET_TEXT: Record<AgingBucket, string> = { notdue: 'text-slate-900', '1-30': 'text-amber-600', '31-60': 'text-red-600', '60+': 'text-red-600' }

const RANGES = [3, 6, 12] as const
type Range = (typeof RANGES)[number]

const tooltipStyle = { borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13 }
const axisTick = { fill: '#64748b', fontSize: 12 }
const moneyTick = (v: number) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)

/** The last `n` months as YYYY-MM, oldest first (matches the server). */
function lastMonths(n: number): string[] {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => format(subMonths(now, n - 1 - i), 'yyyy-MM'))
}

function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={onClick} disabled={disabled} className="no-print">
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
  const { data: hostels } = useHostels()
  const can = useCan()
  const [range, setRange] = useState<Range>(6)
  const months = useMemo(() => lastMonths(range), [range])

  const pnlQ = usePnlReport(range, scope)
  const collQ = useCollectionReport(range, scope)
  const occQ = useOccupancyReport(scope)
  const duesQ = useDuesAgingReport(scope)

  const scopeName = scope === 'all' ? 'All hostels' : (hostels?.find((h) => h.id === scope)?.name ?? '')
  const fileTag = `${scopeName.replace(/\s+/g, '-').toLowerCase() || 'hostel'}-${months[0]}-to-${months[months.length - 1]}`

  const pnl = pnlQ.data
  const coll = collQ.data
  const net = pnl?.totals.net ?? 0
  const margin = pnl?.totals.income ? Math.round((net / pnl.totals.income) * 100) : 0

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
                  className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', range === n ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={pnl ? formatMoney(pnl.totals.income) : '…'} hint={pnl ? `+ ${formatMoney(pnl.totals.deposits)} deposits received` : undefined} tone="brand" />
        <StatCard label="Expenses" value={pnl ? formatMoney(pnl.totals.expenses) : '…'} hint={pnl ? `${pnl.byCategory.length} categories` : undefined} tone="amber" />
        <StatCard label="Net profit" value={pnl ? formatMoney(net) : '…'} hint={pnl ? `${margin}% margin` : undefined} tone={net >= 0 ? 'green' : 'red'} />
        <StatCard
          label="Collection rate"
          value={coll ? `${coll.totals.rate}%` : '…'}
          hint={coll ? `${formatMoney(coll.totals.collected)} of ${formatMoney(coll.totals.billed)}` : undefined}
          tone="violet"
        />
      </div>

      {/* P&L */}
      <Section
        title="Profit & Loss"
        subtitle="Income = rent payments received (security deposits and advances excluded). Expenses by date paid."
        action={
          <ExportButton
            disabled={!pnl}
            onClick={() =>
              pnl &&
              downloadCsv(`profit-loss-${fileTag}.csv`, [
                ['Month', 'Income', 'Expenses', 'Net', 'Deposits received (not income)'],
                ...pnl.months.map((p) => [formatMonth(p.month), p.income, p.expenses, p.net, p.deposits]),
                ['Total', pnl.totals.income, pnl.totals.expenses, pnl.totals.net, pnl.totals.deposits],
              ])
            }
          />
        }
      >
        <QueryView query={pnlQ}>
          {(r) => {
            const chart = r.months.map((p) => ({ label: formatDate(`${p.month}-01`, 'MMM yy'), Income: p.income, Expenses: p.expenses, Net: p.net }))
            return (
              <>
                <div className="h-72 px-2 pt-4 sm:px-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} barGap={2} barCategoryGap="24%">
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
                    {r.months.map((p) => (
                      <TR key={p.month}>
                        <TD className="font-medium">{formatMonth(p.month)}</TD>
                        <TD className="text-right">{formatMoney(p.income)}</TD>
                        <TD className="text-right">{formatMoney(p.expenses)}</TD>
                        <TD className={cn('text-right font-semibold', p.net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{formatMoney(p.net)}</TD>
                        <TD className="text-right text-slate-500">{formatMoney(p.deposits)}</TD>
                      </TR>
                    ))}
                    <TR className="bg-slate-50 font-semibold">
                      <TD>Total</TD>
                      <TD className="text-right">{formatMoney(r.totals.income)}</TD>
                      <TD className="text-right">{formatMoney(r.totals.expenses)}</TD>
                      <TD className={cn('text-right', r.totals.net >= 0 ? 'text-emerald-700' : 'text-red-600')}>{formatMoney(r.totals.net)}</TD>
                      <TD className="text-right text-slate-500">{formatMoney(r.totals.deposits)}</TD>
                    </TR>
                  </tbody>
                </Table>
              </>
            )
          }}
        </QueryView>
      </Section>

      {/* Expense breakdown */}
      <Section
        title="Expense breakdown"
        subtitle="By category for the selected period"
        action={
          <ExportButton
            disabled={!pnl}
            onClick={() =>
              pnl &&
              downloadCsv(`expenses-by-category-${fileTag}.csv`, [
                ['Category', 'Entries', 'Amount', 'Share %'],
                ...pnl.byCategory.map((c) => [titleCase(c.category), c.count, c.amount, pnl.totals.expenses ? ((c.amount / pnl.totals.expenses) * 100).toFixed(1) : '0']),
                ['Total', sum(pnl.byCategory, (c) => c.count), pnl.totals.expenses, '100'],
              ])
            }
          />
        }
      >
        <QueryView query={pnlQ}>
          {(r) => {
            const total = r.totals.expenses
            const cats = r.byCategory.map((c) => ({ ...c, name: titleCase(c.category), color: CATEGORY_COLORS[c.category] ?? '#64748b' }))
            if (cats.length === 0)
              return (
                <EmptyState
                  title="No expenses recorded"
                  description="Expenses you add appear here."
                  action={
                    can('expenses') ? (
                      <Link to="/app/expenses" className="no-print">
                        <Button size="sm">Go to expenses</Button>
                      </Link>
                    ) : undefined
                  }
                />
              )
            return (
              <div className="grid items-center gap-4 p-5 md:grid-cols-2">
                <div className="relative h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cats} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke="#fff" strokeWidth={2}>
                        {cats.map((c) => (
                          <Cell key={c.category} fill={c.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatMoney(v)} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-slate-500">Total</span>
                    <span className="text-xl font-bold text-slate-900">{formatMoney(total)}</span>
                  </div>
                </div>
                <ul className="space-y-3">
                  {cats.map((c) => {
                    const pct = total ? (c.amount / total) * 100 : 0
                    return (
                      <li key={c.category}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-2 text-slate-700">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                            {c.name}
                            <span className="text-xs text-slate-400">({c.count})</span>
                          </span>
                          <span className="font-medium text-slate-900">
                            {formatMoney(c.amount)} <span className="text-xs font-normal text-slate-500">· {pct.toFixed(1)}%</span>
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
            )
          }}
        </QueryView>
      </Section>

      {/* Collection */}
      <Section
        title="Collection report"
        subtitle="Billed per invoice month vs amount collected against those invoices"
        action={
          <ExportButton
            disabled={!coll}
            onClick={() =>
              coll &&
              downloadCsv(`collection-${fileTag}.csv`, [
                ['Month', 'Invoices', 'Billed', 'Collected', 'Pending', 'Collection %'],
                ...coll.months.map((c) => [formatMonth(c.month), c.invoices, c.billed, c.collected, c.pending, c.rate]),
                ['Total', coll.totals.invoices, coll.totals.billed, coll.totals.collected, coll.totals.pending, coll.totals.rate],
              ])
            }
          />
        }
      >
        <QueryView query={collQ}>
          {(r) => (
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
                {r.months.map((c) => (
                  <TR key={c.month}>
                    <TD className="font-medium">{formatMonth(c.month)}</TD>
                    <TD className="text-right">{c.invoices}</TD>
                    <TD className="text-right">{formatMoney(c.billed)}</TD>
                    <TD className="text-right text-emerald-700">{formatMoney(c.collected)}</TD>
                    <TD className={cn('text-right', c.pending > 0 ? 'text-red-600' : 'text-slate-500')}>{formatMoney(c.pending)}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <ProgressBar value={c.rate} tone={c.rate >= 90 ? 'green' : c.rate >= 60 ? 'amber' : 'red'} />
                        </div>
                        <span className="w-10 text-right text-xs font-medium text-slate-600">{c.billed ? `${c.rate}%` : '—'}</span>
                      </div>
                    </TD>
                  </TR>
                ))}
                <TR className="bg-slate-50 font-semibold">
                  <TD>Total</TD>
                  <TD className="text-right">{r.totals.invoices}</TD>
                  <TD className="text-right">{formatMoney(r.totals.billed)}</TD>
                  <TD className="text-right text-emerald-700">{formatMoney(r.totals.collected)}</TD>
                  <TD className="text-right text-red-600">{formatMoney(r.totals.pending)}</TD>
                  <TD className="text-right text-xs">{r.totals.rate}%</TD>
                </TR>
              </tbody>
            </Table>
          )}
        </QueryView>
      </Section>

      {/* Occupancy */}
      <Section
        title="Occupancy report"
        subtitle={occQ.data ? `Current snapshot · ${occQ.data.total.occupied} of ${occQ.data.total.total} beds occupied` : 'Current snapshot'}
        action={
          <ExportButton
            disabled={!occQ.data}
            onClick={() => {
              const o = occQ.data
              if (!o) return
              downloadCsv(`occupancy-${fileTag}.csv`, [
                ['Hostel', 'Type', 'Active rooms', 'Rooms in maintenance', 'Beds', 'Occupied', 'Vacant', 'Occupancy %'],
                ...o.byHostel.map((h) => [h.name, titleCase(h.type), h.rooms, h.maintenance, h.beds, h.occupied, h.vacant, h.rate]),
                [],
                ['Room type', 'Rooms', 'Beds', 'Occupied', 'Occupancy %', 'Avg rent / bed'],
                ...o.byRoomType.map((t) => [t.type === 'ac' ? 'AC' : 'Non-AC', t.rooms, t.beds, t.occupied, t.rate, t.avgRent]),
                [],
                ['Sharing', 'Rooms', 'Beds', 'Occupied', 'Occupancy %'],
                ...o.bySharing.map((s) => [`${s.sharing}-sharing`, s.rooms, s.beds, s.occupied, s.rate]),
              ])
            }}
          />
        }
      >
        <QueryView query={occQ}>
          {(o) =>
            o.byHostel.length === 0 ? (
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
                    {o.byHostel.map((h) => (
                      <TR key={h.hostelId}>
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
                      {o.byRoomType.map((t) => (
                        <div key={t.type} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-800">{t.type === 'ac' ? 'AC' : 'Non-AC'}</span>
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
                    {o.bySharing.length === 0 ? (
                      <p className="text-sm text-slate-500">No active rooms.</p>
                    ) : (
                      <div className="space-y-3">
                        {o.bySharing.map((s) => (
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
            )
          }
        </QueryView>
      </Section>

      {/* Dues aging */}
      <Section
        title="Dues aging"
        subtitle={
          duesQ.data
            ? `${formatMoney(duesQ.data.totalDues)} outstanding across ${duesQ.data.invoices.length} invoices · as of ${formatDate(duesQ.data.asOf)}`
            : 'Outstanding invoices by how long they are overdue'
        }
        action={
          <ExportButton
            disabled={!duesQ.data}
            onClick={() => {
              const d = duesQ.data
              if (!d) return
              const label = new Map(d.buckets.map((b) => [b.key, b.label]))
              downloadCsv(`dues-aging-${fileTag}.csv`, [
                ['Hosteler', 'Hosteler ID', 'Phone', 'Invoice', 'Month', 'Due date', 'Days overdue', 'Bucket', 'Balance'],
                ...d.invoices.map((x) => [
                  x.hosteler?.name ?? '',
                  x.hosteler?.loginId ?? '',
                  x.hosteler?.phone ?? '',
                  x.number,
                  formatMonth(x.month),
                  x.dueDate,
                  x.daysOverdue,
                  label.get(x.bucket) ?? x.bucket,
                  x.balance,
                ]),
              ])
            }}
          />
        }
      >
        {duesQ.isLoading ? (
          <LoadingState />
        ) : duesQ.error || !duesQ.data ? (
          <ErrorState error={duesQ.error} onRetry={() => void duesQ.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
              {duesQ.data.buckets.map((b) => (
                <div key={b.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-600">{b.label}</p>
                    <Badge tone={BUCKET_TONES[b.key]}>{b.count}</Badge>
                  </div>
                  <p className={cn('mt-2 text-xl font-bold', BUCKET_TEXT[b.key])}>{formatMoney(b.amount)}</p>
                  <p className="text-xs text-slate-500">
                    {b.hostelers} hosteler{b.hostelers === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
            {duesQ.data.invoices.length === 0 ? (
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
                  {duesQ.data.invoices.slice(0, 25).map((x) => (
                    <TR key={x.invoiceId}>
                      <TD>
                        {x.hosteler ? (
                          can('hostelers') ? (
                            <Link to={`/app/hostelers/${x.hosteler.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                              {x.hosteler.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-900">{x.hosteler.name}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>
                        <span className="font-mono text-xs">{x.number}</span>
                        <span className="ml-2 text-xs text-slate-500">{formatMonth(x.month)}</span>
                      </TD>
                      <TD>{formatDate(x.dueDate)}</TD>
                      <TD className="text-right">
                        {x.daysOverdue <= 0 ? (
                          <span className="text-slate-500">Not due</span>
                        ) : (
                          <span className={x.daysOverdue > 30 ? 'font-medium text-red-600' : 'text-amber-600'}>{x.daysOverdue} days</span>
                        )}
                      </TD>
                      <TD className="text-right font-semibold">{formatMoney(x.balance)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
            {duesQ.data.invoices.length > 25 && (
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                Showing the 25 oldest of {duesQ.data.invoices.length} invoices. Export CSV for the full list.
              </p>
            )}
          </>
        )}
      </Section>
    </div>
  )
}
