import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, MoreVertical, Printer, ShieldAlert, X } from 'lucide-react'
import { useSession } from '@/api/session'
import { useScope } from '@/api/common'
import type { ID, PaymentMode } from '@/api/types'
import {
  useDepositCollected,
  useFeesHosteler,
  useHostelerSearch,
  useOpenInvoices,
  useRecordPayment,
  type HostelerListItem,
} from '@/api/fees'
import { Avatar, Button, Field, Input, Modal, SearchInput, Select, Spinner, toast } from '@/components/ui'
import { cn, daysBetween, formatDate, formatMoney, formatMonth, today } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'online', label: 'Online' },
]

/** Modes staff can record (the old in-app "online" gateway is gone; it stays above for history and filters). */
export const RECORD_MODES = PAYMENT_MODES.filter((m) => m.value !== 'online')

export function modeLabel(m: PaymentMode): string {
  return PAYMENT_MODES.find((x) => x.value === m)?.label ?? m
}

export const DEPOSIT_NOTE = 'Security deposit'

export function isDeposit(p: { kind: 'rent' | 'deposit' | 'advance' }) {
  return p.kind === 'deposit'
}

/** Days an invoice is past its due date (0 if not yet due). */
export function daysOverdue(dueDate: string): number {
  return Math.max(daysBetween(dueDate, today()), 0)
}

export function dueDateFor(month: string, dueDay: number): string {
  const d = Math.min(Math.max(dueDay, 1), 28)
  return `${month}-${String(d).padStart(2, '0')}`
}

export function whatsappUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10)
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`
}

export function reminderText(opts: {
  name: string
  amount: number
  dueDate?: string
  invoiceNo?: string
  month?: string
  hostelName?: string
}): string {
  const parts = [`Hi ${opts.name.split(' ')[0]},`]
  let line = `This is a gentle reminder that ${formatMoney(opts.amount)} is due`
  if (opts.invoiceNo) line += ` against invoice ${opts.invoiceNo}`
  if (opts.month) line += ` (${formatMonth(opts.month)})`
  if (opts.dueDate) line += `. Due date: ${formatDate(opts.dueDate)}`
  parts.push(line + '.')
  parts.push('Kindly clear the payment at the earliest. Please ignore if already paid.')
  parts.push(`– ${opts.hostelName ?? 'Hostel Management'}`)
  return parts.join('\n')
}

export function openInNewTab(path: string) {
  window.open(path, '_blank', 'noopener')
}

/** Value that only updates after `ms` without changes (for search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/* ------------------------------------------------------------------ */
/* Amount in words (Indian numbering)                                  */
/* ------------------------------------------------------------------ */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  const t = TENS[Math.floor(n / 10)] ?? ''
  const o = ONES[n % 10] ?? ''
  return o ? `${t} ${o}` : t
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const out: string[] = []
  if (h) out.push(`${ONES[h]} Hundred`)
  if (rest) out.push(twoDigits(rest))
  return out.join(' ')
}

/** Integer to words using Indian grouping (crore, lakh, thousand, hundred). */
export function numberToWordsIndian(num: number): string {
  let n = Math.floor(Math.abs(num))
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  n %= 10000000
  const lakh = Math.floor(n / 100000)
  n %= 100000
  const thousand = Math.floor(n / 1000)
  n %= 1000
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (n) parts.push(threeDigits(n))
  return parts.join(' ')
}

/** e.g. 12500 -> "Rupees Twelve Thousand Five Hundred Only" */
export function amountInWords(amount: number): string {
  const abs = Math.abs(amount)
  const rupees = Math.floor(abs)
  const paise = Math.round((abs - rupees) * 100)
  let s = `Rupees ${numberToWordsIndian(rupees)}`
  if (paise > 0) s += ` and ${twoDigits(paise)} Paise`
  return `${amount < 0 ? 'Minus ' : ''}${s} Only`
}

/* ------------------------------------------------------------------ */
/* Row action menu (fixed-position so it escapes table overflow)       */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

export function RowMenu({ items, disabled }: { items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const visible = items.filter((i) => !i.hidden)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const width = 208
    const height = (menu.current?.offsetHeight ?? visible.length * 38) + 8
    const top = r.bottom + height > window.innerHeight ? Math.max(r.top - height, 8) : r.bottom + 4
    setPos({ top, left: Math.max(Math.min(r.right - width, window.innerWidth - width - 8), 8) })
  }, [open, visible.length])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', shut, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('resize', shut)
    }
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="More actions"
        title="More actions"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? <Spinner className="h-4 w-4" /> : <MoreVertical className="h-4 w-4" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[55] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {visible.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                  it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Pagination footer                                                   */
/* ------------------------------------------------------------------ */

export function Pager({
  page,
  pages,
  onChange,
  busy,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
  busy?: boolean
}) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-slate-500">
        Page {page} of {pages}
        {busy && <Spinner className="h-3.5 w-3.5" />}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1 || busy} onClick={() => onChange(page - 1)}>
          Prev
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages || busy} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hosteler picker (server-side search)                                */
/* ------------------------------------------------------------------ */

export function roomOf(h: Pick<HostelerListItem, 'roomNumber' | 'bedLabel' | 'status'>): string {
  if (h.status === 'checked_out') return 'Checked out'
  if (!h.roomNumber) return 'No bed'
  return `${h.roomNumber}${h.bedLabel ? `-${h.bedLabel}` : ''}`
}

export function HostelerPicker({
  value,
  onChange,
  disabled,
  loading,
}: {
  value: HostelerListItem | null
  onChange: (h: HostelerListItem | null) => void
  disabled?: boolean
  loading?: boolean
}) {
  const scope = useScope()
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const search = useHostelerSearch(debounced, scope, !value && !disabled)

  if (loading) {
    return (
      <div className="flex h-14 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading hosteler…
      </div>
    )
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <Avatar name={value.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-800">{value.name}</p>
          <p className="truncate text-xs text-slate-500">
            {value.phone} · {roomOf(value)}
            {value.dues > 0 && <span className="text-red-600"> · dues {formatMoney(value.dues)}</span>}
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            aria-label="Change hosteler"
            title="Change hosteler"
            onClick={() => onChange(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  const list = search.data ?? []
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Search name, phone or login id…" />
      <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
        {search.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Searching…
          </div>
        ) : search.error ? (
          <p className="px-3 py-4 text-center text-sm text-red-600">Couldn't load hostelers</p>
        ) : list.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-slate-500">{debounced ? 'No hostelers match' : 'No hostelers yet'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onChange(h)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <Avatar name={h.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {h.name}
                      {h.status === 'checked_out' && <span className="font-normal text-slate-400"> (checked out)</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {h.phone} · {roomOf(h)}
                    </p>
                  </div>
                  {h.dues > 0 && <span className="text-xs font-semibold tabular-nums text-red-600">{formatMoney(h.dues)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Record payment modal                                                */
/* ------------------------------------------------------------------ */

export function RecordPaymentModal({
  open,
  onClose,
  hostelerId,
  invoiceId,
  defaultTarget,
}: {
  open: boolean
  onClose: () => void
  /** Pre-selected hosteler; when set together with invoiceId the selection is locked. */
  hostelerId?: ID | null
  invoiceId?: ID | null
  defaultTarget?: 'deposit' | 'advance'
}) {
  const [picked, setPicked] = useState<HostelerListItem | null>(null)
  const [target, setTarget] = useState<string>('')
  const [initFor, setInitFor] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('upi')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: ID; receiptNo: string; amount: number } | null>(null)

  const preset = hostelerId ?? null
  const hid = picked?.id ?? preset ?? ''
  const presetQ = useFeesHosteler(open && !picked ? preset : null)
  const hosteler = picked ?? (preset ? (presetQ.data ?? null) : null)
  const invoicesQ = useOpenInvoices(open ? hid || null : null)
  const depositQ = useDepositCollected(open ? hid || null : null)
  const record = useRecordPayment()

  const openInvoices = invoicesQ.data ?? []
  const depositPending = hosteler ? Math.max(hosteler.securityDeposit - (depositQ.data ?? 0), 0) : 0
  // open bills that already carry a "Security deposit" line (collect those against the bill, not separately)
  const depositBills = openInvoices.filter((i) => i.items.some((it) => it.key === 'deposit'))

  // reset on open
  useEffect(() => {
    if (!open) return
    setPicked(null)
    setMode('upi')
    setReference('')
    setDate(today())
    setError('')
    setDone(null)
    setTarget('')
    setInitFor('')
    setAmount('')
  }, [open, hostelerId])

  // choose a default target/amount once the hosteler's open invoices are known
  useEffect(() => {
    if (!open || !hid || initFor === hid || !invoicesQ.data) return
    if (defaultTarget === 'deposit' && (!hosteler || depositQ.data === undefined)) return
    const list = invoicesQ.data
    setInitFor(hid)
    const inv = (invoiceId && list.find((i) => i.id === invoiceId)) || (!defaultTarget ? list[0] : undefined)
    if (inv) {
      setTarget(`inv:${inv.id}`)
      setAmount(String(inv.balance))
    } else if (defaultTarget === 'deposit') {
      setTarget('deposit')
      setAmount(depositPending ? String(depositPending) : '')
    } else {
      setTarget('advance')
      setAmount('')
    }
  }, [open, hid, initFor, invoicesQ.data, invoiceId, defaultTarget, hosteler, depositQ.data, depositPending])

  const selectedInvoice = target.startsWith('inv:') ? openInvoices.find((i) => i.id === target.slice(4)) : undefined
  const maxAmount = selectedInvoice ? selectedInvoice.balance : Infinity
  const locked = Boolean(hostelerId && invoiceId)

  const changeTarget = (v: string) => {
    setTarget(v)
    setError('')
    if (v.startsWith('inv:')) {
      const inv = openInvoices.find((i) => i.id === v.slice(4))
      setAmount(inv ? String(inv.balance) : '')
    } else if (v === 'deposit') {
      setAmount(depositPending ? String(depositPending) : '')
    }
  }

  const pickHosteler = (h: HostelerListItem | null) => {
    setPicked(h)
    setInitFor('')
    setTarget('')
    setAmount('')
    setError('')
  }

  const submit = () => {
    const amt = Number(amount)
    if (!hid) return setError('Choose a hosteler')
    if (!target) return setError('Choose what this payment is for')
    if (!amt || amt <= 0 || !Number.isFinite(amt)) return setError('Enter a valid amount')
    if (!Number.isInteger(amt)) return setError('Amount must be a whole number')
    if (selectedInvoice && amt > maxAmount) return setError(`Amount can't exceed the balance of ${formatMoney(maxAmount)}`)
    if (!date) return setError('Choose a payment date')
    record.mutate(
      {
        hostelerId: hid,
        invoiceId: selectedInvoice?.id ?? null,
        amount: amt,
        mode,
        reference: reference.trim(),
        date,
        ...(target === 'deposit' ? { kind: 'deposit' as const } : target === 'advance' ? { kind: 'advance' as const, note: 'Advance' } : {}),
      },
      {
        onSuccess: (p) => {
          toast.success(`${formatMoney(p.amount)} recorded · Receipt ${p.receiptNo}`)
          setDone({ id: p.id, receiptNo: p.receiptNo, amount: p.amount })
        },
      },
    )
  }

  if (done) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="Payment recorded"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={() => openInNewTab(`/print/receipt/${done.id}`)}>
              View receipt
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatMoney(done.amount)}</p>
          <p className="mt-1 text-sm text-slate-500">
            Received from {hosteler?.name ?? 'hosteler'} · Receipt <span className="font-medium text-slate-700">{done.receiptNo}</span>
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      description={locked && selectedInvoice ? `Against invoice ${selectedInvoice.number}` : 'Record rent, a deposit or an advance'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={record.isPending} disabled={!hid || !target}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Hosteler" required>
          {preset && !picked && presetQ.error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Couldn't load this hosteler.</p>
          ) : (
            <HostelerPicker
              value={hosteler}
              onChange={pickHosteler}
              disabled={Boolean(preset)}
              loading={Boolean(preset && !picked && presetQ.isLoading)}
            />
          )}
        </Field>

        {hid && (
          <Field label="Payment for" required>
            {invoicesQ.isLoading ? (
              <div className="flex h-10 items-center gap-2 text-sm text-slate-500">
                <Spinner className="h-4 w-4" /> Loading open invoices…
              </div>
            ) : invoicesQ.error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Couldn't load this hosteler's invoices.</p>
            ) : (
              <>
                <Select
                  value={target}
                  disabled={locked}
                  onChange={(e) => changeTarget(e.target.value)}
                  placeholder="Choose…"
                  options={[
                    ...openInvoices.map((i) => ({
                      value: `inv:${i.id}`,
                      label: `${i.number} · ${formatMonth(i.month)} · balance ${formatMoney(i.balance)}`,
                    })),
                    { value: 'deposit', label: 'Security deposit (no invoice)' },
                    { value: 'advance', label: 'Advance payment (no invoice)' },
                  ]}
                />
                {openInvoices.length === 0 && <span className="mt-1 block text-xs text-slate-500">No open invoices for this hosteler.</span>}
                {target === 'deposit' && hosteler && (
                  <span className="mt-1 block text-xs text-slate-500">
                    Agreed {formatMoney(hosteler.securityDeposit)} · collected {formatMoney(depositQ.data ?? 0)}
                  </span>
                )}
                {target === 'deposit' && depositBills.length > 0 && (
                  <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    The security deposit is already on bill {depositBills.map((i) => i.number).join(', ')}. To collect it, record the payment
                    against that bill instead — the deposit part gets its own receipt.
                  </span>
                )}
              </>
            )}
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" required hint={selectedInvoice ? `Balance due: ${formatMoney(maxAmount)}` : undefined}>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setError('')
              }}
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode" required>
            <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} options={RECORD_MODES} />
          </Field>
          <Field label="Reference" hint="UTR / cheque / transaction id">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" maxLength={100} />
          </Field>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Print page pieces                                                   */
/* ------------------------------------------------------------------ */

export function PrintToolbar({ title, canPrint = true }: { title: string; canPrint?: boolean }) {
  const navigate = useNavigate()
  const kind = useSession((s) => s.session?.kind)
  const back = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(kind === 'hosteler' ? '/portal/fees' : '/app/fees')
  }
  return (
    <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={back}>
          Back
        </Button>
        <p className="hidden truncate text-sm font-medium text-slate-600 sm:block">{title}</p>
        <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!canPrint}>
          Print
        </Button>
      </div>
    </div>
  )
}

export function PrintMessage({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <PrintToolbar title={title} canPrint={false} />
      <div className="mx-auto mt-16 max-w-md px-4 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

/** A4-sized white sheet that prints edge-to-edge. */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }`}</style>
      {children}
    </div>
  )
}
