import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Receipt,
  Send,
  Smartphone,
  Store,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { errorMessage, openFile } from '@/api/client'
import {
  UTR_RE,
  claimScreenshotUrl,
  paymentQrUrl,
  useMyInvoices,
  useMyPaymentClaims,
  useMyPayments,
  usePaymentInfo,
  useSubmitPaymentClaim,
  type PortalOpenBill,
  type PortalPaymentInfo,
} from '@/api/portal'
import type { PaymentClaim, PaymentMode } from '@/api/types'
import { UpiQr, upiPayLink } from '@/components/UpiQr'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, StatusBadge, Textarea, toast } from '@/components/ui'
import { cn, formatBytes, formatDate, formatMonth, today } from '@/lib/utils'
import { PortalTitle, SectionTitle, openInNewTab, useMoney } from './_shared'

const MODE_LABEL: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  online: 'Online',
}

/** Same limit as the server (portal uploads ≤ 2 MB, images only). */
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

function copyText(text: string, what: string) {
  const fail = () => toast.error(`Couldn't copy. Please note down the ${what}.`)
  if (!navigator.clipboard) return fail()
  navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`), fail)
}

/**
 * How an amount would be applied to the open bills — oldest first, after the
 * payments already waiting for verification (the server applies them the same way).
 */
function allocate(bills: PortalOpenBill[], pending: number, amount: number) {
  let skip = pending
  let left = amount
  const out: { bill: PortalOpenBill; applied: number; clears: boolean }[] = []
  for (const b of bills) {
    let bal = b.balance
    const s = Math.min(skip, bal)
    skip -= s
    bal -= s
    if (bal <= 0 || left <= 0) continue
    const applied = Math.min(left, bal)
    left -= applied
    out.push({ bill: b, applied, clears: applied >= bal })
  }
  return out
}

function billStatus(b: PortalOpenBill): 'overdue' | 'partial' | 'unpaid' {
  if (b.dueDate < today()) return 'overdue'
  return b.paidAmount > 0 ? 'partial' : 'unpaid'
}

/* ------------------------------------------------------------------ */
/* Bills                                                               */
/* ------------------------------------------------------------------ */

function BillCard({ bill, previous }: { bill: PortalOpenBill; previous: boolean }) {
  const money = useMoney()
  // the current bill starts expanded; previous bills are collapsed to keep phones tidy
  const [open, setOpen] = useState(!previous)
  return (
    <Card className={cn('overflow-hidden', previous && 'border-amber-200')}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold text-slate-900">{formatMonth(bill.month)}</p>
            {previous ? <Badge tone="amber">Previous balance</Badge> : <Badge tone="blue">Current bill</Badge>}
            <StatusBadge status={billStatus(bill)} />
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {bill.number} · Due {formatDate(bill.dueDate)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-500">Balance</p>
          <p className="font-bold tabular-nums text-slate-900">{money(bill.balance)}</p>
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 pb-3 pt-3">
          <ul className="space-y-1 text-sm">
            {bill.items.map((it, i) => (
              <li key={`${it.key ?? 'item'}-${i}`} className="flex justify-between gap-3 text-slate-600">
                <span className="truncate">{it.label}</span>
                <span className="tabular-nums">{money(it.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-sm">
            <div className="flex justify-between font-medium text-slate-800">
              <span>Bill total</span>
              <span className="tabular-nums">{money(bill.total)}</span>
            </div>
            {bill.paidAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Already paid</span>
                <span className="tabular-nums">− {money(bill.paidAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-slate-900">
              <span>Balance</span>
              <span className="tabular-nums">{money(bill.balance)}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="-ml-2 mt-2" onClick={() => openInNewTab(`/print/invoice/${bill.id}`)} icon={<FileText className="h-4 w-4" />}>
            View / print bill
          </Button>
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Pay sheet: 1) pay by UPI  2) report it  3) sent                      */
/* ------------------------------------------------------------------ */

function PaySheet({ info, open, onClose }: { info: PortalPaymentInfo; open: boolean; onClose: () => void }) {
  const money = useMoney()
  const submit = useSubmitPaymentClaim()
  const payable = Math.max(info.totalDue - info.pendingVerification, 0)
  const payee = info.payeeName || info.hostelName

  const [step, setStep] = useState<'pay' | 'report' | 'done'>('pay')
  const [amount, setAmount] = useState('')
  const [utr, setUtr] = useState('')
  const [paidOn, setPaidOn] = useState(today())
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [sent, setSent] = useState<PaymentClaim | null>(null)

  useEffect(() => {
    if (!open) return
    setStep('pay')
    setAmount(payable > 0 ? String(payable) : '')
    setUtr('')
    setPaidOn(today())
    setNote('')
    setFile(null)
    setErrors({})
    setServerError(null)
    setSent(null)
    // reset only when the sheet opens (info refetches after a report is sent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const amt = Number(amount)
  const amountError = (): string | null => {
    if (!amount.trim() || Number.isNaN(amt) || amt < 1) return 'Enter an amount of at least ₹1'
    if (!Number.isInteger(amt)) return 'Enter a whole amount (no paise)'
    if (amt > payable)
      return info.pendingVerification > 0
        ? `You can pay up to ${money(payable)} (${money(info.pendingVerification)} is already waiting for verification)`
        : `Amount can't be more than your total due (${money(payable)})`
    return null
  }
  const amountOk = amountError() === null
  const plan = useMemo(() => (amountOk ? allocate(info.bills, info.pendingVerification, amt) : []), [amountOk, info, amt])
  const billNote = plan.length ? `Rent ${plan.map((p) => p.bill.number).join(', ')}` : 'Hostel rent'
  const upiLink = upiPayLink({ upiId: info.upiId, payeeName: payee, amount: amountOk ? amt : undefined, note: billNote })

  const goReport = () => {
    const e = amountError()
    if (e) return setErrors({ amount: e })
    setErrors({})
    setStep('report')
  }

  const pickFile = (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return setErrors((s) => ({ ...s, file: 'Please choose an image (screenshot or photo)' }))
    if (f.size > MAX_SCREENSHOT_BYTES) return setErrors((s) => ({ ...s, file: `That image is ${formatBytes(f.size)}. Please use one under 2 MB.` }))
    setErrors((s) => ({ ...s, file: '' }))
    setFile(f)
  }

  const send = async () => {
    const e: Record<string, string> = {}
    const ae = amountError()
    if (ae) e.amount = ae
    const u = utr.trim().toUpperCase()
    if (!UTR_RE.test(u)) e.utr = 'Enter the UPI transaction ID / UTR (6-30 letters or digits)'
    if (!paidOn) e.paidOn = 'Select the payment date'
    else if (paidOn > today()) e.paidOn = "Payment date can't be in the future"
    if (note.length > 300) e.note = 'Keep the note under 300 characters'
    setErrors(e)
    if (Object.keys(e).length || submit.isPending) return
    setServerError(null)
    try {
      const claim = await submit.mutateAsync({ amount: amt, utr: u, paidOn, note, file })
      setSent(claim)
      setStep('done')
    } catch (err) {
      setServerError(errorMessage(err, "Couldn't send your payment report. Please try again."))
    }
  }

  if (!open) return null

  const footer =
    step === 'pay' ? (
      <>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={goReport} icon={<CheckCircle2 className="h-4 w-4" />}>
          I've paid — report it
        </Button>
      </>
    ) : step === 'report' ? (
      <>
        <Button variant="outline" onClick={() => setStep('pay')} disabled={submit.isPending}>
          Back
        </Button>
        <Button onClick={() => void send()} loading={submit.isPending} icon={<Send className="h-4 w-4" />}>
          Send for verification
        </Button>
      </>
    ) : (
      <Button onClick={onClose}>Done</Button>
    )

  return (
    <Modal
      open
      onClose={submit.isPending ? () => undefined : onClose}
      title={step === 'pay' ? 'Pay rent by UPI' : step === 'report' ? 'Report your payment' : 'Payment reported'}
      description={step === 'pay' ? 'Step 1 of 2 · Pay from any UPI app' : step === 'report' ? 'Step 2 of 2 · Tell your hostel you paid' : undefined}
      footer={footer}
    >
      {step === 'pay' && (
        <div className="space-y-5">
          <Field
            label="Amount to pay"
            required
            error={errors.amount}
            hint={
              info.pendingVerification > 0
                ? `Up to ${money(payable)} · ${money(info.pendingVerification)} already waiting for verification`
                : `You can also pay part of it (up to ${money(payable)})`
            }
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg font-semibold text-slate-400">₹</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={payable}
                step={1}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  if (errors.amount) setErrors((s) => ({ ...s, amount: '' }))
                }}
                className="h-12 pl-8 text-lg font-semibold"
              />
            </div>
          </Field>

          {plan.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Goes towards (oldest bill first)</p>
              <ul className="space-y-1">
                {plan.map((p) => (
                  <li key={p.bill.id} className="flex justify-between gap-3 text-slate-700">
                    <span className="truncate">
                      {formatMonth(p.bill.month)} · {p.bill.number}
                      {p.clears ? '' : ' (part)'}
                    </span>
                    <span className="font-medium tabular-nums">{money(p.applied)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <UpiQr upiId={info.upiId} payeeName={payee} amount={amountOk ? amt : undefined} note={billNote} qrUrl={info.hasQr ? paymentQrUrl : null} />
            <p className="mt-2 text-xs text-slate-500">
              {info.hasQr && amountOk ? `Scan with any UPI app and enter ${money(amt)}` : 'Scan with GPay, PhonePe, Paytm or any UPI app'}
            </p>
            <div className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-left">
              <p className="text-xs text-slate-500">UPI ID</p>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 break-all font-mono text-base font-semibold text-slate-900">{info.upiId}</p>
                <Button variant="outline" size="sm" onClick={() => copyText(info.upiId, 'UPI ID')} icon={<Copy className="h-3.5 w-3.5" />}>
                  Copy
                </Button>
              </div>
              {payee && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Pays to <span className="font-medium text-slate-700">{payee}</span> — check this name in your UPI app before paying.
                </p>
              )}
            </div>
            {isPhone() ? (
              <a href={upiLink} className="mt-3 block w-full">
                <span className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-medium text-white shadow-sm hover:bg-brand-700">
                  <Smartphone className="h-5 w-5" />
                  Open UPI app{amountOk ? ` · ${money(amt)}` : ''}
                </span>
              </a>
            ) : (
              <p className="mt-3 text-xs text-slate-500">On your phone you'll also see an “Open UPI app” button.</p>
            )}
          </div>

          <p className="rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
            After paying, tap <span className="font-semibold">“I've paid — report it”</span> and enter the UPI transaction ID (UTR) from your UPI app.
          </p>
        </div>
      )}

      {step === 'report' && (
        <div className="space-y-4">
          {serverError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}
          <Field label="Amount you paid" required error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-semibold text-slate-400">₹</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={payable}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 font-semibold"
              />
            </div>
          </Field>
          <Field
            label="UPI transaction ID / UTR"
            required
            error={errors.utr}
            hint="Open the payment in your UPI app — it's the 12-digit UPI Ref No. / UTR / Transaction ID."
          >
            <Input
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
              placeholder="e.g. 412345678901"
              maxLength={30}
              autoCapitalize="characters"
              autoComplete="off"
              className="font-mono tracking-wide"
            />
          </Field>
          <Field label="Payment date" required error={errors.paidOn}>
            <Input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">
              Screenshot <span className="font-normal text-slate-400">(optional, helps quick verification)</span>
            </p>
            {file && preview ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">
                <img src={preview} alt="Payment screenshot preview" className="h-20 w-16 rounded-lg object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setFile(null)} icon={<X className="h-4 w-4" />}>
                  Remove
                </Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600 hover:border-brand-400 hover:bg-slate-50">
                <ImageIcon className="h-5 w-5 text-slate-400" />
                <span>
                  Add screenshot
                  <span className="block text-xs text-slate-400">JPG, PNG, WEBP or HEIC · max 2 MB</span>
                </span>
                <input
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
            )}
            {errors.file && <p className="mt-1 text-xs text-red-600">{errors.file}</p>}
          </div>
          <Field label="Note for the office (optional)" error={errors.note}>
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid from my father's account" />
          </Field>
        </div>
      )}

      {step === 'done' && sent && (
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <Clock className="h-9 w-9 text-amber-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">{money(sent.amount)}</p>
          <p className="mt-1 font-medium text-slate-800">Sent to your hostel for verification</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            The office will check the payment and update your bill. You'll get a notification here once it's verified.
          </p>
          <dl className="mt-5 w-full space-y-2 rounded-xl bg-slate-50 p-4 text-left text-sm">
            {[
              ['UTR', sent.utr],
              ['Paid on', formatDate(sent.paidOn)],
              ['Screenshot', sent.hasScreenshot ? 'Attached' : 'Not attached'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all text-right font-medium text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Payment reports                                                     */
/* ------------------------------------------------------------------ */

function ClaimRow({ claim }: { claim: PaymentClaim }) {
  const money = useMoney()
  const partial = claim.status === 'verified' && claim.receivedAmount !== null && claim.receivedAmount < claim.amount
  const viewShot = () => void openFile(claimScreenshotUrl(claim.id)).catch((e: unknown) => toast.error(errorMessage(e, "Couldn't open the screenshot")))
  const Icon = claim.status === 'verified' ? CheckCircle2 : claim.status === 'rejected' ? XCircle : Clock
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          claim.status === 'verified' ? 'bg-emerald-50 text-emerald-600' : claim.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-medium text-slate-900">{money(claim.amount)}</p>
          {claim.status === 'pending' && <Badge tone="amber">Waiting for verification</Badge>}
          {claim.status === 'verified' && <Badge tone={partial ? 'amber' : 'green'}>{partial ? 'Partly verified' : 'Verified'}</Badge>}
          {claim.status === 'rejected' && <Badge tone="red">Rejected</Badge>}
        </div>
        <p className="truncate text-xs text-slate-500">
          Paid {formatDate(claim.paidOn)} · UTR <span className="font-mono">{claim.utr}</span>
        </p>
        {claim.status === 'verified' && claim.receivedAmount !== null && (
          <p className={cn('mt-0.5 text-xs', partial ? 'font-medium text-amber-700' : 'text-emerald-700')}>
            {partial
              ? `${money(claim.receivedAmount)} of ${money(claim.amount)} confirmed by the office`
              : `${money(claim.receivedAmount)} confirmed${claim.reviewedAt ? ` on ${formatDate(claim.reviewedAt)}` : ''}`}
          </p>
        )}
        {claim.status === 'rejected' && (
          <p className="mt-0.5 text-xs text-red-700">
            {claim.rejectReason ? `Reason: ${claim.rejectReason}.` : 'The office could not match this payment.'} Contact the office if you think this is a mistake.
          </p>
        )}
        {claim.note && <p className="mt-0.5 truncate text-xs text-slate-400">Your note: {claim.note}</p>}
      </div>
      {claim.hasScreenshot && (
        <Button variant="ghost" size="sm" onClick={viewShot} icon={<ImageIcon className="h-4 w-4" />} aria-label="View screenshot">
          <span className="hidden sm:inline">Screenshot</span>
        </Button>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Fees() {
  const infoQ = usePaymentInfo()
  const claimsQ = useMyPaymentClaims()
  const invoicesQ = useMyInvoices()
  const paymentsQ = useMyPayments()
  const money = useMoney()
  const [paying, setPaying] = useState(false)

  const info = infoQ.data
  const bills = info?.bills ?? []
  const payable = info ? Math.max(info.totalDue - info.pendingVerification, 0) : 0
  const upiReady = !!info?.upiId
  const paidBills = (invoicesQ.data ?? []).filter((i) => i.balance <= 0)
  const claims = claimsQ.data ?? []
  const payments = paymentsQ.data ?? []

  return (
    <div className="pb-4">
      <PortalTitle title="Fees & payments" subtitle="Pay rent by UPI and track your bills and receipts." />

      {/* Summary */}
      {infoQ.isLoading ? (
        <LoadingState />
      ) : !info ? (
        <Card>
          <ErrorState error={infoQ.error} onRetry={() => void infoQ.refetch()} />
        </Card>
      ) : (
        <Card className={cn('p-5', info.totalDue > 0 ? '' : 'border-emerald-100 bg-emerald-50/40')}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Total due</p>
              <p className={cn('mt-1 text-3xl font-bold', info.totalDue > 0 ? 'text-slate-900' : 'text-emerald-600')}>{money(info.totalDue)}</p>
              {info.totalDue > 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  {bills.length > 1 ? `${bills.length} bills · previous balance + current bill` : '1 bill'}
                  {bills[0] && bills[0].dueDate < today() && (
                    <span className="font-medium text-red-600"> · overdue since {formatDate(bills[0].dueDate)}</span>
                  )}
                </p>
              ) : (
                <p className="mt-1 flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> You're all paid up
                </p>
              )}
              {info.pendingVerification > 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
                  <Clock className="h-4 w-4" /> {money(info.pendingVerification)} waiting for verification
                </p>
              )}
            </div>
            {upiReady && payable > 0 && (
              <Button size="lg" className="w-full rounded-xl sm:w-auto" onClick={() => setPaying(true)} icon={<Wallet className="h-5 w-5" />}>
                Pay rent
              </Button>
            )}
          </div>
          {info.totalDue > 0 && !upiReady && (
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <Store className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
              <p>
                <span className="font-medium text-slate-800">Your hostel hasn't set up UPI payments yet — pay at the office.</span> Your bill will be
                updated once the office records the payment.
              </p>
            </div>
          )}
          {upiReady && info.totalDue > 0 && payable <= 0 && (
            <p className="mt-3 text-sm text-slate-500">You've reported everything that's due. We'll let you know once the office verifies it.</p>
          )}
        </Card>
      )}

      {/* Open bills */}
      {bills.length > 0 && (
        <>
          <SectionTitle>Bills to pay</SectionTitle>
          <div className="space-y-3">
            {bills.map((b, i) => (
              <BillCard key={b.id} bill={b} previous={i < bills.length - 1} />
            ))}
            {bills.length > 1 && (
              <div className="flex justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
                <span className="text-sm">Total due</span>
                <span className="font-bold tabular-nums">{money(info?.totalDue ?? 0)}</span>
              </div>
            )}
            <p className="text-xs text-slate-500">Payments are applied to the oldest bill first.</p>
          </div>
        </>
      )}

      {/* Payment reports */}
      <SectionTitle>My payment reports</SectionTitle>
      <Card>
        {claimsQ.isLoading ? (
          <LoadingState />
        ) : claimsQ.error ? (
          <ErrorState error={claimsQ.error} onRetry={() => void claimsQ.refetch()} />
        ) : claims.length === 0 ? (
          <EmptyState icon={<Send className="h-5 w-5" />} title="No payments reported yet" description="After paying by UPI, report it here so the office can verify it." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} />
            ))}
          </ul>
        )}
      </Card>

      {/* Receipts */}
      <SectionTitle>Receipts</SectionTitle>
      <Card>
        {paymentsQ.isLoading ? (
          <LoadingState />
        ) : paymentsQ.error ? (
          <ErrorState error={paymentsQ.error} onRetry={() => void paymentsQ.refetch()} />
        ) : payments.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No receipts yet" description="Receipts appear once the office confirms a payment." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Receipt className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{money(p.amount)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(p.date)} · {MODE_LABEL[p.mode]} · {p.receiptNo}
                    {p.kind === 'deposit' ? ' · Security deposit' : ''}
                    {p.invoiceMonth ? ` · ${formatMonth(p.invoiceMonth)}` : p.note && p.kind !== 'deposit' ? ` · ${p.note}` : ''}
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

      {/* Paid bills */}
      <SectionTitle>Paid bills</SectionTitle>
      <Card>
        {invoicesQ.isLoading ? (
          <LoadingState />
        ) : invoicesQ.error ? (
          <ErrorState error={invoicesQ.error} onRetry={() => void invoicesQ.refetch()} />
        ) : paidBills.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No paid bills yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {paidBills.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{formatMonth(inv.month)}</p>
                  <p className="truncate text-xs text-slate-500">
                    {inv.number} · {money(inv.total)}
                  </p>
                </div>
                <StatusBadge status={inv.status} />
                <Button variant="ghost" size="sm" onClick={() => openInNewTab(`/print/invoice/${inv.id}`)} icon={<FileText className="h-4 w-4" />}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {info && upiReady && <PaySheet info={info} open={paying} onClose={() => setPaying(false)} />}
    </div>
  )
}
