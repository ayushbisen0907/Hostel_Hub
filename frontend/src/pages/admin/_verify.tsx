/**
 * Fees → "Verify payments": hostelers pay the hostel's UPI outside the app and
 * report it (amount + UTR + optional screenshot). Staff check their bank and
 * verify the amount actually received (applied to the oldest bills first) or
 * reject with a reason. The hosteler is notified either way.
 */
import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, CheckCircle2, Copy, ImageIcon, ShieldCheck, XCircle } from 'lucide-react'
import { fetchFileUrl, openFile } from '@/api/client'
import { useScope } from '@/api/common'
import { toastError } from '@/api/query'
import {
  screenshotUrl,
  useClaim,
  useClaims,
  useRejectClaim,
  useVerifyClaim,
  type ClaimFilter,
  type VerifyResult,
} from '@/api/claims'
import type { ID, PaymentClaim } from '@/api/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  SearchInput,
  Spinner,
  StatusBadge,
  Textarea,
  toast,
} from '@/components/ui'
import { cn, formatDate, formatDateTime, formatMoney, formatMonth } from '@/lib/utils'
import { Pager, useDebounced } from './_fees'

const PAGE_SIZE = 30

const FILTERS: { value: ClaimFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

export function VerifyTab({ pendingCount }: { pendingCount?: number }) {
  const scope = useScope()
  const [status, setStatus] = useState<ClaimFilter>('pending')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [verifying, setVerifying] = useState<PaymentClaim | null>(null)
  const [rejecting, setRejecting] = useState<PaymentClaim | null>(null)
  const dq = useDebounced(q.trim())

  useEffect(() => setPage(1), [scope, status, dq])

  const query = useClaims({ status, hostelId: scope, q: dq || undefined, page, limit: PAGE_SIZE })
  const data = query.data

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-600">
            Hostelers pay your hostel's UPI ID and report the transaction ID (UTR) here. Check that the money reached your bank, then
            <strong className="font-semibold text-slate-800"> verify</strong> the amount you actually received — it's applied to their oldest unpaid bills
            first, and anything short stays due. <strong className="font-semibold text-slate-800">Reject</strong> it if you can't find the payment.
          </p>
        </div>
      </Card>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition',
                status === f.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {f.label}
              {f.value === 'pending' && !!pendingCount && (
                <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search name, ID, phone or UTR…" className="sm:w-72" />
      </div>

      {query.isLoading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : query.error && !data ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={<BadgeCheck className="h-6 w-6" />}
            title={dq ? 'No payments match your search' : status === 'pending' ? 'Nothing to verify' : 'No payments here yet'}
            description={
              status === 'pending' && !dq
                ? "When a hosteler reports a UPI payment, it shows up here and you'll get a notification."
                : undefined
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {data.items.map((c) => (
              <ClaimRow key={c.id} claim={c} onVerify={() => setVerifying(c)} onReject={() => setRejecting(c)} />
            ))}
          </ul>
          <Pager page={data.page} pages={data.pages} onChange={setPage} busy={query.isFetching} />
        </Card>
      )}

      <VerifyModal claim={verifying} onClose={() => setVerifying(null)} onReject={(c) => {
        setVerifying(null)
        setRejecting(c)
      }} />
      <RejectModal claim={rejecting} onClose={() => setRejecting(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success('UTR copied'),
    () => toast.error("Couldn't copy"),
  )
}

function Utr({ utr }: { utr: string }) {
  return (
    <button
      type="button"
      onClick={() => copy(utr)}
      title="Copy UTR"
      className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:bg-slate-200"
    >
      <span className="truncate">{utr}</span>
      <Copy className="h-3 w-3 shrink-0 text-slate-400" />
    </button>
  )
}

function ClaimRow({ claim: c, onVerify, onReject }: { claim: PaymentClaim; onVerify: () => void; onReject: () => void }) {
  const partial = c.status === 'verified' && c.receivedAmount !== null && c.receivedAmount < c.amount
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <Screenshot claim={c} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-semibold text-slate-900">{c.hosteler?.name ?? 'Hosteler'}</p>
            {c.hosteler?.loginId && <span className="text-xs text-slate-500">{c.hosteler.loginId}</span>}
            <StatusBadge status={c.status} />
            {partial && <Badge tone="amber">Partial</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            <span className="text-base font-bold text-slate-900">{formatMoney(c.amount)}</span>
            <Utr utr={c.utr} />
            <span>Paid {formatDate(c.paidOn)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Reported {formatDateTime(c.createdAt)}</p>
          {c.note && <p className="mt-1 text-sm text-slate-600">“{c.note}”</p>}
          {c.status === 'verified' && (
            <p className="mt-1 text-xs text-emerald-700">
              {formatMoney(c.receivedAmount ?? c.amount)} received{partial ? ` of ${formatMoney(c.amount)} reported` : ''}
              {c.reviewedByName ? ` · verified by ${c.reviewedByName}` : ''}
              {c.reviewedAt ? ` · ${formatDateTime(c.reviewedAt)}` : ''}
            </p>
          )}
          {c.status === 'rejected' && (
            <p className="mt-1 text-xs text-red-700">
              Rejected: {c.rejectReason}
              {c.reviewedByName ? ` · ${c.reviewedByName}` : ''}
              {c.reviewedAt ? ` · ${formatDateTime(c.reviewedAt)}` : ''}
            </p>
          )}
        </div>
      </div>
      {c.status === 'pending' && (
        <div className="flex gap-2 sm:shrink-0">
          <Button size="sm" variant="outline" className="flex-1 text-red-600 hover:bg-red-50 sm:flex-none" icon={<XCircle className="h-4 w-4" />} onClick={onReject}>
            Reject
          </Button>
          <Button size="sm" className="flex-1 sm:flex-none" icon={<CheckCircle2 className="h-4 w-4" />} onClick={onVerify}>
            Verify
          </Button>
        </div>
      )}
    </li>
  )
}

/** Thumbnail of the payment screenshot (fetched with auth); click to open full size. */
function Screenshot({ claim, className }: { claim: PaymentClaim; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!claim.hasScreenshot) return
    let cancelled = false
    let url: string | null = null
    setFailed(false)
    fetchFileUrl(screenshotUrl(claim.id))
      .then((u) => {
        url = u
        if (cancelled) URL.revokeObjectURL(u)
        else setSrc(u)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [claim.id, claim.hasScreenshot])

  const box = cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50', className)
  if (!claim.hasScreenshot)
    return (
      <div className={box} title="No screenshot">
        <ImageIcon className="h-5 w-5 text-slate-300" />
      </div>
    )
  return (
    <button
      type="button"
      className={cn(box, 'hover:ring-2 hover:ring-brand-300')}
      title="View screenshot"
      onClick={() => openFile(screenshotUrl(claim.id)).catch((e) => toastError(e))}
    >
      {src ? <img src={src} alt="Payment screenshot" className="h-full w-full object-cover" /> : failed ? <ImageIcon className="h-5 w-5 text-slate-400" /> : <Spinner className="h-4 w-4" />}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

function VerifyModal({ claim, onClose, onReject }: { claim: PaymentClaim | null; onClose: () => void; onReject: (c: PaymentClaim) => void }) {
  const detailQ = useClaim(claim?.id)
  const d = detailQ.data
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [openedFor, setOpenedFor] = useState<ID | null>(null)
  const [defaultedFor, setDefaultedFor] = useState<ID | null>(null)
  const verify = useVerifyClaim((r) => setResult(r))

  const totalDue = d ? d.openBills.reduce((a, b) => a + b.balance, 0) : 0

  // reset when a different claim opens; default the amount once its bills are loaded
  if (claim && openedFor !== claim.id) {
    setOpenedFor(claim.id)
    setDefaultedFor(null)
    setAmount('')
    setNote('')
    setError('')
    setResult(null)
  }
  if (!claim && openedFor) setOpenedFor(null)
  if (claim && d && d.id === claim.id && defaultedFor !== claim.id && !result) {
    setDefaultedFor(claim.id)
    setAmount(String(Math.min(claim.amount, totalDue) || ''))
  }

  const received = Number(amount)
  // can't confirm more than the hosteler reported, nor more than they owe
  const maxReceivable = claim ? Math.min(claim.amount, totalDue) : totalDue
  const validAmount = amount.trim() !== '' && Number.isInteger(received) && received >= 1 && received <= maxReceivable
  const remaining = Math.max(totalDue - (validAmount ? received : 0), 0)

  /** Preview of how the amount is spread over the bills (oldest first). */
  const allocation = useMemo(() => {
    const out = new Map<ID, number>()
    if (!d || !validAmount) return out
    let left = received
    for (const b of d.openBills) {
      if (left <= 0) break
      const part = Math.min(left, b.balance)
      out.set(b.id, part)
      left -= part
    }
    return out
  }, [d, received, validAmount])

  const submit = () => {
    if (!claim) return
    if (!validAmount) {
      return setError(
        !Number.isInteger(received) || received < 1
          ? 'Enter the amount you received in whole rupees.'
          : claim && received > claim.amount
            ? `That's more than the ${formatMoney(claim.amount)} the hosteler reported.`
            : `That's more than the total due (${formatMoney(totalDue)}).`,
      )
    }
    setError('')
    verify.mutate({ id: claim.id, receivedAmount: received, note: note.trim() || undefined })
  }

  const close = () => !verify.isPending && onClose()

  if (claim && result) {
    return (
      <Modal open onClose={onClose} size="md" title="Payment verified" description={`${claim.hosteler?.name ?? 'Hosteler'} has been notified.`} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" />
            <div>
              <p className="text-lg font-bold text-emerald-800">{formatMoney(result.claim.receivedAmount ?? 0)} received</p>
              <p className="text-sm text-emerald-700">UTR {result.claim.utr}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Applied to</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {result.applied.map((a) => (
                <li key={a.invoiceId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-mono text-slate-700">{a.number}</span>
                  <span className="font-semibold text-slate-900">{formatMoney(a.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className={cn('rounded-lg px-3 py-2 text-sm', result.remainingDues > 0 ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600')}>
            {result.remainingDues > 0
              ? `${formatMoney(result.remainingDues)} is still due — it shows as previous balance on the next bill.`
              : 'All bills are paid.'}
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={claim !== null}
      onClose={close}
      size="lg"
      title="Verify payment"
      description={claim ? `${claim.hosteler?.name ?? 'Hosteler'}${claim.hosteler?.loginId ? ` · ${claim.hosteler.loginId}` : ''}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={verify.isPending}>
            Cancel
          </Button>
          {claim && (
            <Button variant="outline" className="text-red-600 hover:bg-red-50" disabled={verify.isPending} onClick={() => onReject(claim)}>
              Reject
            </Button>
          )}
          <Button onClick={submit} loading={verify.isPending} disabled={!d || totalDue <= 0} icon={<CheckCircle2 className="h-4 w-4" />}>
            Verify
          </Button>
        </>
      }
    >
      {!claim ? null : detailQ.isLoading ? (
        <LoadingState />
      ) : detailQ.error || !d ? (
        <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      ) : (
        <div className="space-y-5">
          {/* What the hosteler reported */}
          <div className="flex gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Screenshot claim={d} className="h-20 w-20 bg-white" />
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reported payment</p>
              <p className="text-2xl font-bold text-slate-900">{formatMoney(d.amount)}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
                <Utr utr={d.utr} />
                <span>Paid {formatDate(d.paidOn)}</span>
              </div>
              <p className="text-xs text-slate-500">Reported {formatDateTime(d.createdAt)}</p>
              {d.note && <p className="text-slate-600">“{d.note}”</p>}
            </div>
          </div>

          {/* Open bills, oldest first */}
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">Unpaid bills (oldest first)</p>
              <p className="text-sm text-slate-600">
                Total due <span className="ml-1 font-bold text-slate-900">{formatMoney(totalDue)}</span>
              </p>
            </div>
            {d.openBills.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This hosteler has no unpaid bills, so there is nothing to apply this payment to. Create an invoice first, or reject the payment.
              </p>
            ) : (
              <ul className="space-y-2">
                {d.openBills.map((b) => {
                  const part = allocation.get(b.id) ?? 0
                  return (
                    <li key={b.id} className={cn('rounded-lg border p-3', part > 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200')}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm">
                          <span className="font-mono font-medium text-slate-800">{b.number}</span>
                          <span className="ml-2 text-slate-500">
                            {formatMonth(b.month)} · due {formatDate(b.dueDate)}
                          </span>
                        </p>
                        <p className="text-sm">
                          <span className="text-slate-500">Balance </span>
                          <span className="font-semibold text-slate-900">{formatMoney(b.balance)}</span>
                        </p>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                        {b.items.map((it, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">{it.label}</span>
                            <span>{formatMoney(it.amount)}</span>
                          </li>
                        ))}
                        {b.paidAmount > 0 && (
                          <li className="flex justify-between gap-2 text-emerald-700">
                            <span>Already paid</span>
                            <span>−{formatMoney(b.paidAmount)}</span>
                          </li>
                        )}
                      </ul>
                      {part > 0 && (
                        <p className="mt-1.5 text-xs font-medium text-emerald-700">
                          {part >= b.balance ? `Fully paid by this payment (${formatMoney(part)})` : `${formatMoney(part)} applied · ${formatMoney(b.balance - part)} left`}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {totalDue > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount received" required hint={`What actually reached your account (max ${formatMoney(maxReceivable)})`}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxReceivable}
                    step={1}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value)
                      setError('')
                    }}
                    className="pl-7 text-lg font-semibold"
                    autoFocus
                  />
                </div>
              </Field>
              <div className="flex flex-col justify-center rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Remaining due after this</p>
                <p className={cn('text-2xl font-bold', remaining > 0 ? 'text-amber-600' : 'text-emerald-600')}>{formatMoney(remaining)}</p>
                {validAmount && received < d.amount && (
                  <p className="mt-1 text-xs text-amber-700">Less than the {formatMoney(d.amount)} reported — the hosteler will be told what you received.</p>
                )}
                {d.amount > totalDue && <p className="mt-1 text-xs text-slate-500">They reported more than they owe ({formatMoney(totalDue)}).</p>}
              </div>
              <Field label="Note (optional)" className="sm:col-span-2">
                <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked in HDFC statement" />
              </Field>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Reject                                                              */
/* ------------------------------------------------------------------ */

const QUICK_REASONS = [
  'No payment with this UTR reached our account',
  "The amount doesn't match our bank statement",
  'The screenshot is unclear — please share the correct UTR',
]

function RejectModal({ claim, onClose }: { claim: PaymentClaim | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<ID | null>(null)
  const reject = useRejectClaim(onClose)

  if (claim && loadedFor !== claim.id) {
    setLoadedFor(claim.id)
    setReason('')
    setError('')
  }
  if (!claim && loadedFor) setLoadedFor(null)

  const submit = () => {
    if (!claim) return
    if (reason.trim().length < 3) return setError('Tell the hosteler why the payment was rejected.')
    reject.mutate({ id: claim.id, reason: reason.trim() })
  }

  return (
    <Modal
      open={claim !== null}
      onClose={() => !reject.isPending && onClose()}
      size="md"
      title="Reject payment"
      description={claim ? `${formatMoney(claim.amount)} · UTR ${claim.utr} · ${claim.hosteler?.name ?? 'Hosteler'}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={reject.isPending}>
            Reject payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The hosteler gets a notification with your reason and can report the payment again.</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setReason(r)
                setError('')
              }}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-left text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Reason" required error={error}>
          <Textarea
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setError('')
            }}
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  )
}
