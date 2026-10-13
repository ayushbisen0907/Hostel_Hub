import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Banknote,
  BellRing,
  CalendarClock,
  Download,
  Eye,
  FilePlus2,
  FileText,
  IndianRupee,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Receipt,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useHostelName, useHostels, useScope, useSettings } from '@/api/common'
import { toastError } from '@/api/query'
import type { ChargeKey, ID, InvoiceItem, InvoiceStatus, Payment, PaymentMode } from '@/api/types'
import { CHARGE_KEY_LABELS, CHARGE_KEY_OPTIONS, configuredCharges, guessKey, monthlyBillItems } from '@/lib/charges'
import {
  feesApi,
  fetchAllPages,
  useAddLateFee,
  useCancelInvoice,
  useCreateInvoice,
  useDeletePayment,
  useDeposits,
  useDues,
  useFeesSummary,
  useGenerateInvoices,
  useInvoices,
  usePayments,
  useUpdateInvoice,
  type DueRow,
  type DuesResponse,
  type GenerateResult,
  type HostelerListItem,
  type InvoiceRow,
} from '@/api/fees'
import {
  Avatar,
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
  ProgressBar,
  SearchInput,
  Select,
  StatCard,
  StatusBadge,
  Table,
  Tabs,
  TD,
  TH,
  THead,
  TR,
  confirm,
  toast,
} from '@/components/ui'
import { currentMonth, downloadCsv, formatDate, formatMoney, formatMonth, sum, today } from '@/lib/utils'
import {
  DEPOSIT_NOTE,
  HostelerPicker,
  PAYMENT_MODES,
  Pager,
  RecordPaymentModal,
  RowMenu,
  daysOverdue,
  dueDateFor,
  modeLabel,
  openInNewTab,
  reminderText,
  useDebounced,
  whatsappUrl,
} from './_fees'
import { VerifyTab } from './_verify'
import { usePendingClaimCount } from '@/api/claims'

type TabKey = 'verify' | 'invoices' | 'payments' | 'dues' | 'deposits'
const TAB_KEYS: TabKey[] = ['verify', 'invoices', 'payments', 'dues', 'deposits']
const PAGE_SIZE = 50

interface PayTarget {
  hostelerId?: ID
  invoiceId?: ID
  defaultTarget?: 'deposit' | 'advance'
}

/** "Room 101 · Bed A" -> "101-A" (compact, for tables). */
function shortRoom(label: string): string {
  const m = /^Room (.+?)(?: · Bed (.+))?$/.exec(label)
  if (!m) return label === 'Not allotted' ? '—' : label
  return m[2] ? `${m[1]}-${m[2]}` : (m[1] ?? label)
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export default function Fees() {
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab') as TabKey | null
  const tab: TabKey = rawTab && TAB_KEYS.includes(rawTab) ? rawTab : 'invoices'
  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }

  const scope = useScope()
  const [month, setMonth] = useState(currentMonth())
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [remindOpen, setRemindOpen] = useState(false)

  const summaryQ = useFeesSummary(month, scope)
  const duesQ = useDues(scope)
  const pendingQ = usePendingClaimCount(scope)
  const pending = pendingQ.data ?? 0
  const s = summaryQ.data
  const rate = s?.collectionRate ?? 0
  const rateTone = rate >= 80 ? 'green' : rate >= 50 ? 'amber' : 'red'
  const loadingValue = summaryQ.isLoading ? '…' : '—'
  const overdueCount = s?.overdueCount ?? 0

  return (
    <div>
      <PageHeader
        title="Fees & Payments"
        subtitle="Bill hostelers, track collections and follow up on dues"
        actions={
          <>
            <Button variant="outline" icon={<Sparkles className="h-4 w-4" />} onClick={() => setGenOpen(true)}>
              Generate rent
            </Button>
            <Button variant="outline" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCustomOpen(true)}>
              Custom invoice
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPayTarget({})}>
              Record payment
            </Button>
          </>
        }
      />

      {pending > 0 && tab !== 'verify' && (
        <button
          type="button"
          onClick={() => setTab('verify')}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:bg-amber-100"
        >
          <BadgeCheck className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="flex-1 text-sm text-amber-900">
            <strong className="font-semibold">
              {pending} UPI payment{pending === 1 ? '' : 's'} waiting for verification.
            </strong>{' '}
            Check your bank and confirm them so hostelers' bills are updated.
          </span>
          <span className="hidden text-sm font-semibold text-amber-800 sm:inline">Review →</span>
        </button>
      )}

      {/* Overview */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Overview · {formatMonth(month)}</h2>
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="h-9 w-44"
          aria-label="Overview month"
        />
      </div>
      {summaryQ.error && !s ? (
        <Card>
          <ErrorState error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Billed"
              value={s ? formatMoney(s.billed) : loadingValue}
              hint={s ? `${s.invoiceCount} invoice${s.invoiceCount === 1 ? '' : 's'}` : undefined}
              icon={<FileText className="h-5 w-5" />}
            />
            <StatCard
              label="Collected"
              value={s ? formatMoney(s.collected) : loadingValue}
              hint={s ? `${formatMoney(s.received)} received in ${formatMonth(month)}` : undefined}
              tone="green"
              icon={<Wallet className="h-5 w-5" />}
            />
            <StatCard
              label="Outstanding"
              value={s ? formatMoney(s.outstanding) : loadingValue}
              hint="Unpaid balance on this month's invoices"
              tone="amber"
              icon={<IndianRupee className="h-5 w-5" />}
            />
            <StatCard
              label="Overdue invoices"
              value={s ? s.overdueCount : loadingValue}
              hint={s ? (s.overdueCount ? `${formatMoney(s.overdueAmount)} past due · all months` : 'Nothing overdue') : undefined}
              tone="red"
              icon={<AlertTriangle className="h-5 w-5" />}
              onClick={overdueCount ? () => setRemindOpen(true) : undefined}
            />
          </div>
          <Card className="mt-4 p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Collection rate</span>
              <span className="font-semibold text-slate-900">{s ? `${rate}%` : loadingValue}</span>
            </div>
            <ProgressBar value={rate} tone={s?.invoiceCount ? rateTone : 'brand'} />
            <p className="mt-2 text-xs text-slate-500">
              {!s
                ? 'Loading…'
                : s.invoiceCount
                  ? `${formatMoney(s.collected)} of ${formatMoney(s.billed)} collected for ${formatMonth(month)}`
                  : `No invoices for ${formatMonth(month)} yet — use "Generate rent" to bill everyone at once.`}
            </p>
          </Card>
        </>
      )}

      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'verify', label: 'Verify payments', count: pending || undefined },
          { value: 'invoices', label: 'Invoices' },
          { value: 'payments', label: 'Payments' },
          { value: 'dues', label: 'Dues', count: duesQ.data?.totals.hostelers },
          { value: 'deposits', label: 'Deposits' },
        ]}
      />

      <div className="mt-4">
        {tab === 'verify' && <VerifyTab pendingCount={pending} />}
        {tab === 'invoices' && (
          <InvoicesTab
            onPay={(inv) => setPayTarget({ hostelerId: inv.hostelerId, invoiceId: inv.id })}
            onRemindAll={() => setRemindOpen(true)}
            overdueCount={overdueCount}
          />
        )}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'dues' && <DuesTab query={duesQ} onPay={(hid) => setPayTarget({ hostelerId: hid })} />}
        {tab === 'deposits' && <DepositsTab onCollect={(hid) => setPayTarget({ hostelerId: hid, defaultTarget: 'deposit' })} />}
      </div>

      <RecordPaymentModal
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        hostelerId={payTarget?.hostelerId ?? null}
        invoiceId={payTarget?.invoiceId ?? null}
        defaultTarget={payTarget?.defaultTarget}
      />
      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} initialMonth={month} />
      <CustomInvoiceModal open={customOpen} onClose={() => setCustomOpen(false)} />
      <OverdueRemindersModal open={remindOpen} onClose={() => setRemindOpen(false)} query={duesQ} />
    </div>
  )
}

/* ================================================================== */
/* Invoices tab                                                        */
/* ================================================================== */

const STATUS_OPTIONS: { value: InvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

function InvoicesTab({
  onPay,
  onRemindAll,
  overdueCount,
}: {
  onPay: (inv: InvoiceRow) => void
  onRemindAll: () => void
  overdueCount: number
}) {
  const scope = useScope()
  const settings = useSettings()
  const hostelName = useHostelName()

  const [month, setMonth] = useState(currentMonth())
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [busyId, setBusyId] = useState<ID | null>(null)
  const [exporting, setExporting] = useState(false)
  const dq = useDebounced(q.trim())

  useEffect(() => setPage(1), [scope, month, status, dq])

  const filters = { hostelId: scope, month, status, q: dq }
  const query = useInvoices({ ...filters, page, limit: PAGE_SIZE })
  const lateFee = useAddLateFee()
  const cancelInv = useCancelInvoice()

  const data = query.data
  const rows = data?.items ?? []

  const addLateFee = async (inv: InvoiceRow) => {
    const days = daysOverdue(inv.dueDate)
    const fee = days * settings.lateFeePerDay
    if (!settings.lateFeePerDay) return toast.info('Set a late fee per day in Settings first.')
    if (days <= 0) return toast.info('This invoice is not overdue yet.')
    const ok = await confirm({
      title: 'Add late fee?',
      message: `${inv.number} is ${days} day${days === 1 ? '' : 's'} overdue. A late fee of about ${formatMoney(fee)} (${formatMoney(settings.lateFeePerDay)}/day) will be added. Any earlier late fee line is replaced.`,
      confirmText: `Add ${formatMoney(fee)}`,
    })
    if (!ok) return
    setBusyId(inv.id)
    lateFee.mutate(inv.id, {
      onSuccess: (r) => toast.success(r.replaced ? `Late fee updated to ${formatMoney(r.lateFee)}` : `Late fee of ${formatMoney(r.lateFee)} added`),
      onSettled: () => setBusyId(null),
    })
  }

  const cancel = async (inv: InvoiceRow) => {
    if (inv.paidAmount > 0) {
      toast.info(`${formatMoney(inv.paidAmount)} is recorded against ${inv.number}. Delete those payments first to cancel it.`)
      return
    }
    const ok = await confirm({
      title: `Cancel ${inv.number}?`,
      message: 'The invoice will be voided and no longer count towards dues. This cannot be undone.',
      confirmText: 'Cancel invoice',
      danger: true,
    })
    if (!ok) return
    setBusyId(inv.id)
    cancelInv.mutate(inv.id, { onSettled: () => setBusyId(null) })
  }

  const remind = (inv: InvoiceRow) => {
    const h = inv.hosteler
    if (!h?.phone) return toast.error('No phone number on file')
    window.open(
      whatsappUrl(
        h.phone,
        reminderText({
          name: h.name,
          amount: inv.balance,
          dueDate: inv.dueDate,
          invoiceNo: inv.number,
          month: inv.month,
          hostelName: inv.hostelName || hostelName(inv.hostelId),
        }),
      ),
      '_blank',
      'noopener',
    )
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(feesApi.invoices, { ...filters })
      downloadCsv(`invoices-${month || 'all'}.csv`, [
        ['Invoice', 'Hosteler', 'Phone', 'Room', 'Hostel', 'Month', 'Total', 'Paid', 'Balance', 'Due date', 'Status'],
        ...all.map((r) => [
          r.number,
          r.hosteler?.name ?? '',
          r.hosteler?.phone ?? '',
          shortRoom(r.roomLabel),
          r.hostelName,
          r.month,
          r.total,
          Math.min(r.paidAmount, r.total),
          r.balance,
          r.dueDate,
          r.status,
        ]),
      ])
    } catch (e) {
      toastError(e, 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search invoice no., name, phone…" className="lg:w-72" />
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Month" />
          {month ? (
            <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setMonth('')}>
              All months
            </Button>
          ) : null}
          <Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')} options={STATUS_OPTIONS} className="w-44" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" icon={<BellRing className="h-4 w-4" />} onClick={onRemindAll} disabled={!overdueCount}>
            Remind overdue{overdueCount ? ` (${overdueCount})` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={() => void exportCsv()}
            loading={exporting}
            disabled={!data?.total}
          >
            CSV
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingState label="Loading invoices…" />
      ) : query.error && !data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No invoices found"
          description={month ? `No invoices match your filters for ${formatMonth(month)}.` : 'No invoices match your filters.'}
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Hosteler</TH>
                <TH>Room</TH>
                <TH>Month</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Paid</TH>
                <TH className="text-right">Balance</TH>
                <TH>Due date</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((inv) => {
                const h = inv.hosteler
                const st = inv.status
                return (
                  <TR key={inv.id} className={inv.cancelled ? 'opacity-60' : undefined}>
                    <TD className="font-medium text-slate-900">{inv.number}</TD>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={h?.name ?? '?'} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{h?.name ?? 'Removed hosteler'}</p>
                          <p className="text-xs text-slate-500">{h?.phone}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>{shortRoom(inv.roomLabel)}</TD>
                    <TD className="whitespace-nowrap">{formatMonth(inv.month)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(inv.total)}</TD>
                    <TD className="text-right tabular-nums text-emerald-700">{formatMoney(Math.min(inv.paidAmount, inv.total))}</TD>
                    <TD className="text-right font-semibold tabular-nums">{inv.balance ? formatMoney(inv.balance) : '—'}</TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(inv.dueDate)}
                      {st === 'overdue' && <p className="text-xs text-red-600">{daysOverdue(inv.dueDate)}d overdue</p>}
                    </TD>
                    <TD>
                      <StatusBadge status={st} />
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        {inv.balance > 0 && (
                          <Button size="sm" variant="secondary" onClick={() => onPay(inv)}>
                            Pay
                          </Button>
                        )}
                        <IconButton label="View / print" onClick={() => openInNewTab(`/print/invoice/${inv.id}`)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        <RowMenu
                          disabled={busyId === inv.id}
                          items={[
                            { label: 'Record payment', icon: <Banknote />, onClick: () => onPay(inv), hidden: inv.balance <= 0 },
                            { label: 'View / print', icon: <Printer />, onClick: () => openInNewTab(`/print/invoice/${inv.id}`) },
                            { label: 'Edit items', icon: <Pencil />, onClick: () => setEditing(inv), hidden: inv.cancelled },
                            { label: 'Add late fee', icon: <Timer />, onClick: () => void addLateFee(inv), hidden: st !== 'overdue' },
                            { label: 'Send reminder', icon: <MessageCircle />, onClick: () => remind(inv), hidden: inv.balance <= 0 },
                            { label: 'Cancel invoice', icon: <Ban />, onClick: () => void cancel(inv), danger: true, hidden: inv.cancelled },
                          ]}
                        />
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
          {data && (
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-100 px-4 py-3 text-sm">
              <span className="text-slate-500">
                {data.total} invoice{data.total === 1 ? '' : 's'}
              </span>
              <span>
                Total <b className="tabular-nums">{formatMoney(data.totals.total)}</b>
              </span>
              <span>
                Paid <b className="tabular-nums text-emerald-700">{formatMoney(data.totals.paid)}</b>
              </span>
              <span>
                Balance <b className="tabular-nums text-red-600">{formatMoney(data.totals.balance)}</b>
              </span>
            </div>
          )}
          {data && <Pager page={data.page} pages={data.pages} onChange={setPage} busy={query.isFetching} />}
        </>
      )}

      <EditItemsModal invoice={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Line items editor                                                   */
/* ------------------------------------------------------------------ */

interface DraftItem {
  key: number
  cat: ChargeKey
  label: string
  amount: string
}

let draftKey = 0
const toDraft = (items: InvoiceItem[]): DraftItem[] =>
  items.map((i) => ({ key: ++draftKey, cat: i.key ?? guessKey(i.label), label: i.label, amount: String(i.amount) }))
const blankDraft = (cat: ChargeKey = 'other', label = ''): DraftItem => ({ key: ++draftKey, cat, label, amount: '' })

function ItemsEditor({ items, onChange }: { items: DraftItem[]; onChange: (v: DraftItem[]) => void }) {
  const total = sum(items, (i) => Number(i.amount) || 0)
  const update = (key: number, patch: Partial<DraftItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  return (
    <div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-2 sm:flex-nowrap sm:border-0 sm:p-0">
            <Select
              value={it.cat}
              aria-label="Category"
              options={CHARGE_KEY_OPTIONS}
              onChange={(e) => {
                const cat = e.target.value as ChargeKey
                // fill / follow the description while it is blank or still the old category's name
                const auto = !it.label.trim() || it.label === CHARGE_KEY_LABELS[it.cat]
                update(it.key, { cat, ...(auto && cat !== 'other' ? { label: CHARGE_KEY_LABELS[cat] } : {}) })
              }}
              className="w-full sm:w-40 sm:shrink-0"
            />
            <Input
              value={it.label}
              onChange={(e) => update(it.key, { label: e.target.value })}
              placeholder="Description"
              className="min-w-0 flex-1"
              maxLength={120}
            />
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={it.amount}
              onChange={(e) => update(it.key, { amount: e.target.value })}
              placeholder="Amount"
              className="w-28 text-right sm:w-32"
            />
            <IconButton label="Remove item" onClick={() => onChange(items.filter((x) => x.key !== it.key))} disabled={items.length <= 1}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...items, blankDraft()])}>
          Add item
        </Button>
        <p className="text-sm text-slate-600">
          Total <span className="ml-1 text-base font-bold text-slate-900">{formatMoney(total)}</span>
        </p>
      </div>
    </div>
  )
}

function parseItems(items: DraftItem[]): { items: InvoiceItem[]; error?: string } {
  const out: InvoiceItem[] = []
  for (const it of items) {
    if (!it.label.trim() && !it.amount) continue
    const amt = Number(it.amount)
    if (!it.label.trim()) return { items: [], error: 'Every item needs a description' }
    if (!Number.isFinite(amt) || it.amount === '') return { items: [], error: `Enter an amount for "${it.label}"` }
    if (amt < 0) return { items: [], error: `"${it.label}" can't be negative` }
    out.push({ key: it.cat, label: it.label.trim(), amount: amt })
  }
  if (!out.length) return { items: [], error: 'Add at least one line item' }
  if (sum(out, (i) => i.amount) <= 0) return { items: [], error: 'Invoice total must be greater than zero' }
  return { items: out }
}

function EditItemsModal({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const [items, setItems] = useState<DraftItem[]>([])
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<ID | null>(null)
  const update = useUpdateInvoice(() => onClose())

  if (invoice && loadedFor !== invoice.id) {
    setLoadedFor(invoice.id)
    setItems(toDraft(invoice.items))
    setDueDate(invoice.dueDate)
    setError('')
  }
  if (!invoice && loadedFor) setLoadedFor(null)

  const paid = invoice?.paidAmount ?? 0

  const save = () => {
    if (!invoice) return
    const res = parseItems(items)
    if (res.error) return setError(res.error)
    const total = sum(res.items, (i) => i.amount)
    if (total < paid) return setError(`Total can't be less than the ${formatMoney(paid)} already paid`)
    if (!dueDate) return setError('Choose a due date')
    update.mutate({ id: invoice.id, items: res.items, dueDate })
  }

  return (
    <Modal
      open={invoice !== null}
      onClose={onClose}
      size="lg"
      title={`Edit ${invoice?.number ?? 'invoice'}`}
      description={invoice ? `${formatMonth(invoice.month)}${paid ? ` · ${formatMoney(paid)} already paid` : ''}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ItemsEditor
          items={items}
          onChange={(v) => {
            setItems(v)
            setError('')
          }}
        />
        <Field label="Due date" className="sm:w-56">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Generate monthly rent                                               */
/* ------------------------------------------------------------------ */

function GenerateModal({ open, onClose, initialMonth }: { open: boolean; onClose: () => void; initialMonth: string }) {
  const scope = useScope()
  const hostels = useHostels()
  const settings = useSettings()

  const [month, setMonth] = useState(initialMonth)
  const [hostelId, setHostelId] = useState<string>(scope)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  const generate = useGenerateInvoices((r) => setResult(r))
  const selectedHostel = hostelId === 'all' ? null : (hostels.data ?? []).find((h) => h.id === hostelId)

  if (open && !wasOpen) {
    setWasOpen(true)
    setMonth(initialMonth)
    setHostelId(scope)
    setResult(null)
  }
  if (!open && wasOpen) setWasOpen(false)

  const run = () => {
    if (!month) return toast.error('Choose a month')
    generate.mutate(
      { month, hostelId: hostelId as ID | 'all' },
      {
        onSuccess: (r) => {
          if (r.created) toast.success(`${r.created} invoice${r.created === 1 ? '' : 's'} generated for ${formatMonth(r.month)}`)
          else toast.info(r.skipped ? `Everyone is already billed for ${formatMonth(r.month)}` : 'No active hostelers to bill for this month')
        },
      },
    )
  }

  if (result) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="Rent generated"
        description={`${formatMonth(result.month)} · due ${formatDate(result.dueDate)}`}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <div>
            <p className="text-3xl font-bold text-emerald-600">{result.created}</p>
            <p className="text-xs text-slate-500">invoice{result.created === 1 ? '' : 's'} created</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-slate-400">{result.skipped}</p>
            <p className="text-xs text-slate-500">already billed (skipped)</p>
          </div>
        </div>
        {!result.created && !result.skipped && (
          <p className="mt-3 text-sm text-slate-500">No active hostelers were checked in by {formatMonth(result.month)}.</p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate monthly rent"
      description="Create rent invoices for every active hosteler in one go"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={generate.isPending}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!month} loading={generate.isPending} icon={<Sparkles className="h-4 w-4" />}>
            Generate invoices
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Month" required>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <Field label="Hostel">
            <Select
              value={hostelId}
              onChange={(e) => setHostelId(e.target.value)}
              options={[{ value: 'all', label: 'All hostels' }, ...(hostels.data ?? []).map((h) => ({ value: h.id, label: h.name }))]}
            />
          </Field>
        </div>
        <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <li>
            • Each active hosteler gets an itemised bill: room rent, mess fees for mess members, and the monthly charges set for their hostel
            (electricity, water, internet…) in Settings → Hostels.
            {settings.messMonthlyCharge
              ? ` Hostels without their own mess charge use the default ${formatMoney(settings.messMonthlyCharge)}.`
              : ''}
          </li>
          {selectedHostel && (
            <li>
              • {selectedHostel.name}:{' '}
              {configuredCharges(selectedHostel.charges).length
                ? configuredCharges(selectedHostel.charges)
                    .map((c) => `${c.label} ${formatMoney(c.amount)}`)
                    .join(', ')
                : 'room rent only (no extra charges set)'}
              .
            </li>
          )}
          <li>• Unpaid amounts from earlier bills are not copied in — they show as "previous balance" on the bill.</li>
          <li>• Hostelers are notified and pay to their hostel's UPI ID, then report the payment for you to verify.</li>
          <li>
            • Due date: {month ? formatDate(dueDateFor(month, settings.rentDueDay)) : '—'} (day {settings.rentDueDay} of the month, set in
            Settings).
          </li>
          <li>• Hostelers who already have an invoice for this month are skipped, so it's safe to run again.</li>
        </ul>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Custom invoice                                                      */
/* ------------------------------------------------------------------ */

function CustomInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings()
  const hostelsQ = useHostels()
  const [hosteler, setHosteler] = useState<HostelerListItem | null>(null)
  const [month, setMonth] = useState(currentMonth())
  const [dueDate, setDueDate] = useState(dueDateFor(currentMonth(), settings.rentDueDay))
  const [items, setItems] = useState<DraftItem[]>([])
  const [error, setError] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  const create = useCreateInvoice()

  if (open && !wasOpen) {
    setWasOpen(true)
    setHosteler(null)
    setMonth(currentMonth())
    setDueDate(dueDateFor(currentMonth(), settings.rentDueDay))
    setItems([blankDraft()])
    setError('')
  }
  if (!open && wasOpen) setWasOpen(false)

  const pickHosteler = (h: HostelerListItem | null) => {
    setHosteler(h)
    setError('')
    const blank = items.every((i) => !i.label.trim() && !i.amount)
    if (h && blank && month) {
      // same lines as the monthly bill: rent, mess (if opted) and the hostel's charges
      const charges = hostelsQ.data?.find((x) => x.id === h.hostelId)?.charges
      setItems(toDraft(monthlyBillItems(h, charges, settings.messMonthlyCharge)))
    }
  }

  const quickAdd = (label: string) => setItems((cur) => [...cur.filter((i) => i.label.trim() || i.amount), blankDraft(guessKey(label), label)])

  const save = () => {
    if (!hosteler) return setError('Choose a hosteler')
    if (!month) return setError('Choose a billing month')
    if (!dueDate) return setError('Choose a due date')
    const res = parseItems(items)
    if (res.error) return setError(res.error)
    create.mutate(
      { hostelerId: hosteler.id, month, items: res.items, dueDate },
      {
        onSuccess: (inv) => {
          toast.success(`Invoice ${inv.number} of ${formatMoney(inv.total)} created`)
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create custom invoice"
      description="Bill rent or a one-off charge such as electricity, laundry or damages. Picking a hosteler fills in their usual monthly lines."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={create.isPending}>
            Create invoice
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hosteler" required className="sm:col-span-2">
            <HostelerPicker value={hosteler} onChange={pickHosteler} />
          </Field>
          <Field label="Billing month" required>
            <Input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value)
                if (e.target.value) setDueDate(dueDateFor(e.target.value, settings.rentDueDay))
              }}
            />
          </Field>
          <Field label="Due date" required>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">Line items</p>
            <div className="flex flex-wrap gap-1.5">
              {['Electricity', 'Laundry', 'Damages', 'Maintenance'].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => quickAdd(l)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  + {l}
                </button>
              ))}
            </div>
          </div>
          <ItemsEditor
            items={items}
            onChange={(v) => {
              setItems(v)
              setError('')
            }}
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Overdue reminders                                                   */
/* ------------------------------------------------------------------ */

function OverdueRemindersModal({
  open,
  onClose,
  query,
}: {
  open: boolean
  onClose: () => void
  query: UseQueryResult<DuesResponse>
}) {
  const hostelName = useHostelName()
  const [sent, setSent] = useState<Set<ID>>(new Set())

  const groups = useMemo(() => {
    const out: { d: DueRow; invs: DueRow['invoices']; amount: number; oldest: string }[] = []
    for (const d of query.data?.items ?? []) {
      const invs = d.invoices.filter((i) => i.status === 'overdue')
      if (!invs.length || !d.phone) continue
      out.push({ d, invs, amount: sum(invs, (i) => i.balance), oldest: invs.reduce((m, i) => (i.dueDate < m ? i.dueDate : m), invs[0]!.dueDate) })
    }
    return out.sort((a, b) => b.amount - a.amount)
  }, [query.data])

  const message = (g: (typeof groups)[number]) => {
    const first = g.invs[0]
    return reminderText({
      name: g.d.name,
      amount: g.amount,
      dueDate: g.oldest,
      invoiceNo: g.invs.map((i) => i.number).join(', '),
      month: g.invs.length === 1 && first ? first.month : undefined,
      hostelName: hostelName(g.d.hostelId),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Send reminders to overdue hostelers"
      description="Each button opens WhatsApp with a pre-written reminder"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {query.isLoading ? (
        <LoadingState />
      ) : query.error && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No overdue invoices" description="Everyone is up to date." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <li key={g.d.hostelerId} className="flex items-center gap-3 py-3">
              <Avatar name={g.d.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{g.d.name}</p>
                <p className="text-xs text-slate-500">
                  {g.d.phone} · {g.invs.length} invoice{g.invs.length === 1 ? '' : 's'} · {daysOverdue(g.oldest)} days overdue
                </p>
              </div>
              <p className="font-semibold tabular-nums text-red-600">{formatMoney(g.amount)}</p>
              <a
                href={whatsappUrl(g.d.phone, message(g))}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSent((s) => new Set(s).add(g.d.hostelerId))}
                className={
                  sent.has(g.d.hostelerId)
                    ? 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-500'
                    : 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700'
                }
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {sent.has(g.d.hostelerId) ? 'Opened' : 'WhatsApp'}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/* ================================================================== */
/* Payments tab                                                        */
/* ================================================================== */

const KIND_OPTIONS: { value: Payment['kind'] | ''; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent (invoice)' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'advance', label: 'Advance' },
]

function againstLabel(p: { kind: Payment['kind']; invoiceId: ID | null; note: string; invoice: { number: string; month: string } | null }) {
  if (p.invoice) return `${p.invoice.number} · ${formatMonth(p.invoice.month)}`
  if (p.kind === 'deposit') return 'Security deposit'
  if (p.invoiceId) return 'Deleted invoice'
  return p.note || 'Advance'
}

function PaymentsTab() {
  const scope = useScope()
  const [from, setFrom] = useState(`${currentMonth()}-01`)
  const [to, setTo] = useState(today())
  const [mode, setMode] = useState<PaymentMode | ''>('')
  const [kind, setKind] = useState<Payment['kind'] | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<ID | null>(null)
  const [exporting, setExporting] = useState(false)
  const dq = useDebounced(q.trim())

  useEffect(() => setPage(1), [scope, from, to, mode, kind, dq])

  const filters = { hostelId: scope, from, to, mode, kind, q: dq }
  const query = usePayments({ ...filters, page, limit: PAGE_SIZE })
  const deletePayment = useDeletePayment()
  const data = query.data
  const rows = data?.items ?? []
  const total = data?.totals.amount ?? 0

  const remove = async (id: ID, receiptNo: string, amount: number) => {
    const ok = await confirm({
      title: `Delete receipt ${receiptNo}?`,
      message: `${formatMoney(amount)} will be removed and any linked invoice will show this amount as unpaid again.`,
      confirmText: 'Delete payment',
      danger: true,
    })
    if (!ok) return
    setBusyId(id)
    deletePayment.mutate(id, {
      onSuccess: () => toast.success(`Receipt ${receiptNo} deleted`),
      onSettled: () => setBusyId(null),
    })
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchAllPages(feesApi.payments, { ...filters })
      downloadCsv(`payments-${from || 'start'}-to-${to || 'today'}.csv`, [
        ['Receipt', 'Date', 'Hosteler', 'Phone', 'Hostel', 'Against', 'Mode', 'Reference', 'Amount'],
        ...all.map((p) => [p.receiptNo, p.date, p.hosteler?.name ?? '', p.hosteler?.phone ?? '', p.hostelName, againstLabel(p), modeLabel(p.mode), p.reference, p.amount]),
      ])
    } catch (e) {
      toastError(e, 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="col-span-2 p-4 sm:col-span-3 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total received</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{data ? formatMoney(total) : '…'}</p>
          <p className="text-xs text-slate-500">
            {data ? `${data.totals.count} payment${data.totals.count === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </Card>
        {PAYMENT_MODES.map((m) => {
          const amount = data?.totals.byMode[m.value] ?? 0
          // "online" only exists on payments from the old in-app gateway
          if (m.value === 'online' && !amount) return null
          return (
            <Card key={m.value} className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{data ? formatMoney(amount) : '…'}</p>
              <p className="text-xs text-slate-500">{total ? Math.round((amount / total) * 100) : 0}% of total</p>
            </Card>
          )
        })}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search receipt, name, reference…" className="lg:w-72" />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
            <span className="text-sm text-slate-400">to</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as PaymentMode | '')}
              options={[{ value: '', label: 'All modes' }, ...PAYMENT_MODES]}
              className="w-36"
            />
            <Select value={kind} onChange={(e) => setKind(e.target.value as Payment['kind'] | '')} options={KIND_OPTIONS} className="w-40" />
            {(from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom('')
                  setTo('')
                }}
              >
                All dates
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={() => void exportCsv()}
            loading={exporting}
            disabled={!data?.total}
          >
            CSV
          </Button>
        </div>
        {query.isLoading ? (
          <LoadingState label="Loading payments…" />
        ) : query.error && !data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments found" description="Try widening the date range or clearing filters." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Receipt</TH>
                  <TH>Date</TH>
                  <TH>Hosteler</TH>
                  <TH>Against</TH>
                  <TH>Mode</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-900">
                      {p.receiptNo}
                      {p.recordedBy === 'hosteler' && <p className="text-xs font-normal text-slate-500">UPI · verified claim</p>}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(p.date)}</TD>
                    <TD>
                      <p className="font-medium text-slate-800">{p.hosteler?.name ?? 'Removed hosteler'}</p>
                      <p className="text-xs text-slate-500">{p.hosteler?.phone}</p>
                    </TD>
                    <TD>
                      {p.invoice ? (
                        <span className="whitespace-nowrap">{againstLabel(p)}</span>
                      ) : p.kind === 'deposit' ? (
                        <Badge tone="violet">Deposit</Badge>
                      ) : p.invoiceId ? (
                        <Badge tone="slate">Deleted invoice</Badge>
                      ) : (
                        <Badge tone="blue">Advance</Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge>{modeLabel(p.mode)}</Badge>
                    </TD>
                    <TD className="max-w-[160px] truncate text-slate-500">{p.reference || '—'}</TD>
                    <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(p.amount)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <IconButton label="View receipt" onClick={() => openInNewTab(`/print/receipt/${p.id}`)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Delete payment"
                          className="hover:bg-red-50 hover:text-red-600"
                          disabled={busyId === p.id}
                          onClick={() => void remove(p.id, p.receiptNo, p.amount)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {data && <Pager page={data.page} pages={data.pages} onChange={setPage} busy={query.isFetching} />}
          </>
        )}
      </Card>
    </div>
  )
}

/* ================================================================== */
/* Dues tab                                                            */
/* ================================================================== */

function DuesTab({ query, onPay }: { query: UseQueryResult<DuesResponse>; onPay: (hostelerId: ID) => void }) {
  const hostelName = useHostelName()
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<'amount' | 'days'>('amount')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (query.data?.items ?? [])
      .map((d) => ({ ...d, room: shortRoom(d.roomLabel), status: d.hosteler?.status ?? 'active' }))
      .filter((d) => !needle || d.name.toLowerCase().includes(needle) || d.phone.includes(needle) || d.room.toLowerCase().includes(needle))
      .sort((a, b) => (sortBy === 'amount' ? b.amount - a.amount : b.daysOverdue - a.daysOverdue))
  }, [query.data, q, sortBy])

  const total = sum(rows, (r) => r.amount)
  const overdueTotal = sum(rows, (r) => sum(r.invoices.filter((i) => i.status === 'overdue'), (i) => i.balance))

  const exportCsv = () =>
    downloadCsv(`dues-${today()}.csv`, [
      ['Hosteler', 'Phone', 'Room', 'Status', 'Guardian', 'Guardian phone', 'Open invoices', 'Outstanding', 'Oldest due date', 'Days overdue'],
      ...rows.map((r) => [r.name, r.phone, r.room, r.status, r.guardianName, r.guardianPhone, r.invoices.length, r.amount, r.oldestDueDate, r.daysOverdue]),
    ])

  return (
    <Card>
      <CardHeader
        title="Outstanding dues"
        subtitle={
          query.data
            ? `${rows.length} hosteler${rows.length === 1 ? '' : 's'} owe ${formatMoney(total)} · ${formatMoney(overdueTotal)} past due`
            : 'Loading…'
        }
        action={
          <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        }
      />
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, room…" className="sm:w-72" />
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'amount' | 'days')}
          options={[
            { value: 'amount', label: 'Sort: highest amount' },
            { value: 'days', label: 'Sort: most days overdue' },
          ]}
          className="sm:w-56"
        />
      </div>
      {query.isLoading ? (
        <LoadingState label="Loading dues…" />
      ) : query.error && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={q ? 'No matches' : 'No outstanding dues'}
          description={q ? 'Try a different search.' : 'Every invoice in this scope is fully paid.'}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Hosteler</TH>
              <TH>Room</TH>
              <TH>Phone</TH>
              <TH className="text-right">Outstanding</TH>
              <TH>Oldest due</TH>
              <TH>Overdue</TH>
              <TH className="text-right">Actions</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.hostelerId}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.name || '?'} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{r.name || 'Removed hosteler'}</p>
                      <p className="text-xs text-slate-500">
                        {r.invoices.length} open invoice{r.invoices.length === 1 ? '' : 's'}
                        {r.status === 'checked_out' && ' · checked out'}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>{r.room}</TD>
                <TD className="whitespace-nowrap">{r.phone || '—'}</TD>
                <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(r.amount)}</TD>
                <TD className="whitespace-nowrap">{formatDate(r.oldestDueDate)}</TD>
                <TD>
                  {r.daysOverdue > 0 ? (
                    <Badge tone={r.daysOverdue > 30 ? 'red' : 'amber'}>
                      <CalendarClock className="h-3 w-3" />
                      {r.daysOverdue} day{r.daysOverdue === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge tone="slate">Not yet due</Badge>
                  )}
                </TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => onPay(r.hostelerId)}>
                      Record payment
                    </Button>
                    {r.phone && (
                      <a
                        href={whatsappUrl(
                          r.phone,
                          reminderText({ name: r.name, amount: r.amount, dueDate: r.oldestDueDate, hostelName: hostelName(r.hostelId) }),
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="WhatsApp reminder"
                        aria-label="WhatsApp reminder"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

/* ================================================================== */
/* Deposits tab                                                        */
/* ================================================================== */

function DepositsTab({ onCollect }: { onCollect: (hostelerId: ID) => void }) {
  const scope = useScope()
  const query = useDeposits(scope)
  const [view, setView] = useState<'held' | 'refunded'>('held')
  const [q, setQ] = useState('')

  const needle = q.trim().toLowerCase()
  const match = (r: { hosteler: { name: string; phone: string } | null }) =>
    !needle || (r.hosteler?.name.toLowerCase().includes(needle) ?? false) || (r.hosteler?.phone.includes(needle) ?? false)
  const held = (query.data?.held ?? []).filter(match)
  const refunded = (query.data?.checkedOut ?? []).filter(match)
  const totals = query.data?.totals
  const money = (n: number | undefined) => (n === undefined ? '…' : formatMoney(n))

  const exportCsv = () =>
    downloadCsv(`deposits-${view}-${today()}.csv`, [
      view === 'held'
        ? ['Hosteler', 'Phone', 'Room', 'Status', 'Agreed', 'Collected', 'Pending']
        : ['Hosteler', 'Phone', 'Checked out', 'Deposit', 'Refunded', 'Deducted'],
      ...(view === 'held'
        ? held.map((r) => [r.hosteler?.name ?? '', r.hosteler?.phone ?? '', shortRoom(r.roomLabel), r.status, r.agreed, r.collected, r.pending])
        : refunded.map((r) => [r.hosteler?.name ?? '', r.hosteler?.phone ?? '', r.checkOutDate ?? '', r.collected, r.refundRecorded ? r.refunded : '', r.deducted])),
    ])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Deposits held" value={money(totals?.held)} tone="violet" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Pending collection" value={money(totals?.pending)} tone="amber" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard label="Refunded" value={money(totals?.refunded)} tone="green" icon={<Wallet className="h-5 w-5" />} />
        <StatCard label="Deducted at checkout" value={money(totals?.deducted)} tone="slate" icon={<IndianRupee className="h-5 w-5" />} />
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex self-start rounded-lg bg-slate-100 p-1">
            {(['held', 'refunded'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={
                  view === v
                    ? 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800'
                }
              >
                {v === 'held' ? `Currently held (${held.length})` : `Checked out (${refunded.length})`}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search name or phone…" className="flex-1 sm:w-64" />
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              icon={<Download className="h-4 w-4" />}
              onClick={exportCsv}
              disabled={view === 'held' ? !held.length : !refunded.length}
            >
              CSV
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <LoadingState label="Loading deposits…" />
        ) : query.error && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : view === 'held' ? (
          held.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No deposits held" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Hosteler</TH>
                  <TH>Room</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Agreed</TH>
                  <TH className="text-right">Collected</TH>
                  <TH className="text-right">Pending</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <tbody>
                {held.map((r) => (
                  <TR key={r.hostelerId}>
                    <TD>
                      <p className="font-medium text-slate-800">{r.hosteler?.name ?? 'Removed hosteler'}</p>
                      <p className="text-xs text-slate-500">{r.hosteler?.phone}</p>
                    </TD>
                    <TD>{shortRoom(r.roomLabel)}</TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.agreed)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(r.collected)}</TD>
                    <TD className="text-right tabular-nums">
                      {r.pending > 0 ? <span className="font-medium text-amber-600">{formatMoney(r.pending)}</span> : <span className="text-slate-400">—</span>}
                    </TD>
                    <TD className="text-right">
                      {r.pending > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => onCollect(r.hostelerId)}>
                          Collect
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        ) : refunded.length === 0 ? (
          <EmptyState icon={<Wallet className="h-6 w-6" />} title="No checked-out hostelers" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Hosteler</TH>
                <TH>Checked out</TH>
                <TH className="text-right">Deposit</TH>
                <TH className="text-right">Refunded</TH>
                <TH className="text-right">Deducted</TH>
              </tr>
            </THead>
            <tbody>
              {refunded.map((r) => (
                <TR key={r.hostelerId}>
                  <TD>
                    <p className="font-medium text-slate-800">{r.hosteler?.name ?? 'Removed hosteler'}</p>
                    <p className="text-xs text-slate-500">{r.hosteler?.phone}</p>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(r.checkOutDate)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.collected)}</TD>
                  <TD className="text-right font-semibold tabular-nums text-emerald-700">
                    {r.refundRecorded ? formatMoney(r.refunded) : <span className="font-normal text-slate-400">Not recorded</span>}
                  </TD>
                  <TD className="text-right tabular-nums">{r.deducted ? <span className="text-red-600">{formatMoney(r.deducted)}</span> : '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Deposits are payments recorded as “{DEPOSIT_NOTE}” (no invoice). They are not counted as rent income.
      </p>
    </div>
  )
}
