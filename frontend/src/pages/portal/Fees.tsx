import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Receipt,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react'
import { useStore } from '@/store'
import { invoiceBalance, invoicePaid, invoiceStatus, useCurrentHosteler } from '@/store/selectors'
import { Button, Card, EmptyState, Field, Input, Modal, Select, StatusBadge, toast } from '@/components/ui'
import { cn, formatDate, formatMonth, today } from '@/lib/utils'
import type { Invoice, Payment, PaymentMode } from '@/types'
import { NotLoggedIn, PortalTitle, SectionTitle, openInNewTab, useMoney } from './_shared'

type Method = 'upi' | 'card' | 'netbanking'

const METHOD_MODE: Record<Method, PaymentMode> = { upi: 'upi', card: 'card', netbanking: 'online' }

const BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Yes Bank',
]

const MODE_LABEL: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  online: 'Net banking',
}

function genTxnId(prefix: string) {
  const rand = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('')
  return `${prefix}${Date.now().toString().slice(-4)}${rand}`
}

/** Deterministic QR-looking grid */
function FakeQR({ seed }: { seed: string }) {
  const n = 25
  const cells = useMemo(() => {
    let h = 0
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const out: boolean[] = []
    for (let i = 0; i < n * n; i++) {
      h = (h * 1103515245 + 12345) >>> 0
      out.push(((h >>> 16) & 1) === 1)
    }
    return out
  }, [seed])
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7
    return inBox(0, 0) || inBox(n - 7, 0) || inBox(0, n - 7)
  }
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="h-44 w-44 text-slate-900" shapeRendering="crispEdges" aria-label="UPI QR code">
      <rect width={n} height={n} fill="white" />
      {cells.map((on, i) => {
        const x = i % n
        const y = Math.floor(i / n)
        if (finder(x, y) || !on) return null
        return <rect key={i} x={x} y={y} width={1} height={1} fill="currentColor" />
      })}
      {[
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={7} height={7} fill="currentColor" />
          <rect x={x! + 1} y={y! + 1} width={5} height={5} fill="white" />
          <rect x={x! + 2} y={y! + 2} width={3} height={3} fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

function luhnOk(num: string) {
  let sum = 0
  let dbl = false
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i])
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

function PayModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const me = useCurrentHosteler()
  const payments = useStore((s) => s.payments)
  const recordPayment = useStore((s) => s.recordPayment)
  const money = useMoney()

  const balance = invoice ? invoiceBalance({ payments }, invoice) : 0
  const [step, setStep] = useState<'form' | 'processing' | 'success'>('form')
  const [method, setMethod] = useState<Method>('upi')
  const [amount, setAmount] = useState('')
  const [upiTxn, setUpiTxn] = useState('')
  const [cardNo, setCardNo] = useState('')
  const [cardName, setCardName] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [bank, setBank] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Payment | null>(null)

  useEffect(() => {
    if (invoice) {
      setStep('form')
      setMethod('upi')
      setAmount(String(invoiceBalance({ payments: useStore.getState().payments }, invoice)))
      setUpiTxn('')
      setCardNo('')
      setCardName(me?.name ?? '')
      setExpiry('')
      setCvv('')
      setBank('')
      setErrors({})
      setResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id])

  if (!invoice || !me) return null

  const validate = () => {
    const e: Record<string, string> = {}
    const amt = Number(amount)
    if (!amount || Number.isNaN(amt) || amt < 1) e.amount = 'Enter an amount of at least 1'
    else if (amt > balance) e.amount = `Amount can't exceed the balance of ${money(balance)}`
    else if (!Number.isInteger(amt)) e.amount = 'Enter a whole amount'
    if (method === 'upi') {
      if (!/^[A-Za-z0-9]{8,30}$/.test(upiTxn.trim())) e.upiTxn = 'Enter the UPI transaction / reference ID (8–30 letters or digits)'
    } else if (method === 'card') {
      const digits = cardNo.replace(/\s/g, '')
      if (digits.length < 15 || digits.length > 16) e.cardNo = 'Enter a valid 15–16 digit card number'
      else if (!luhnOk(digits)) e.cardNo = 'This card number looks invalid'
      if (!cardName.trim()) e.cardName = 'Enter the name on card'
      const m = /^(\d{2})\/(\d{2})$/.exec(expiry)
      if (!m) e.expiry = 'Use MM/YY'
      else {
        const mm = Number(m[1])
        const yy = 2000 + Number(m[2])
        const now = new Date()
        if (mm < 1 || mm > 12) e.expiry = 'Invalid month'
        else if (yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1)) e.expiry = 'Card has expired'
      }
      if (!/^\d{3,4}$/.test(cvv)) e.cvv = '3 or 4 digits'
    } else if (!bank) e.bank = 'Select your bank'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const pay = () => {
    if (!validate()) return
    setStep('processing')
    const amt = Number(amount)
    const reference =
      method === 'upi'
        ? upiTxn.trim().toUpperCase()
        : method === 'card'
          ? `${genTxnId('CRD')} · xx${cardNo.replace(/\s/g, '').slice(-4)}`
          : `${genTxnId('NB')} · ${bank}`
    setTimeout(() => {
      const p = recordPayment({
        invoiceId: invoice.id,
        hostelerId: me.id,
        amount: amt,
        mode: METHOD_MODE[method],
        reference,
        date: today(),
        note: 'Paid via hosteler portal',
      })
      setResult(p)
      setStep('success')
      toast.success(`Payment of ${money(amt)} successful`)
    }, 1500)
  }

  const methods: { id: Method; label: string; icon: typeof Smartphone }[] = [
    { id: 'upi', label: 'UPI', icon: Smartphone },
    { id: 'card', label: 'Card', icon: CreditCard },
    { id: 'netbanking', label: 'Net banking', icon: Building2 },
  ]

  return (
    <Modal
      open
      onClose={step === 'processing' ? () => undefined : onClose}
      title={step === 'success' ? 'Payment successful' : `Pay ${invoice.number}`}
      description={step === 'form' ? `${formatMonth(invoice.month)} · Balance ${money(balance)}` : undefined}
      footer={
        step === 'form' ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={pay} icon={<ShieldCheck className="h-4 w-4" />}>
              Pay {Number(amount) > 0 ? money(Number(amount)) : ''}
            </Button>
          </>
        ) : step === 'success' ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => result && openInNewTab(`/print/receipt/${result.id}`)}>
              Download receipt
            </Button>
          </>
        ) : undefined
      }
    >
      {step === 'processing' && (
        <div className="flex flex-col items-center py-12 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-brand-600" />
          <p className="mt-4 font-semibold text-slate-900">Processing payment…</p>
          <p className="mt-1 text-sm text-slate-500">Please don't close this window or press back.</p>
        </div>
      )}

      {step === 'success' && result && (
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">{money(result.amount)}</p>
          <p className="text-sm text-slate-500">paid towards {invoice.number}</p>
          <dl className="mt-5 w-full space-y-2 rounded-xl bg-slate-50 p-4 text-left text-sm">
            {[
              ['Receipt no.', result.receiptNo],
              ['Transaction ID', result.reference],
              ['Paid via', MODE_LABEL[result.mode]],
              ['Date', formatDate(result.date)],
              ['Remaining balance', money(invoiceBalance({ payments }, invoice))],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all text-right font-medium text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {step === 'form' && (
        <div className="space-y-5">
          <Field label="Amount to pay" required error={errors.amount} hint={`You can pay part of the balance (max ${money(balance)}).`}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-lg font-semibold"
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Payment method</p>
            <div className="grid grid-cols-3 gap-2">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMethod(m.id)
                    setErrors({})
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-sm font-medium transition',
                    method === m.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  <m.icon className="h-5 w-5" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {method === 'upi' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="rounded-lg bg-white p-2 shadow-sm">
                  <FakeQR seed={`${invoice.id}-${amount}`} />
                </div>
                <p className="mt-3 text-xs text-slate-500">Scan with any UPI app or pay to</p>
                <p className="font-mono text-base font-semibold text-slate-900">hostelhub@upi</p>
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-brand-600"
                  onClick={() => {
                    navigator.clipboard?.writeText('hostelhub@upi').then(
                      () => toast.info('UPI ID copied'),
                      () => undefined,
                    )
                  }}
                >
                  Copy UPI ID
                </button>
              </div>
              <Field label="UPI transaction ID" required error={errors.upiTxn} hint="Find the 12-digit UTR / reference number in your UPI app after paying.">
                <Input value={upiTxn} onChange={(e) => setUpiTxn(e.target.value.replace(/\s/g, ''))} placeholder="e.g. 412345678901" />
              </Field>
            </div>
          )}

          {method === 'card' && (
            <div className="space-y-4">
              <Field label="Card number" required error={errors.cardNo}>
                <Input
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="1234 5678 9012 3456"
                  value={cardNo}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, '').slice(0, 16)
                    setCardNo(d.replace(/(.{4})/g, '$1 ').trim())
                  }}
                />
              </Field>
              <Field label="Name on card" required error={errors.cardName}>
                <Input autoComplete="cc-name" value={cardName} onChange={(e) => setCardName(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expiry" required error={errors.expiry}>
                  <Input
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, '').slice(0, 4)
                      setExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d)
                    }}
                  />
                </Field>
                <Field label="CVV" required error={errors.cvv}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="•••"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </Field>
              </div>
            </div>
          )}

          {method === 'netbanking' && (
            <Field label="Your bank" required error={errors.bank} hint="You'll be securely redirected to your bank (simulated).">
              <Select value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Select bank" options={BANKS.map((b) => ({ value: b, label: b }))} />
            </Field>
          )}

          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" /> Payments are secured with 256-bit encryption. (Demo — no real money is charged.)
          </p>
        </div>
      )}
    </Modal>
  )
}

export default function Fees() {
  const me = useCurrentHosteler()
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const money = useMoney()
  const [paying, setPaying] = useState<Invoice | null>(null)

  const data = useMemo(() => {
    if (!me) return null
    const mine = invoices.filter((i) => i.hostelerId === me.id).sort((a, b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt))
    const myPayments = payments.filter((p) => p.hostelerId === me.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    const year = today().slice(0, 4)
    const paidThisYear = myPayments.filter((p) => p.date.startsWith(year)).reduce((a, p) => a + p.amount, 0)
    const due = mine.reduce((a, i) => a + invoiceBalance({ payments }, i), 0)
    return { mine, myPayments, paidThisYear, due, year }
  }, [me, invoices, payments])

  if (!me || !data) return <NotLoggedIn />

  const invNumber = new Map(invoices.map((i) => [i.id, i.number]))

  return (
    <div className="pb-4">
      <PortalTitle title="Fees & payments" subtitle="View invoices, pay online and download receipts." />

      <div className="grid grid-cols-2 gap-3">
        <Card className={cn('p-4', data.due > 0 ? 'border-red-100 bg-red-50/40' : 'border-emerald-100 bg-emerald-50/40')}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total due</p>
          <p className={cn('mt-1 text-2xl font-bold', data.due > 0 ? 'text-red-600' : 'text-emerald-600')}>{money(data.due)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Paid in {data.year}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{money(data.paidThisYear)}</p>
        </Card>
      </div>

      <SectionTitle>Invoices</SectionTitle>
      {data.mine.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No invoices yet" description="Your monthly rent invoices will show up here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.mine.map((inv) => {
            const status = invoiceStatus({ payments }, inv)
            const bal = invoiceBalance({ payments }, inv)
            const paid = invoicePaid({ payments }, inv.id)
            return (
              <Card key={inv.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{formatMonth(inv.month)}</p>
                    <p className="text-xs text-slate-500">
                      {inv.number} · Due {formatDate(inv.dueDate)}
                    </p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                <ul className="mt-3 space-y-1 text-sm">
                  {inv.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-3 text-slate-600">
                      <span className="truncate">{it.label}</span>
                      <span>{money(it.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="text-sm">
                    <p className="text-slate-500">
                      Total <span className="font-medium text-slate-800">{money(inv.total)}</span>
                      {paid > 0 && !inv.cancelled && (
                        <>
                          {' '}
                          · Paid <span className="font-medium text-emerald-600">{money(paid)}</span>
                        </>
                      )}
                    </p>
                    {bal > 0 && <p className="mt-0.5 font-semibold text-slate-900">Balance {money(bal)}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="md" onClick={() => openInNewTab(`/print/invoice/${inv.id}`)} icon={<FileText className="h-4 w-4" />}>
                      View
                    </Button>
                    {bal > 0 && (
                      <Button size="md" onClick={() => setPaying(inv)} icon={<Wallet className="h-4 w-4" />}>
                        Pay now
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <SectionTitle>Payment history</SectionTitle>
      <Card>
        {data.myPayments.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No payments yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.myPayments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Receipt className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{money(p.amount)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(p.date)} · {MODE_LABEL[p.mode]} · {p.receiptNo}
                    {p.invoiceId && invNumber.get(p.invoiceId) ? ` · ${invNumber.get(p.invoiceId)}` : p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openInNewTab(`/print/receipt/${p.id}`)} icon={<Download className="h-4 w-4" />}>
                  Receipt
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PayModal invoice={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
