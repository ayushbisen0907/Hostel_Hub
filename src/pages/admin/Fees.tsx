import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
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
import { useStore } from '@/store'
import {
  inScope,
  invoiceBalance,
  invoicePaid,
  invoiceStatus,
  useHostelName,
  useHostelerMap,
  useScope,
  useScopedHostelers,
} from '@/store/selectors'
import type { Hosteler, ID, Invoice, InvoiceItem, InvoiceStatus, PaymentMode } from '@/types'
import {
  Avatar,
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
  PAYMENT_MODES,
  RecordPaymentModal,
  RowMenu,
  daysOverdue,
  dueDateFor,
  isDeposit,
  modeLabel,
  openInNewTab,
  reminderText,
  whatsappUrl,
} from './_fees'

type TabKey = 'invoices' | 'payments' | 'dues' | 'deposits'
const TAB_KEYS: TabKey[] = ['invoices', 'payments', 'dues', 'deposits']

interface PayTarget {
  hostelerId?: ID
  invoiceId?: ID
  defaultTarget?: 'deposit' | 'advance'
}

/** "101-A" style room label for a hosteler. */
function useRoomLabel() {
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  return useMemo(() => {
    const rm = new Map(rooms.map((r) => [r.id, r]))
    const bm = new Map(beds.map((b) => [b.id, b]))
    return (h: Hosteler | undefined) => {
      if (!h || !h.roomId) return '—'
      const room = rm.get(h.roomId)
      const bed = h.bedId ? bm.get(h.bedId) : undefined
      return room ? `${room.number}${bed ? `-${bed.label}` : ''}` : '—'
    }
  }, [rooms, beds])
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
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const hostelers = useStore((s) => s.hostelers)

  const [month, setMonth] = useState(currentMonth())
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [remindOpen, setRemindOpen] = useState(false)

  const scopedInvoices = useMemo(() => invoices.filter((i) => inScope(i.hostelId, scope)), [invoices, scope])
  const scopedPayments = useMemo(() => payments.filter((p) => inScope(p.hostelId, scope)), [payments, scope])

  const overview = useMemo(() => {
    const db = { payments }
    const monthInv = scopedInvoices.filter((i) => i.month === month && !i.cancelled)
    const billed = sum(monthInv, (i) => i.total)
    const collected = sum(monthInv, (i) => Math.min(invoicePaid(db, i.id), i.total))
    const outstanding = sum(monthInv, (i) => invoiceBalance(db, i))
    const overdue = scopedInvoices.filter((i) => invoiceStatus(db, i) === 'overdue')
    const received = sum(
      scopedPayments.filter((p) => p.date.startsWith(month) && !isDeposit(p)),
      (p) => p.amount,
    )
    return {
      billed,
      collected,
      outstanding,
      rate: billed ? Math.round((collected / billed) * 100) : 0,
      count: monthInv.length,
      overdueCount: overdue.length,
      overdueAmount: sum(overdue, (i) => invoiceBalance(db, i)),
      received,
    }
  }, [scopedInvoices, scopedPayments, payments, month])

  const duesCount = useMemo(() => {
    const db = { payments }
    const ids = new Set(scopedInvoices.filter((i) => invoiceBalance(db, i) > 0).map((i) => i.hostelerId))
    return ids.size
  }, [scopedInvoices, payments])

  const payHostelerOptions = useMemo(
    () =>
      hostelers.filter(
        (h) =>
          inScope(h.hostelId, scope) &&
          (h.status !== 'checked_out' ||
            scopedInvoices.some((i) => i.hostelerId === h.id && invoiceBalance({ payments }, i) > 0)),
      ),
    [hostelers, scope, scopedInvoices, payments],
  )

  const rateTone = overview.rate >= 80 ? 'green' : overview.rate >= 50 ? 'amber' : 'red'

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

      {/* Overview */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Overview · {formatMonth(month)}
        </h2>
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="h-9 w-44"
          aria-label="Overview month"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Billed"
          value={formatMoney(overview.billed)}
          hint={`${overview.count} invoice${overview.count === 1 ? '' : 's'}`}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="Collected"
          value={formatMoney(overview.collected)}
          hint={`${formatMoney(overview.received)} received in ${formatMonth(month)}`}
          tone="green"
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(overview.outstanding)}
          hint="Unpaid balance on this month's invoices"
          tone="amber"
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <StatCard
          label="Overdue invoices"
          value={overview.overdueCount}
          hint={overview.overdueCount ? `${formatMoney(overview.overdueAmount)} past due · all months` : 'Nothing overdue'}
          tone="red"
          icon={<AlertTriangle className="h-5 w-5" />}
          onClick={overview.overdueCount ? () => setRemindOpen(true) : undefined}
        />
      </div>
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">Collection rate</span>
          <span className="font-semibold text-slate-900">{overview.rate}%</span>
        </div>
        <ProgressBar value={overview.rate} tone={overview.count ? rateTone : 'brand'} />
        <p className="mt-2 text-xs text-slate-500">
          {overview.count
            ? `${formatMoney(overview.collected)} of ${formatMoney(overview.billed)} collected for ${formatMonth(month)}`
            : `No invoices for ${formatMonth(month)} yet — use "Generate rent" to bill everyone at once.`}
        </p>
      </Card>

      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'payments', label: 'Payments' },
          { value: 'dues', label: 'Dues', count: duesCount },
          { value: 'deposits', label: 'Deposits' },
        ]}
      />

      <div className="mt-4">
        {tab === 'invoices' && (
          <InvoicesTab
            invoices={scopedInvoices}
            onPay={(inv) => setPayTarget({ hostelerId: inv.hostelerId, invoiceId: inv.id })}
            onRemindAll={() => setRemindOpen(true)}
            overdueCount={overview.overdueCount}
          />
        )}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'dues' && <DuesTab invoices={scopedInvoices} onPay={(hid) => setPayTarget({ hostelerId: hid })} />}
        {tab === 'deposits' && <DepositsTab onCollect={(hid) => setPayTarget({ hostelerId: hid, defaultTarget: 'deposit' })} />}
      </div>

      <RecordPaymentModal
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        hostelerId={payTarget?.hostelerId ?? null}
        invoiceId={payTarget?.invoiceId ?? null}
        defaultTarget={payTarget?.defaultTarget}
        hostelerOptions={payHostelerOptions}
      />
      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} initialMonth={month} />
      <CustomInvoiceModal open={customOpen} onClose={() => setCustomOpen(false)} />
      <OverdueRemindersModal open={remindOpen} onClose={() => setRemindOpen(false)} invoices={scopedInvoices} />
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
  invoices,
  onPay,
  onRemindAll,
  overdueCount,
}: {
  invoices: Invoice[]
  onPay: (inv: Invoice) => void
  onRemindAll: () => void
  overdueCount: number
}) {
  const payments = useStore((s) => s.payments)
  const settings = useStore((s) => s.settings)
  const updateInvoice = useStore((s) => s.updateInvoice)
  const cancelInvoice = useStore((s) => s.cancelInvoice)
  const hmap = useHostelerMap()
  const roomLabel = useRoomLabel()
  const hostelName = useHostelName()

  const [month, setMonth] = useState(currentMonth())
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Invoice | null>(null)

  const rows = useMemo(() => {
    const db = { payments }
    const needle = q.trim().toLowerCase()
    return invoices
      .filter((i) => !month || i.month === month)
      .map((inv) => {
        const h = hmap.get(inv.hostelerId)
        return {
          inv,
          h,
          room: roomLabel(h),
          paid: invoicePaid(db, inv.id),
          balance: invoiceBalance(db, inv),
          status: invoiceStatus(db, inv),
        }
      })
      .filter((r) => !status || r.status === status)
      .filter(
        (r) =>
          !needle ||
          r.inv.number.toLowerCase().includes(needle) ||
          (r.h?.name.toLowerCase().includes(needle) ?? false) ||
          (r.h?.phone.includes(needle) ?? false) ||
          r.room.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.inv.month.localeCompare(a.inv.month) || b.inv.number.localeCompare(a.inv.number, undefined, { numeric: true }))
  }, [invoices, payments, month, status, q, hmap, roomLabel])

  const totals = useMemo(
    () => ({
      total: sum(rows.filter((r) => !r.inv.cancelled), (r) => r.inv.total),
      paid: sum(rows, (r) => r.paid),
      balance: sum(rows, (r) => r.balance),
    }),
    [rows],
  )

  const addLateFee = async (inv: Invoice) => {
    const days = daysOverdue(inv.dueDate)
    const fee = days * settings.lateFeePerDay
    if (days <= 0 || fee <= 0) {
      toast.info(settings.lateFeePerDay ? 'This invoice is not overdue yet.' : 'Set a late fee per day in Settings first.')
      return
    }
    const ok = await confirm({
      title: 'Add late fee?',
      message: `${inv.number} is ${days} day${days === 1 ? '' : 's'} overdue. A late fee of ${formatMoney(fee)} (${formatMoney(settings.lateFeePerDay)}/day) will be added. Any earlier late fee line is replaced.`,
      confirmText: `Add ${formatMoney(fee)}`,
    })
    if (!ok) return
    const items = inv.items.filter((it) => !/^Late fee \(\d+ days?\)$/.test(it.label))
    const replaced = items.length !== inv.items.length
    updateInvoice(inv.id, { items: [...items, { label: `Late fee (${days} day${days === 1 ? '' : 's'})`, amount: fee }] })
    toast.success(replaced ? `Late fee updated to ${formatMoney(fee)}` : `Late fee of ${formatMoney(fee)} added`)
  }

  const cancel = async (inv: Invoice, paid: number) => {
    const ok = await confirm({
      title: `Cancel ${inv.number}?`,
      message:
        paid > 0
          ? `${formatMoney(paid)} has already been paid against this invoice. Those payments stay on record. The invoice will no longer count towards dues.`
          : 'The invoice will be voided and no longer count towards dues. This cannot be undone.',
      confirmText: 'Cancel invoice',
      danger: true,
    })
    if (!ok) return
    cancelInvoice(inv.id)
    toast.success(`${inv.number} cancelled`)
  }

  const remind = (inv: Invoice, balance: number) => {
    const h = hmap.get(inv.hostelerId)
    if (!h?.phone) return toast.error('No phone number on file')
    window.open(
      whatsappUrl(
        h.phone,
        reminderText({ name: h.name, amount: balance, dueDate: inv.dueDate, invoiceNo: inv.number, month: inv.month, hostelName: hostelName(inv.hostelId) }),
      ),
      '_blank',
      'noopener',
    )
  }

  const exportCsv = () => {
    downloadCsv(`invoices-${month || 'all'}.csv`, [
      ['Invoice', 'Hosteler', 'Phone', 'Room', 'Month', 'Total', 'Paid', 'Balance', 'Due date', 'Status'],
      ...rows.map((r) => [r.inv.number, r.h?.name ?? '', r.h?.phone ?? '', r.room, r.inv.month, r.inv.total, r.paid, r.balance, r.inv.dueDate, r.status]),
    ])
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search invoice, name, phone, room…" className="lg:w-72" />
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
          <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
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
              {rows.map(({ inv, h, room, paid, balance, status: st }) => (
                <TR key={inv.id} className={inv.cancelled ? 'opacity-60' : undefined}>
                  <TD className="font-medium text-slate-900">{inv.number}</TD>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={h?.name ?? '?'} src={h?.photo} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{h?.name ?? 'Removed hosteler'}</p>
                        <p className="text-xs text-slate-500">{h?.phone}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>{room}</TD>
                  <TD className="whitespace-nowrap">{formatMonth(inv.month)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(inv.total)}</TD>
                  <TD className="text-right tabular-nums text-emerald-700">{formatMoney(paid)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{balance ? formatMoney(balance) : '—'}</TD>
                  <TD className="whitespace-nowrap">
                    {formatDate(inv.dueDate)}
                    {st === 'overdue' && <p className="text-xs text-red-600">{daysOverdue(inv.dueDate)}d overdue</p>}
                  </TD>
                  <TD>
                    <StatusBadge status={st} />
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      {balance > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => onPay(inv)}>
                          Pay
                        </Button>
                      )}
                      <IconButton label="View / print" onClick={() => openInNewTab(`/print/invoice/${inv.id}`)}>
                        <Eye className="h-4 w-4" />
                      </IconButton>
                      <RowMenu
                        items={[
                          { label: 'Record payment', icon: <Banknote />, onClick: () => onPay(inv), hidden: balance <= 0 },
                          { label: 'View / print', icon: <Printer />, onClick: () => openInNewTab(`/print/invoice/${inv.id}`) },
                          { label: 'Edit items', icon: <Pencil />, onClick: () => setEditing(inv), hidden: inv.cancelled },
                          { label: 'Add late fee', icon: <Timer />, onClick: () => void addLateFee(inv), hidden: st !== 'overdue' },
                          { label: 'Send reminder', icon: <MessageCircle />, onClick: () => remind(inv, balance), hidden: balance <= 0 },
                          { label: 'Cancel invoice', icon: <Ban />, onClick: () => void cancel(inv, paid), danger: true, hidden: inv.cancelled },
                        ]}
                      />
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">
              {rows.length} invoice{rows.length === 1 ? '' : 's'}
            </span>
            <span>
              Total <b className="tabular-nums">{formatMoney(totals.total)}</b>
            </span>
            <span>
              Paid <b className="tabular-nums text-emerald-700">{formatMoney(totals.paid)}</b>
            </span>
            <span>
              Balance <b className="tabular-nums text-red-600">{formatMoney(totals.balance)}</b>
            </span>
          </div>
        </>
      )}

      <EditItemsModal
        invoice={editing}
        onClose={() => setEditing(null)}
        onSave={(items, dueDate) => {
          if (!editing) return
          updateInvoice(editing.id, { items, dueDate })
          toast.success(`${editing.number} updated`)
          setEditing(null)
        }}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Line items editor                                                   */
/* ------------------------------------------------------------------ */

interface DraftItem {
  key: number
  label: string
  amount: string
}

let draftKey = 0
const toDraft = (items: InvoiceItem[]): DraftItem[] => items.map((i) => ({ key: ++draftKey, label: i.label, amount: String(i.amount) }))

function ItemsEditor({ items, onChange }: { items: DraftItem[]; onChange: (v: DraftItem[]) => void }) {
  const total = sum(items, (i) => Number(i.amount) || 0)
  const update = (key: number, patch: Partial<DraftItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  return (
    <div>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-2">
            <Input value={it.label} onChange={(e) => update(it.key, { label: e.target.value })} placeholder="Description" className="flex-1" />
            <Input
              type="number"
              inputMode="decimal"
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
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => onChange([...items, { key: ++draftKey, label: '', amount: '' }])}
        >
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
    out.push({ label: it.label.trim(), amount: amt })
  }
  if (!out.length) return { items: [], error: 'Add at least one line item' }
  if (sum(out, (i) => i.amount) <= 0) return { items: [], error: 'Invoice total must be greater than zero' }
  return { items: out }
}

function EditItemsModal({
  invoice,
  onClose,
  onSave,
}: {
  invoice: Invoice | null
  onClose: () => void
  onSave: (items: InvoiceItem[], dueDate: string) => void
}) {
  const payments = useStore((s) => s.payments)
  const [items, setItems] = useState<DraftItem[]>([])
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<ID | null>(null)

  if (invoice && loadedFor !== invoice.id) {
    setLoadedFor(invoice.id)
    setItems(toDraft(invoice.items))
    setDueDate(invoice.dueDate)
    setError('')
  }
  if (!invoice && loadedFor) setLoadedFor(null)

  const paid = invoice ? invoicePaid({ payments }, invoice.id) : 0

  const save = () => {
    const res = parseItems(items)
    if (res.error) return setError(res.error)
    const total = sum(res.items, (i) => i.amount)
    if (total < paid) return setError(`Total can't be less than the ${formatMoney(paid)} already paid`)
    if (!dueDate) return setError('Choose a due date')
    onSave(res.items, dueDate)
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save changes</Button>
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
  const hostels = useStore((s) => s.hostels)
  const hostelers = useStore((s) => s.hostelers)
  const invoices = useStore((s) => s.invoices)
  const settings = useStore((s) => s.settings)
  const generateInvoices = useStore((s) => s.generateInvoices)

  const [month, setMonth] = useState(initialMonth)
  const [hostelId, setHostelId] = useState<string>(scope)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setMonth(initialMonth)
    setHostelId(scope)
  }
  if (!open && wasOpen) setWasOpen(false)

  const preview = useMemo(() => {
    const billed = new Set(invoices.filter((i) => i.month === month && !i.cancelled).map((i) => i.hostelerId))
    const eligible = hostelers.filter(
      (h) => h.status === 'active' && (hostelId === 'all' || h.hostelId === hostelId) && h.checkInDate.slice(0, 7) <= month,
    )
    const targets = eligible.filter((h) => !billed.has(h.id))
    const amount = sum(targets, (h) => h.monthlyRent + (h.messOpted ? settings.messMonthlyCharge : 0))
    return { skipped: eligible.length - targets.length, count: targets.length, amount }
  }, [invoices, hostelers, month, hostelId, settings.messMonthlyCharge])

  const run = () => {
    if (!month) return toast.error('Choose a month')
    const n = generateInvoices(month, hostelId as ID | 'all')
    if (n) toast.success(`${n} invoice${n === 1 ? '' : 's'} generated for ${formatMonth(month)}`)
    else toast.info(`Everyone is already billed for ${formatMonth(month)}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate monthly rent"
      description="Create rent invoices for every active hosteler in one go"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!preview.count || !month} icon={<Sparkles className="h-4 w-4" />}>
            Generate {preview.count || ''} invoice{preview.count === 1 ? '' : 's'}
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
              options={[{ value: 'all', label: 'All hostels' }, ...hostels.map((h) => ({ value: h.id, label: h.name }))]}
            />
          </Field>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-slate-900">{preview.count}</p>
              <p className="text-xs text-slate-500">to be billed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-400">{preview.skipped}</p>
              <p className="text-xs text-slate-500">already billed</p>
            </div>
            <div>
              <p className="text-xl font-bold text-brand-700 sm:text-2xl">{formatMoney(preview.amount)}</p>
              <p className="text-xs text-slate-500">total amount</p>
            </div>
          </div>
        </div>
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li>
            • Each invoice includes room rent
            {settings.messMonthlyCharge ? `, plus mess charges (${formatMoney(settings.messMonthlyCharge)}) for mess members` : ''}.
          </li>
          <li>
            • Due date: {month ? formatDate(dueDateFor(month, settings.rentDueDay)) : '—'} (day {settings.rentDueDay} of the month, set in Settings).
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
  const hostelers = useScopedHostelers()
  const settings = useStore((s) => s.settings)
  const createInvoice = useStore((s) => s.createInvoice)

  const [hid, setHid] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [dueDate, setDueDate] = useState(dueDateFor(currentMonth(), settings.rentDueDay))
  const [items, setItems] = useState<DraftItem[]>([])
  const [error, setError] = useState('')
  const [wasOpen, setWasOpen] = useState(false)

  if (open && !wasOpen) {
    setWasOpen(true)
    setHid('')
    setMonth(currentMonth())
    setDueDate(dueDateFor(currentMonth(), settings.rentDueDay))
    setItems([{ key: ++draftKey, label: '', amount: '' }])
    setError('')
  }
  if (!open && wasOpen) setWasOpen(false)

  const sorted = useMemo(() => [...hostelers].sort((a, b) => a.name.localeCompare(b.name)), [hostelers])

  const pickHosteler = (id: string) => {
    setHid(id)
    setError('')
    const h = hostelers.find((x) => x.id === id)
    const blank = items.every((i) => !i.label.trim() && !i.amount)
    if (h && blank) {
      const base: InvoiceItem[] = [{ label: `Room rent – ${month}`, amount: h.monthlyRent }]
      if (h.messOpted) base.push({ label: 'Mess charges', amount: settings.messMonthlyCharge })
      setItems(toDraft(base))
    }
  }

  const quickAdd = (label: string) =>
    setItems((cur) => [...cur.filter((i) => i.label.trim() || i.amount), { key: ++draftKey, label, amount: '' }])

  const save = () => {
    if (!hid) return setError('Choose a hosteler')
    if (!month) return setError('Choose a billing month')
    if (!dueDate) return setError('Choose a due date')
    const res = parseItems(items)
    if (res.error) return setError(res.error)
    createInvoice({ hostelerId: hid, month, items: res.items, dueDate })
    toast.success(`Invoice of ${formatMoney(sum(res.items, (i) => i.amount))} created`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Create custom invoice"
      description="Bill rent or a one-off charge such as electricity, laundry or damages"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Create invoice</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hosteler" required className="sm:col-span-2">
            <Select
              value={hid}
              onChange={(e) => pickHosteler(e.target.value)}
              placeholder="Select hosteler…"
              options={sorted.map((h) => ({ value: h.id, label: `${h.name} · ${h.phone}` }))}
            />
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

function OverdueRemindersModal({ open, onClose, invoices }: { open: boolean; onClose: () => void; invoices: Invoice[] }) {
  const payments = useStore((s) => s.payments)
  const hmap = useHostelerMap()
  const hostelName = useHostelName()
  const [sent, setSent] = useState<Set<ID>>(new Set())

  const groups = useMemo(() => {
    const db = { payments }
    const m = new Map<ID, { h: Hosteler; invs: Invoice[]; amount: number; oldest: string }>()
    for (const inv of invoices) {
      if (invoiceStatus(db, inv) !== 'overdue') continue
      const h = hmap.get(inv.hostelerId)
      if (!h) continue
      const g = m.get(h.id) ?? { h, invs: [], amount: 0, oldest: inv.dueDate }
      g.invs.push(inv)
      g.amount += invoiceBalance(db, inv)
      if (inv.dueDate < g.oldest) g.oldest = inv.dueDate
      m.set(h.id, g)
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  }, [invoices, payments, hmap])

  const message = (g: (typeof groups)[number]) => {
    const first = g.invs[0]
    return reminderText({
      name: g.h.name,
      amount: g.amount,
      dueDate: g.oldest,
      invoiceNo: g.invs.map((i) => i.number).join(', '),
      month: g.invs.length === 1 && first ? first.month : undefined,
      hostelName: hostelName(g.h.hostelId),
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
      {groups.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No overdue invoices" description="Everyone is up to date." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((g) => (
            <li key={g.h.id} className="flex items-center gap-3 py-3">
              <Avatar name={g.h.name} src={g.h.photo} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{g.h.name}</p>
                <p className="text-xs text-slate-500">
                  {g.h.phone} · {g.invs.length} invoice{g.invs.length === 1 ? '' : 's'} · {daysOverdue(g.oldest)} days overdue
                </p>
              </div>
              <p className="font-semibold tabular-nums text-red-600">{formatMoney(g.amount)}</p>
              <a
                href={whatsappUrl(g.h.phone, message(g))}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSent((s) => new Set(s).add(g.h.id))}
                className={
                  sent.has(g.h.id)
                    ? 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-500'
                    : 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700'
                }
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {sent.has(g.h.id) ? 'Opened' : 'WhatsApp'}
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

function PaymentsTab() {
  const scope = useScope()
  const payments = useStore((s) => s.payments)
  const invoices = useStore((s) => s.invoices)
  const deletePayment = useStore((s) => s.deletePayment)
  const hmap = useHostelerMap()

  const [from, setFrom] = useState(`${currentMonth()}-01`)
  const [to, setTo] = useState(today())
  const [mode, setMode] = useState<PaymentMode | ''>('')
  const [q, setQ] = useState('')

  const invMap = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return payments
      .filter((p) => inScope(p.hostelId, scope))
      .filter((p) => (!from || p.date >= from) && (!to || p.date <= to))
      .filter((p) => !mode || p.mode === mode)
      .map((p) => {
        const inv = p.invoiceId ? invMap.get(p.invoiceId) : undefined
        const h = hmap.get(p.hostelerId)
        const against = inv
          ? `${inv.number} · ${formatMonth(inv.month)}`
          : isDeposit(p)
            ? 'Security deposit'
            : p.invoiceId
              ? 'Deleted invoice'
              : p.note || 'Advance'
        return { p, h, inv, against }
      })
      .filter(
        (r) =>
          !needle ||
          r.p.receiptNo.toLowerCase().includes(needle) ||
          (r.h?.name.toLowerCase().includes(needle) ?? false) ||
          r.p.reference.toLowerCase().includes(needle) ||
          r.against.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.p.date.localeCompare(a.p.date) || b.p.createdAt.localeCompare(a.p.createdAt))
  }, [payments, scope, from, to, mode, q, invMap, hmap])

  const byMode = useMemo(
    () =>
      PAYMENT_MODES.map((m) => {
        const list = rows.filter((r) => r.p.mode === m.value)
        return { ...m, count: list.length, amount: sum(list, (r) => r.p.amount) }
      }),
    [rows],
  )
  const total = sum(rows, (r) => r.p.amount)

  const remove = async (id: ID, receiptNo: string, amount: number) => {
    const ok = await confirm({
      title: `Delete receipt ${receiptNo}?`,
      message: `${formatMoney(amount)} will be removed and any linked invoice will show this amount as unpaid again.`,
      confirmText: 'Delete payment',
      danger: true,
    })
    if (!ok) return
    deletePayment(id)
    toast.success(`Receipt ${receiptNo} deleted`)
  }

  const exportCsv = () =>
    downloadCsv(`payments-${from || 'start'}-to-${to || 'today'}.csv`, [
      ['Receipt', 'Date', 'Hosteler', 'Phone', 'Against', 'Mode', 'Reference', 'Amount'],
      ...rows.map((r) => [r.p.receiptNo, r.p.date, r.h?.name ?? '', r.h?.phone ?? '', r.against, modeLabel(r.p.mode), r.p.reference, r.p.amount]),
    ])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="col-span-2 p-4 sm:col-span-3 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total received</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(total)}</p>
          <p className="text-xs text-slate-500">
            {rows.length} payment{rows.length === 1 ? '' : 's'}
          </p>
        </Card>
        {byMode.map((m) => (
          <Card key={m.value} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatMoney(m.amount)}</p>
            <p className="text-xs text-slate-500">
              {m.count} · {total ? Math.round((m.amount / total) * 100) : 0}%
            </p>
          </Card>
        ))}
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
          <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments found" description="Try widening the date range or clearing filters." />
        ) : (
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
              {rows.map(({ p, h, inv, against }) => (
                <TR key={p.id}>
                  <TD className="font-medium text-slate-900">{p.receiptNo}</TD>
                  <TD className="whitespace-nowrap">{formatDate(p.date)}</TD>
                  <TD>
                    <p className="font-medium text-slate-800">{h?.name ?? 'Removed hosteler'}</p>
                    <p className="text-xs text-slate-500">{h?.phone}</p>
                  </TD>
                  <TD>
                    {inv ? (
                      <span className="whitespace-nowrap">{against}</span>
                    ) : (
                      <Badge tone={isDeposit(p) ? 'violet' : 'blue'}>{isDeposit(p) ? 'Deposit' : 'Advance'}</Badge>
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
        )}
      </Card>
    </div>
  )
}

/* ================================================================== */
/* Dues tab                                                            */
/* ================================================================== */

function DuesTab({ invoices, onPay }: { invoices: Invoice[]; onPay: (hostelerId: ID) => void }) {
  const payments = useStore((s) => s.payments)
  const hmap = useHostelerMap()
  const roomLabel = useRoomLabel()
  const hostelName = useHostelName()
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<'amount' | 'days'>('amount')

  const rows = useMemo(() => {
    const db = { payments }
    const m = new Map<ID, { h: Hosteler; amount: number; oldest: string; count: number }>()
    for (const inv of invoices) {
      const bal = invoiceBalance(db, inv)
      if (bal <= 0) continue
      const h = hmap.get(inv.hostelerId)
      if (!h) continue
      const g = m.get(h.id) ?? { h, amount: 0, oldest: inv.dueDate, count: 0 }
      g.amount += bal
      g.count += 1
      if (inv.dueDate < g.oldest) g.oldest = inv.dueDate
      m.set(h.id, g)
    }
    const needle = q.trim().toLowerCase()
    return [...m.values()]
      .map((g) => ({ ...g, days: daysOverdue(g.oldest), room: roomLabel(g.h) }))
      .filter((g) => !needle || g.h.name.toLowerCase().includes(needle) || g.h.phone.includes(needle) || g.room.toLowerCase().includes(needle))
      .sort((a, b) => (sortBy === 'amount' ? b.amount - a.amount : b.days - a.days))
  }, [invoices, payments, hmap, roomLabel, q, sortBy])

  const total = sum(rows, (r) => r.amount)
  const overdueTotal = sum(rows.filter((r) => r.days > 0), (r) => r.amount)

  const exportCsv = () =>
    downloadCsv(`dues-${today()}.csv`, [
      ['Hosteler', 'Phone', 'Room', 'Status', 'Open invoices', 'Outstanding', 'Oldest due date', 'Days overdue'],
      ...rows.map((r) => [r.h.name, r.h.phone, r.room, r.h.status, r.count, r.amount, r.oldest, r.days]),
    ])

  return (
    <Card>
      <CardHeader
        title="Outstanding dues"
        subtitle={`${rows.length} hosteler${rows.length === 1 ? '' : 's'} owe ${formatMoney(total)} · ${formatMoney(overdueTotal)} past due`}
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
      {rows.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No outstanding dues" description="Every invoice in this scope is fully paid." />
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
              <TR key={r.h.id}>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.h.name} src={r.h.photo} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{r.h.name}</p>
                      <p className="text-xs text-slate-500">
                        {r.count} open invoice{r.count === 1 ? '' : 's'}
                        {r.h.status === 'checked_out' && ' · checked out'}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>{r.room}</TD>
                <TD className="whitespace-nowrap">{r.h.phone}</TD>
                <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(r.amount)}</TD>
                <TD className="whitespace-nowrap">{formatDate(r.oldest)}</TD>
                <TD>
                  {r.days > 0 ? (
                    <Badge tone={r.days > 30 ? 'red' : 'amber'}>
                      <CalendarClock className="h-3 w-3" />
                      {r.days} day{r.days === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge tone="slate">Not yet due</Badge>
                  )}
                </TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => onPay(r.h.id)}>
                      Record payment
                    </Button>
                    <a
                      href={whatsappUrl(r.h.phone, reminderText({ name: r.h.name, amount: r.amount, dueDate: r.oldest, hostelName: hostelName(r.h.hostelId) }))}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp reminder"
                      aria-label="WhatsApp reminder"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
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
  const hostelers = useScopedHostelers({ includeCheckedOut: true })
  const payments = useStore((s) => s.payments)
  const roomLabel = useRoomLabel()
  const [view, setView] = useState<'held' | 'refunded'>('held')
  const [q, setQ] = useState('')

  const all = useMemo(() => {
    const collectedBy = new Map<ID, number>()
    for (const p of payments) if (isDeposit(p)) collectedBy.set(p.hostelerId, (collectedBy.get(p.hostelerId) ?? 0) + p.amount)
    return hostelers.map((h) => {
      const collected = collectedBy.get(h.id) ?? 0
      const out = h.status === 'checked_out'
      // older records may lack a deposit receipt for checked-out hostelers — fall back to the agreed deposit
      const basis = out && collected === 0 && h.depositRefunded !== null ? h.securityDeposit : collected
      const refunded = out ? h.depositRefunded ?? 0 : 0
      return {
        h,
        agreed: h.securityDeposit,
        collected: basis,
        refunded,
        deducted: out ? Math.max(basis - refunded, 0) : 0,
        held: out ? 0 : collected,
        pending: out ? 0 : Math.max(h.securityDeposit - collected, 0),
      }
    })
  }, [hostelers, payments])

  const needle = q.trim().toLowerCase()
  const match = (h: Hosteler) => !needle || h.name.toLowerCase().includes(needle) || h.phone.includes(needle)
  const held = all
    .filter((r) => r.h.status !== 'checked_out' && (r.collected > 0 || r.agreed > 0) && match(r.h))
    .sort((a, b) => b.held - a.held)
  const refunded = all
    .filter((r) => r.h.status === 'checked_out' && match(r.h))
    .sort((a, b) => (b.h.checkOutDate ?? '').localeCompare(a.h.checkOutDate ?? ''))

  const totals = {
    held: sum(all, (r) => r.held),
    pending: sum(all, (r) => r.pending),
    refunded: sum(all, (r) => r.refunded),
    deducted: sum(all, (r) => r.deducted),
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Deposits held" value={formatMoney(totals.held)} tone="violet" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Pending collection" value={formatMoney(totals.pending)} tone="amber" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard label="Refunded" value={formatMoney(totals.refunded)} tone="green" icon={<Wallet className="h-5 w-5" />} />
        <StatCard label="Deducted at checkout" value={formatMoney(totals.deducted)} tone="slate" icon={<IndianRupee className="h-5 w-5" />} />
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
          <SearchInput value={q} onChange={setQ} placeholder="Search name or phone…" className="sm:w-64" />
        </div>

        {view === 'held' ? (
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
                  <TR key={r.h.id}>
                    <TD>
                      <p className="font-medium text-slate-800">{r.h.name}</p>
                      <p className="text-xs text-slate-500">{r.h.phone}</p>
                    </TD>
                    <TD>{roomLabel(r.h)}</TD>
                    <TD>
                      <StatusBadge status={r.h.status} />
                    </TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.agreed)}</TD>
                    <TD className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(r.collected)}</TD>
                    <TD className="text-right tabular-nums">
                      {r.pending > 0 ? (
                        <span className="font-medium text-amber-600">{formatMoney(r.pending)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {r.pending > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => onCollect(r.h.id)}>
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
                <TR key={r.h.id}>
                  <TD>
                    <p className="font-medium text-slate-800">{r.h.name}</p>
                    <p className="text-xs text-slate-500">{r.h.phone}</p>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(r.h.checkOutDate)}</TD>
                  <TD className="text-right tabular-nums">{formatMoney(r.collected)}</TD>
                  <TD className="text-right font-semibold tabular-nums text-emerald-700">
                    {r.h.depositRefunded === null ? <span className="font-normal text-slate-400">Not recorded</span> : formatMoney(r.refunded)}
                  </TD>
                  <TD className="text-right tabular-nums">{r.deducted ? <span className="text-red-600">{formatMoney(r.deducted)}</span> : '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Deposits are payments recorded with no invoice and the note “{DEPOSIT_NOTE}”. They are not counted as rent income.
      </p>
    </div>
  )
}
