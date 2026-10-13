import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, MoreVertical, Printer, ShieldAlert } from 'lucide-react'
import { useStore } from '@/store'
import { invoiceBalance } from '@/store/selectors'
import type { Hosteler, ID, Invoice, PaymentMode } from '@/types'
import { Button, Field, Input, Modal, Select, toast } from '@/components/ui'
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

export function modeLabel(m: PaymentMode): string {
  return PAYMENT_MODES.find((x) => x.value === m)?.label ?? m
}

export const DEPOSIT_NOTE = 'Security deposit'

export function isDeposit(p: { invoiceId: ID | null; note: string }) {
  return p.invoiceId === null && p.note === DEPOSIT_NOTE
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

export function RowMenu({ items }: { items: MenuItem[] }) {
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
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
      >
        <MoreVertical className="h-4 w-4" />
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
/* Record payment modal                                                */
/* ------------------------------------------------------------------ */

type Target = { kind: 'invoice'; id: ID } | { kind: 'deposit' } | { kind: 'advance' }

function targetKey(t: Target) {
  return t.kind === 'invoice' ? `inv:${t.id}` : t.kind
}

export function RecordPaymentModal({
  open,
  onClose,
  hostelerId,
  invoiceId,
  defaultTarget,
  hostelerOptions,
}: {
  open: boolean
  onClose: () => void
  /** Pre-selected hosteler; when set together with invoiceId the selection is locked. */
  hostelerId?: ID | null
  invoiceId?: ID | null
  defaultTarget?: 'deposit' | 'advance'
  /** Hostelers to choose from when none is pre-selected. */
  hostelerOptions?: Hosteler[]
}) {
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const hostelers = useStore((s) => s.hostelers)
  const recordPayment = useStore((s) => s.recordPayment)

  const [hid, setHid] = useState<ID>('')
  const [target, setTarget] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('upi')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today())
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: ID; receiptNo: string; amount: number } | null>(null)

  const openInvoices = useMemo(
    () =>
      invoices
        .filter((i) => i.hostelerId === hid && !i.cancelled && invoiceBalance({ payments }, i) > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoices, payments, hid],
  )

  const balanceOf = (inv: Invoice) => invoiceBalance({ payments }, inv)

  // reset on open
  useEffect(() => {
    if (!open) return
    setHid(hostelerId ?? '')
    setMode('upi')
    setReference('')
    setDate(today())
    setError('')
    setDone(null)
    setTarget('')
    setAmount('')
  }, [open, hostelerId])

  // choose a default target/amount whenever hosteler changes
  useEffect(() => {
    if (!open || !hid) return
    const st = useStore.getState()
    const open_ = st.invoices
      .filter((i) => i.hostelerId === hid && !i.cancelled && invoiceBalance(st, i) > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    let t: Target
    if (invoiceId && open_.some((i) => i.id === invoiceId)) t = { kind: 'invoice', id: invoiceId }
    else if (defaultTarget) t = { kind: defaultTarget }
    else if (open_[0]) t = { kind: 'invoice', id: open_[0].id }
    else t = { kind: 'advance' }
    setTarget(targetKey(t))
    if (t.kind === 'invoice') {
      const inv = open_.find((i) => i.id === (t as { id: ID }).id)
      setAmount(inv ? String(invoiceBalance(st, inv)) : '')
    } else if (t.kind === 'deposit') {
      const h = st.hostelers.find((x) => x.id === hid)
      const paid = st.payments.filter((p) => p.hostelerId === hid && isDeposit(p)).reduce((a, p) => a + p.amount, 0)
      setAmount(h ? String(Math.max(h.securityDeposit - paid, 0) || '') : '')
    } else setAmount('')
  }, [open, hid, invoiceId, defaultTarget])

  const selectedInvoice = target.startsWith('inv:') ? openInvoices.find((i) => i.id === target.slice(4)) : undefined
  const maxAmount = selectedInvoice ? balanceOf(selectedInvoice) : Infinity
  const hosteler = hostelers.find((h) => h.id === hid)
  const locked = Boolean(hostelerId && invoiceId)

  const pickList = useMemo(() => {
    const list = hostelerOptions ?? hostelers.filter((h) => h.status !== 'checked_out')
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [hostelerOptions, hostelers])

  const changeTarget = (v: string) => {
    setTarget(v)
    setError('')
    if (v.startsWith('inv:')) {
      const inv = openInvoices.find((i) => i.id === v.slice(4))
      setAmount(inv ? String(balanceOf(inv)) : '')
    } else if (v === 'deposit' && hosteler) {
      const paid = payments.filter((p) => p.hostelerId === hid && isDeposit(p)).reduce((a, p) => a + p.amount, 0)
      setAmount(String(Math.max(hosteler.securityDeposit - paid, 0) || ''))
    }
  }

  const submit = () => {
    const amt = Number(amount)
    if (!hid) return setError('Choose a hosteler')
    if (!target) return setError('Choose what this payment is for')
    if (!amt || amt <= 0 || !Number.isFinite(amt)) return setError('Enter a valid amount')
    if (selectedInvoice && amt > maxAmount) return setError(`Amount can't exceed the balance of ${formatMoney(maxAmount)}`)
    if (!date) return setError('Choose a payment date')
    const p = recordPayment({
      invoiceId: selectedInvoice?.id ?? null,
      hostelerId: hid,
      amount: amt,
      mode,
      reference: reference.trim(),
      date,
      note: target === 'deposit' ? DEPOSIT_NOTE : target === 'advance' ? 'Advance' : '',
    })
    toast.success(`${formatMoney(amt)} recorded · Receipt ${p.receiptNo}`)
    setDone({ id: p.id, receiptNo: p.receiptNo, amount: amt })
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Record payment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Hosteler" required>
          <Select
            value={hid}
            disabled={Boolean(hostelerId)}
            onChange={(e) => setHid(e.target.value)}
            placeholder="Select hosteler…"
            options={(hostelerId && hosteler ? [hosteler] : pickList).map((h) => ({
              value: h.id,
              label: `${h.name}${h.status === 'checked_out' ? ' (checked out)' : ''} · ${h.phone}`,
            }))}
          />
        </Field>

        {hid && (
          <Field label="Payment for" required>
            <Select
              value={target}
              disabled={locked}
              onChange={(e) => changeTarget(e.target.value)}
              options={[
                ...openInvoices.map((i) => ({
                  value: `inv:${i.id}`,
                  label: `${i.number} · ${formatMonth(i.month)} · balance ${formatMoney(balanceOf(i))}`,
                })),
                { value: 'deposit', label: 'Security deposit (no invoice)' },
                { value: 'advance', label: 'Advance payment (no invoice)' },
              ]}
            />
            {openInvoices.length === 0 && (
              <span className="mt-1 block text-xs text-slate-500">No open invoices for this hosteler.</span>
            )}
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Amount (₹)"
            required
            hint={selectedInvoice ? `Balance due: ${formatMoney(maxAmount)}` : undefined}
          >
            <Input
              type="number"
              min={1}
              inputMode="decimal"
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
            <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} options={PAYMENT_MODES} />
          </Field>
          <Field label="Reference" hint="UTR / cheque / transaction id">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
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

export function PrintToolbar({ title }: { title: string }) {
  const navigate = useNavigate()
  const session = useStore((s) => s.session)
  const back = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(session?.kind === 'hosteler' ? '/portal/fees' : '/app/fees')
  }
  return (
    <div className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={back}>
          Back
        </Button>
        <p className="hidden truncate text-sm font-medium text-slate-600 sm:block">{title}</p>
        <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </div>
  )
}

export function PrintMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <PrintToolbar title={title} />
      <div className="mx-auto mt-16 max-w-md px-4 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
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
