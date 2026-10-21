import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, IndianRupee, KeyRound, LogOut, Plus, Printer, ShieldAlert, Trash2, UserMinus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, errorMessage } from '@/api/client'
import { useOrg, useScope } from '@/api/common'
import { useApiMutation } from '@/api/query'
import { useCan } from '@/api/session'
import {
  HOSTELER_INVALIDATE,
  hostelersApi,
  useCheckOutPreview,
  useHosteler,
  useHostelers,
  type DuesPendingDetails,
  type HostelerDetail,
  type Settlement,
} from '@/api/hostelers'
import type { ID } from '@/api/types'
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
  PageHeader,
  SearchInput,
  Spinner,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { billPeriod, cn, daysBetween, formatDate, formatMoney, today, uid } from '@/lib/utils'
import { HostelerAvatar, Pager, bedText, useDebounced } from './_residents'
import { RecordPaymentModal } from './_fees'
import { MoveOutBadge, MoveOutRequests } from './_moveOut'
import { useHasModule } from '@/api/plan'

interface Deduction {
  key: string
  label: string
  amount: string
}

interface Result {
  s: Settlement
  phone: string
  hostel: string
}

const CHECKLIST = [
  { key: 'keys', label: 'Room keys returned' },
  { key: 'idcard', label: 'Hostel ID card returned' },
  { key: 'inspected', label: 'Room inspected' },
] as const
type CheckKey = (typeof CHECKLIST)[number]['key']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/* ------------------------------------------------------------------ */
/* Printable summary                                                   */
/* ------------------------------------------------------------------ */

function SettlementSummary({ r, orgName, onDone }: { r: Result; orgName: string; onDone: () => void }) {
  const s = r.s
  return (
    <>
      <div className="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">{s.name} has been checked out</h1>
            <p className="text-sm text-slate-500">The bed is now vacant. Print the settlement for your records.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDone}>
            Check out another
          </Button>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>
      <div className="no-print mx-auto mb-6 flex max-w-2xl items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>
          Hosteler ID <span className="font-mono font-semibold">{s.loginId}</span> is now closed. {s.name} has been signed out of the app and can no longer log
          in to the hosteler portal. Their records (bills, payments, documents) stay in HostelHub.
        </span>
      </div>
      <Card className="mx-auto max-w-2xl p-6 print:border-0 print:shadow-none sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold text-slate-900">{orgName}</p>
            <p className="text-sm text-slate-500">{r.hostel}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Checkout settlement</p>
            <p className="text-xs text-slate-500">{formatDate(s.checkOut)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 border-b border-slate-200 py-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">Resident</p>
            <p className="font-semibold text-slate-900">{s.name}</p>
            <p className="text-slate-600">
              {r.phone} · <span className="font-mono">{s.loginId}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Room</p>
            <p className="font-semibold text-slate-900">{s.bed ?? '—'}</p>
            <p className="text-slate-600">
              {formatDate(s.checkIn)} – {formatDate(s.checkOut)} ({s.days} days
              {s.monthsStayed !== undefined ? `, ${plural(s.monthsStayed, 'month')}` : ''})
            </p>
          </div>
        </div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1.5 text-slate-600">Security deposit held</td>
              <td className="py-1.5 text-right font-medium">{formatMoney(s.held)}</td>
            </tr>
            {s.depositForfeited ? (
              <tr>
                <td className="py-1.5 text-slate-600">
                  Deposit forfeited
                  {s.minStayMonths ? ` (stayed ${s.monthsStayed ?? 0} of the ${plural(s.minStayMonths, 'month')} required)` : ''}
                </td>
                <td className="py-1.5 text-right font-medium text-red-600">− {formatMoney(s.held)}</td>
              </tr>
            ) : (
              s.adjusted > 0 && (
                <tr>
                  <td className="py-1.5 text-slate-600">Dues paid from the deposit</td>
                  <td className="py-1.5 text-right font-medium text-red-600">− {formatMoney(s.adjusted)}</td>
                </tr>
              )
            )}
            {s.deductions.map((d, i) => (
              <tr key={i}>
                <td className="py-1.5 text-slate-600">
                  {d.label}
                  {s.depositForfeited && <span className="text-xs text-slate-400"> (covered by the forfeited deposit)</span>}
                </td>
                <td className="py-1.5 text-right font-medium text-red-600">{s.depositForfeited ? '—' : `− ${formatMoney(d.amount)}`}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-900">
              <td className="pt-3 font-semibold text-slate-900">Refund to resident</td>
              <td className="pt-3 text-right text-lg font-bold text-emerald-700">{formatMoney(s.refund)}</td>
            </tr>
          </tbody>
        </table>
        {s.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{s.notes}</p>}
        <div className="mt-4 text-xs text-slate-500">All dues cleared. Keys, ID card returned and room inspected. Portal login closed.</div>
        <div className="mt-14 grid grid-cols-2 gap-10 text-center text-xs text-slate-500">
          <div className="border-t border-slate-300 pt-2">Resident signature</div>
          <div className="border-t border-slate-300 pt-2">Warden / manager</div>
        </div>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Recently checked out                                                */
/* ------------------------------------------------------------------ */

function RecentCheckouts() {
  const navigate = useNavigate()
  const scope = useScope()
  const q = useHostelers({ status: 'checked_out', hostelId: scope, limit: 50 })
  const recent = useMemo(
    () => [...(q.data?.items ?? [])].sort((a, b) => (b.checkOutDate ?? '').localeCompare(a.checkOutDate ?? '')).slice(0, 15),
    [q.data],
  )
  return (
    <Card className="no-print mt-6">
      <CardHeader title="Recently checked out" />
      {q.isLoading ? (
        <LoadingState className="py-10" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-10" />
      ) : recent.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Hosteler</TH>
              <TH>Stay</TH>
              <TH>Checked out</TH>
              <TH className="text-right">Deposit refunded</TH>
              <TH className="text-right">Dues</TH>
            </tr>
          </THead>
          <tbody>
            {recent.map((x) => (
              <TR key={x.id} onClick={() => navigate(`/app/hostelers/${x.id}`)}>
                <TD>
                  <div className="flex items-center gap-3">
                    <HostelerAvatar h={x} />
                    <div>
                      <p className="font-medium text-slate-900">{x.name}</p>
                      <p className="text-xs text-slate-500">{x.hostelName ?? '—'}</p>
                    </div>
                  </div>
                </TD>
                <TD className="whitespace-nowrap">{x.checkOutDate ? `${Math.max(daysBetween(x.checkInDate, x.checkOutDate), 0)} days` : '—'}</TD>
                <TD className="whitespace-nowrap">{formatDate(x.checkOutDate)}</TD>
                <TD className="text-right">{x.depositRefunded !== null ? formatMoney(x.depositRefunded) : '—'}</TD>
                <TD className={cn('text-right', x.dues > 0 ? 'font-medium text-red-600' : 'text-slate-400')}>{x.dues > 0 ? formatMoney(x.dues) : '—'}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No one has checked out yet.</p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

function ChooseResident({ onSelect, notice, showRequests }: { onSelect: (id: ID) => void; notice?: string; showRequests?: boolean }) {
  const scope = useScope()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebounced(q.trim(), 300)
  useEffect(() => setPage(1), [term, scope])
  const list = useHostelers({ status: 'active', hostelId: scope, q: term || undefined, page, limit: 30 })
  const items = list.data?.items ?? []
  useEffect(() => {
    if (showRequests) document.getElementById('move-out-requests')?.scrollIntoView({ block: 'start' })
  }, [showRequests])
  // move-out requests from the hosteler app are part of Starter and up
  const hasMoveOuts = useHasModule('rules')
  return (
    <>
      <PageHeader title="Check-out" subtitle="Clear all dues, settle the deposit, then free up the bed." />
      {notice && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</p>}
      {hasMoveOuts && <MoveOutRequests onStart={onSelect} defaultOpen={showRequests} />}
      <Card>
        <div className="border-b border-slate-100 p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search active residents by name, phone or Hosteler ID…" className="sm:max-w-md" />
        </div>
        {list.isLoading ? (
          <LoadingState className="py-10" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length ? (
          <ul className={cn('divide-y divide-slate-100', list.isPlaceholderData && 'opacity-60')}>
            {items.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onSelect(x.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                  <HostelerAvatar h={x} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{x.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {bedText(x)} · since {formatDate(x.checkInDate)}
                      {x.expectedCheckOut ? ` · leaving ${formatDate(x.expectedCheckOut)}` : ''}
                    </p>
                  </div>
                  {x.dues > 0 ? <Badge tone="red">Dues {formatMoney(x.dues)}</Badge> : <Badge tone="green">No dues</Badge>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<UserMinus className="h-6 w-6" />}
            title={term ? 'No match' : 'No active residents'}
            description={term ? 'Try another search.' : 'There is no one to check out.'}
          />
        )}
        {list.data && (
          <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} busy={list.isFetching} noun="residents" />
        )}
      </Card>
      <RecentCheckouts />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CheckOut() {
  const [params, setParams] = useSearchParams()
  const { data: org } = useOrg()
  const [result, setResult] = useState<Result | null>(null)
  const selectedId = params.get('h') ?? ''
  const showRequests = params.get('view') === 'requests'
  const q = useHosteler(selectedId || null)

  const select = (id: ID | null) => {
    setResult(null)
    setParams(id ? { h: id } : {}, { replace: false })
    window.scrollTo({ top: 0 })
  }

  if (result)
    return (
      <SettlementSummary
        r={result}
        orgName={org?.name ?? 'HostelHub'}
        onDone={() => {
          setResult(null)
          setParams({})
        }}
      />
    )

  if (!selectedId) return <ChooseResident onSelect={select} showRequests={showRequests} />
  if (q.isLoading) return <LoadingState />
  if (q.error || !q.data)
    return <ChooseResident onSelect={select} notice="That resident couldn't be found. Choose someone from the list." />
  if (q.data.status !== 'active')
    return (
      <ChooseResident
        onSelect={select}
        notice={`${q.data.name} isn't currently checked in${q.data.status === 'reserved' ? ' (reservation)' : ''}. Choose someone from the list.`}
      />
    )
  return <SettlementForm key={q.data.id} h={q.data} onBack={() => select(null)} onDone={(r) => setResult(r)} />
}

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

function SettlementForm({ h, onBack, onDone }: { h: HostelerDetail; onBack: () => void; onDone: (r: Result) => void }) {
  const can = useCan()
  const qc = useQueryClient()
  const canFees = can('fees')

  const [date, setDate] = useState(today())
  /** '' = the deposit the server works out (payments / agreed amount) */
  const [heldOverride, setHeldOverride] = useState('')
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [adjust, setAdjust] = useState(true)
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({ keys: false, idcard: false, inspected: false })
  const [pay, setPay] = useState<{ invoiceId: ID | null } | null>(null)
  const [duesError, setDuesError] = useState<{ message: string; details: DuesPendingDetails | null } | null>(null)

  const dDate = useDebounced(date, 300)
  const dHeld = useDebounced(heldOverride, 400)
  const heldParam = dHeld.trim() === '' ? undefined : Math.max(0, Math.round(Number(dHeld) || 0))
  const dateOk = DATE_RE.test(dDate) && dDate >= h.checkInDate
  const previewQ = useCheckOutPreview(h.id, { date: dDate, adjustDuesFromDeposit: adjust, depositHeld: heldParam }, dateOk)
  const p = previewQ.data
  const settling = date !== dDate || heldOverride !== dHeld || previewQ.isFetching

  const checkOut = useApiMutation(hostelersApi.checkOut, {
    // the profile query is refreshed after the summary is shown (else this form would unmount first)
    invalidate: [...HOSTELER_INVALIDATE.filter((k) => k[0] !== 'hosteler'), ['dues'], ['deposits'], ['attendance'], ['move-out-requests'], ['notifications']],
    success: (r) => `${r.settlement.name} checked out`,
    toastErrors: false,
    onSuccess: (r) => {
      onDone({ s: r.settlement, phone: h.phone, hostel: h.hostelName ?? '' })
      window.scrollTo({ top: 0 })
      void qc.invalidateQueries({ queryKey: ['hosteler'] })
    },
  })

  // ---- settlement (the preview has no deductions; they are added here the same way the API does) ----
  const deductionLines = deductions
    .map((d) => ({ label: d.label.trim() || 'Deduction', amount: Math.max(0, Math.round(Number(d.amount) || 0)) }))
    .filter((d) => d.amount > 0)
  const totalDeductions = deductionLines.reduce((a, d) => a + d.amount, 0)
  const forfeited = !!p?.depositForfeited
  const afterDeductions = p ? (forfeited ? 0 : p.held - p.adjusted - totalDeductions) : 0
  const deductionShortfall = Math.max(-afterDeductions, 0)
  const toCollect = p ? p.remainingDues + deductionShortfall : 0
  const refund = Math.max(afterDeductions, 0)
  const blockers = [
    ...(p?.blockers ?? []),
    ...(deductionShortfall > 0
      ? [`Deductions are ${formatMoney(deductionShortfall)} more than the deposit left. Raise a bill for the extra charges and collect it, or reduce the deductions.`]
      : []),
  ]
  const canCheckOut = !!p && toCollect <= 0
  const allChecked = CHECKLIST.every((c) => checks[c.key])
  const bed = bedText(h)
  const days = p?.days ?? Math.max(daysBetween(h.checkInDate, date || today()), 0)
  const unpaid = p?.unpaidBills ?? []
  const firstOpenBill = unpaid.find((b) => b.remaining > 0) ?? null
  const request = p?.moveOutRequest ?? null

  const submit = async () => {
    if (!date || !DATE_RE.test(date)) return toast.error('Choose the checkout date')
    if (date < h.checkInDate) return toast.error('Checkout date cannot be before check-in')
    if (!canCheckOut) return toast.error('Clear the dues first')
    if (!allChecked) return toast.error('Complete the checkout checklist first')
    const ok = await confirm({
      title: `Check out ${h.name}?`,
      message: `${bed} will be freed, and Hosteler ID ${h.loginId} will be closed (no more portal login). ${
        forfeited ? 'The deposit is forfeited — no refund.' : `Refund ${formatMoney(refund)} to the resident.`
      }`,
      confirmText: 'Check out',
      danger: true,
    })
    if (!ok) return
    setDuesError(null)
    checkOut.mutate(
      {
        id: h.id,
        date,
        deductions: deductionLines,
        adjustDuesFromDeposit: adjust,
        ...(heldOverride.trim() !== '' ? { depositHeld: Math.max(0, Math.round(Number(heldOverride) || 0)) } : {}),
        note: notes.trim(),
      },
      {
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'DUES_PENDING') {
            setDuesError({ message: e.message, details: (e.details as DuesPendingDetails | undefined) ?? null })
            void previewQ.refetch()
            toast.error('Dues must be cleared before check-out')
            window.scrollTo({ top: 0, behavior: 'smooth' })
          } else toast.error(errorMessage(e))
        },
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Check-out"
        subtitle="Clear all dues, settle the deposit, then free up the bed."
        actions={
          <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} disabled={checkOut.isPending}>
            Choose another
          </Button>
        }
      />

      {duesError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-start gap-2 font-semibold">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Check-out was blocked: dues are pending
          </p>
          <p className="mt-1">{duesError.message}</p>
          {duesError.details && duesError.details.unpaidBills.length > 0 && (
            <ul className="mt-2 list-inside list-disc">
              {duesError.details.unpaidBills.map((b) => (
                <li key={b.id}>
                  {b.number} ({billPeriod(b)}): {formatMoney(b.remaining)} due
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="mt-2 text-xs font-medium underline" onClick={() => setDuesError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <HostelerAvatar h={h} size="lg" />
              <div className="min-w-0">
                <Link to={`/app/hostelers/${h.id}`} className="text-lg font-bold text-slate-900 hover:underline">
                  {h.name}
                </Link>
                <p className="text-sm text-slate-500">
                  {h.phone} · <span className="font-mono">{h.loginId}</span> · {h.hostelName ?? '—'}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Room</p>
                <p className="font-medium text-slate-900">{bed}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Checked in</p>
                <p className="font-medium text-slate-900">{formatDate(h.checkInDate)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Stayed</p>
                <p className="font-medium text-slate-900">
                  {days} days{p ? ` · ${plural(p.monthsStayed, 'month')}` : ''}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Monthly rent</p>
                <p className="font-medium text-slate-900">{formatMoney(h.monthlyRent)}</p>
              </div>
            </div>
          </Card>

          {request && (
            <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center">
              <CalendarClock className="hidden h-5 w-5 shrink-0 text-brand-600 sm:block" />
              <div className="min-w-0 flex-1 text-sm text-brand-900">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  Move-out requested for {formatDate(request.moveOutDate, 'EEE, dd MMM yyyy')} <MoveOutBadge status={request.status} />
                </p>
                <p className="text-brand-800">
                  {request.status === 'pending'
                    ? 'The request is still waiting for approval. Checking out now completes it.'
                    : 'Approved. Checking out completes the request.'}
                </p>
              </div>
              {request.moveOutDate !== date && request.moveOutDate >= h.checkInDate && (
                <Button size="sm" variant="outline" onClick={() => setDate(request.moveOutDate)}>
                  Use this date
                </Button>
              )}
            </div>
          )}

          {!dateOk ? (
            <Card className="p-5 text-sm text-slate-500">Choose a valid checkout date (on or after {formatDate(h.checkInDate)}) to work out the settlement.</Card>
          ) : previewQ.isLoading ? (
            <Card>
              <LoadingState className="py-10" label="Working out the settlement…" />
            </Card>
          ) : previewQ.error || !p ? (
            <Card>
              <ErrorState error={previewQ.error} onRetry={() => void previewQ.refetch()} className="py-10" />
            </Card>
          ) : (
            <>
              {/* Deposit */}
              <Card>
                <CardHeader
                  title="Security deposit"
                  subtitle={
                    p.minStayMonths > 0
                      ? `Refundable after ${plural(p.minStayMonths, 'month')} of stay · stayed ${plural(p.monthsStayed, 'month')}`
                      : 'This hostel always refunds the deposit'
                  }
                  action={
                    forfeited ? (
                      <Badge tone="red">Forfeited</Badge>
                    ) : p.held > 0 ? (
                      <Badge tone="green">Refundable</Badge>
                    ) : (
                      <Badge>None held</Badge>
                    )
                  }
                />
                <div className="space-y-3 p-5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Deposit held</span>
                    <span className="font-semibold text-slate-900">{formatMoney(p.held)}</span>
                  </div>
                  {p.minStayMonths > 0 && (
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>Months stayed</span>
                        <span>
                          {p.monthsStayed} / {p.minStayMonths}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn('h-full rounded-full', p.monthsStayed >= p.minStayMonths ? 'bg-emerald-500' : 'bg-red-400')}
                          style={{ width: `${Math.min((p.monthsStayed / p.minStayMonths) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {forfeited && p.forfeitReason && (
                    <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{p.forfeitReason}.</span>
                    </p>
                  )}
                </div>
              </Card>

              {/* Dues */}
              <Card>
                <CardHeader
                  title="Dues"
                  subtitle={
                    p.dues > 0
                      ? `${plural(unpaid.length, 'unpaid bill')} · every bill must be paid before check-out`
                      : 'All bills are paid'
                  }
                  action={
                    <span className={cn('text-lg font-bold', p.remainingDues > 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {p.remainingDues > 0 ? formatMoney(p.remainingDues) : 'Clear'}
                    </span>
                  }
                />
                {unpaid.length > 0 && (
                  <Table className={cn(settling && 'opacity-60')}>
                    <THead>
                      <tr>
                        <TH>Bill</TH>
                        <TH>Due</TH>
                        <TH className="text-right">Balance</TH>
                        <TH className="text-right">From deposit</TH>
                        <TH className="text-right">To collect</TH>
                        {canFees && <TH />}
                      </tr>
                    </THead>
                    <tbody>
                      {unpaid.map((b) => (
                        <TR key={b.id}>
                          <TD>
                            <p className="font-medium text-slate-900">{b.number}</p>
                            <p className="text-xs text-slate-500">{billPeriod(b)}</p>
                          </TD>
                          <TD className={cn('whitespace-nowrap', b.dueDate < today() && 'text-red-600')}>{formatDate(b.dueDate)}</TD>
                          <TD className="text-right">{formatMoney(b.balance)}</TD>
                          <TD className="text-right text-emerald-700">{b.adjustFromDeposit > 0 ? formatMoney(b.adjustFromDeposit) : '—'}</TD>
                          <TD className={cn('text-right font-semibold', b.remaining > 0 ? 'text-red-600' : 'text-emerald-600')}>
                            {b.remaining > 0 ? formatMoney(b.remaining) : 'Covered'}
                          </TD>
                          {canFees && (
                            <TD className="text-right">
                              {b.remaining > 0 && (
                                <Button size="sm" variant="outline" icon={<IndianRupee className="h-3.5 w-3.5" />} onClick={() => setPay({ invoiceId: b.id })}>
                                  Record payment
                                </Button>
                              )}
                            </TD>
                          )}
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
                {p.dues > 0 && (
                  <div className="border-t border-slate-100 px-5 py-3">
                    <Switch
                      checked={adjust && !forfeited}
                      disabled={forfeited}
                      onChange={setAdjust}
                      label={forfeited ? 'Adjust dues from the deposit (not allowed: deposit forfeited)' : 'Adjust dues from the deposit (oldest bill first)'}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      {forfeited
                        ? 'A forfeited deposit is kept by the hostel and cannot pay the dues. Collect the full amount.'
                        : adjust
                          ? `${formatMoney(p.adjusted)} will be recorded as paid from the deposit at check-out.`
                          : 'Dues must be paid in full; the whole deposit is refunded.'}
                    </p>
                  </div>
                )}
              </Card>
            </>
          )}

          <Card>
            <CardHeader
              title="Deductions"
              subtitle={forfeited ? 'Covered by the forfeited deposit' : 'Damages, cleaning, lost keys… taken from the deposit'}
              action={
                <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setDeductions((d) => [...d, { key: uid(), label: '', amount: '' }])}>
                  Add line
                </Button>
              }
            />
            <div className="space-y-3 p-5">
              {deductions.length === 0 && <p className="text-sm text-slate-500">No deductions.</p>}
              {deductions.map((d) => (
                <div key={d.key} className="flex items-center gap-2">
                  <Input
                    placeholder="e.g. Broken chair"
                    maxLength={100}
                    value={d.label}
                    onChange={(e) => setDeductions((all) => all.map((x) => (x.key === d.key ? { ...x, label: e.target.value } : x)))}
                  />
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="Amount"
                    className="w-28 shrink-0 sm:w-32"
                    value={d.amount}
                    onChange={(e) => setDeductions((all) => all.map((x) => (x.key === d.key ? { ...x, amount: e.target.value } : x)))}
                  />
                  <IconButton label="Remove" onClick={() => setDeductions((all) => all.filter((x) => x.key !== d.key))} className="hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
              {deductions.length === 0 && (
                <div className="flex flex-wrap gap-2">
                  {['Room cleaning', 'Damages', 'Lost key'].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setDeductions((d) => [...d, { key: uid(), label: l, amount: '' }])}
                      className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-400"
                    >
                      + {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5 lg:sticky lg:top-20">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Settlement</h3>
              {settling && dateOk && <Spinner className="h-4 w-4" />}
            </div>
            <Field label="Checkout date">
              <Input type="date" value={date} min={h.checkInDate} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field
              label="Security deposit held"
              className="mt-4"
              hint={`Agreed ${formatMoney(h.securityDeposit)} · collected ${formatMoney(h.depositCollected)}. Leave blank to use ${p ? formatMoney(p.held) : 'the recorded amount'}.`}
            >
              <Input type="number" min={0} inputMode="numeric" value={heldOverride} placeholder={p ? String(p.held) : ''} onChange={(e) => setHeldOverride(e.target.value)} />
            </Field>
            {p && (
              <dl className={cn('mt-4 space-y-2 text-sm', settling && 'opacity-60')}>
                <div className="flex justify-between">
                  <dt className="text-slate-600">Deposit</dt>
                  <dd className="font-medium">{formatMoney(p.held)}</dd>
                </div>
                {forfeited ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Forfeited</dt>
                    <dd className="font-medium text-red-600">− {formatMoney(p.held)}</dd>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Dues paid from deposit</dt>
                      <dd className="font-medium text-red-600">− {formatMoney(p.adjusted)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Deductions</dt>
                      <dd className="font-medium text-red-600">− {formatMoney(totalDeductions)}</dd>
                    </div>
                  </>
                )}
                <div className={cn('flex justify-between rounded-lg px-3 py-3', toCollect > 0 ? 'bg-red-50' : 'bg-emerald-50')}>
                  <dt className={cn('font-semibold', toCollect > 0 ? 'text-red-800' : 'text-emerald-800')}>{toCollect > 0 ? 'Still to collect' : 'Refund'}</dt>
                  <dd className={cn('text-lg font-bold', toCollect > 0 ? 'text-red-700' : 'text-emerald-700')}>{formatMoney(toCollect > 0 ? toCollect : refund)}</dd>
                </div>
              </dl>
            )}

            {p && blockers.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="mb-1 flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="h-4 w-4" /> Can't check out yet
                </p>
                <ul className="list-inside list-disc space-y-1 text-xs">
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                {p.remainingDues > 0 &&
                  (canFees ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full bg-white"
                      icon={<IndianRupee className="h-3.5 w-3.5" />}
                      onClick={() => setPay({ invoiceId: firstOpenBill?.id ?? null })}
                    >
                      Record payment
                    </Button>
                  ) : (
                    <p className="mt-2 text-xs">Ask the owner or accountant to record the payment in Fees.</p>
                  ))}
              </div>
            )}

            <Field label="Notes" className="mt-4">
              <Textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for leaving, forwarding address…" />
            </Field>
            <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist</p>
              {CHECKLIST.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={checks[c.key]}
                    onChange={(e) => setChecks((s) => ({ ...s, [c.key]: e.target.checked }))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <Button
              variant="danger"
              className="mt-5 w-full"
              icon={<LogOut className="h-4 w-4" />}
              disabled={!allChecked || !canCheckOut || settling}
              loading={checkOut.isPending}
              onClick={() => void submit()}
            >
              Check out
            </Button>
            <p className="mt-2 text-center text-xs text-slate-500">
              {!p
                ? 'Waiting for the settlement…'
                : !canCheckOut
                  ? 'Clear the dues above to continue.'
                  : !allChecked
                    ? 'Tick every checklist item to continue.'
                    : `The bed is freed and ${h.loginId}'s portal login is closed.`}
            </p>
          </Card>
        </div>
      </div>
      <RecentCheckouts />

      {canFees && (
        <RecordPaymentModal
          open={!!pay}
          onClose={() => {
            setPay(null)
            setDuesError(null)
            void previewQ.refetch()
          }}
          hostelerId={h.id}
          invoiceId={pay?.invoiceId ?? null}
        />
      )}
    </>
  )
}
