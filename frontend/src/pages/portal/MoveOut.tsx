import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronRight, DoorOpen, Info, ScrollText, X } from 'lucide-react'
import { errorMessage } from '@/api/client'
import { MOVE_OUT_STATUS_LABEL, useCancelMoveOut, useMyMoveOut, useRequestMoveOut, type MoveOutRequest } from '@/api/moveOut'
import { usePortalHome } from '@/api/portal'
import { Badge, Button, Card, ErrorState, Field, Input, LoadingState, Textarea, confirm, type BadgeTone } from '@/components/ui'
import { cn, daysBetween, formatDate, formatDateTime } from '@/lib/utils'
import { PortalTitle, SectionTitle, useMoney } from './_shared'

const TONE: Record<MoveOutRequest['status'], BadgeTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'slate',
  completed: 'blue',
}

export function MoveOutStatusBadge({ r }: { r: Pick<MoveOutRequest, 'status'> }) {
  return <Badge tone={TONE[r.status]}>{MOVE_OUT_STATUS_LABEL[r.status]}</Badge>
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Compact card for the Profile page: the active request, or a link to request one. */
export function MoveOutCard() {
  const q = useMyMoveOut()
  const active = q.data?.active ?? null
  return (
    <Link to="/portal/move-out" className="block">
      <Card className="flex items-center gap-3 p-4 transition hover:bg-slate-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <DoorOpen className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{active ? `Moving out on ${formatDate(active.moveOutDate)}` : 'Moving out?'}</p>
          <p className="truncate text-xs text-slate-500">
            {active
              ? MOVE_OUT_STATUS_LABEL[active.status]
              : q.data
                ? `Request your move-out date · ${plural(q.data.noticePeriodDays, 'day')} notice`
                : 'Request your move-out date'}
          </p>
        </div>
        {active && <MoveOutStatusBadge r={active} />}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </Card>
    </Link>
  )
}

/**
 * Give notice: the hosteler picks a move-out date (at least the hostel's
 * notice period away) and the office approves or rejects it.
 */
export default function MoveOut() {
  const q = useMyMoveOut()
  const home = usePortalHome()
  const money = useMoney()
  const request = useRequestMoveOut()
  const cancel = useCancelMoveOut()

  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ date?: string; reason?: string }>({})

  if (q.isLoading) return <LoadingState />
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Card>
    )
  const d = q.data
  const active = d.active
  const history = d.items.filter((r) => r.id !== active?.id)
  const dues = home.data?.dues.total ?? 0

  const submit = () => {
    const e: typeof errors = {}
    if (!date) e.date = 'Choose your move-out date.'
    else if (date < d.earliestDate) e.date = `The earliest date you can choose is ${formatDate(d.earliestDate)} (${plural(d.noticePeriodDays, 'day')} notice).`
    if (reason.trim().length > 500) e.reason = 'Keep it under 500 characters.'
    setErrors(e)
    if (Object.keys(e).length) return
    request.mutate(
      { moveOutDate: date, reason: reason.trim() },
      {
        onSuccess: () => {
          setDate('')
          setReason('')
        },
        onError: (err) => setErrors({ date: errorMessage(err) }),
      },
    )
  }

  const doCancel = async (r: MoveOutRequest) => {
    const ok = await confirm({
      title: 'Cancel your move-out request?',
      message:
        r.status === 'approved'
          ? `Your approved move-out on ${formatDate(r.moveOutDate)} will be cancelled. To move out later you'll need to give notice again.`
          : `Your request to move out on ${formatDate(r.moveOutDate)} will be withdrawn.`,
      confirmText: 'Cancel request',
      danger: true,
    })
    if (ok) cancel.mutate(r.id)
  }

  return (
    <div>
      <PortalTitle title="Move out" subtitle="Give notice before you leave the hostel" />

      {/* Terms */}
      <Card className="p-4">
        <ul className="space-y-3 text-sm text-slate-700">
          <li className="flex gap-3">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              {d.noticePeriodDays > 0 ? (
                <>
                  Your hostel needs <b>{plural(d.noticePeriodDays, 'day')}</b> of notice. The earliest move-out date you can choose today is{' '}
                  <b>{formatDate(d.earliestDate)}</b>.
                </>
              ) : (
                'Choose the date you plan to move out. The hostel office will confirm it.'
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>All dues must be paid before check-out. After check-out your Hosteler ID and app login are closed.</span>
          </li>
          <li className="flex gap-3">
            <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              {d.depositMinStayMonths ? (
                <>
                  Your security deposit is refunded only if you have stayed at least <b>{plural(d.depositMinStayMonths, 'month')}</b> (counted from your
                  check-in date). Leaving earlier means the deposit is not returned.
                </>
              ) : (
                'Your security deposit is refundable when you leave (after any dues or damages are settled).'
              )}{' '}
              See the{' '}
              <Link to="/portal/rules" className="font-medium text-brand-600 hover:underline">
                hostel rules
              </Link>
              .
            </span>
          </li>
        </ul>
        {dues > 0 && (
          <Link
            to="/portal/fees"
            className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 hover:bg-amber-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              You have <b>{money(dues)}</b> due. Pay it before your move-out date →
            </span>
          </Link>
        )}
      </Card>

      {active ? (
        <>
          <SectionTitle>Your move-out request</SectionTitle>
          <Card className={cn('p-4', active.status === 'approved' ? 'border-emerald-200' : 'border-amber-200')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Move-out date</p>
                <p className="text-lg font-bold text-slate-900">{formatDate(active.moveOutDate, 'EEE, dd MMM yyyy')}</p>
                {active.moveOutDate >= d.today && (
                  <p className="text-xs text-slate-500">
                    {active.moveOutDate === d.today ? 'Today' : `in ${plural(daysBetween(d.today, active.moveOutDate), 'day')}`}
                  </p>
                )}
              </div>
              <MoveOutStatusBadge r={active} />
            </div>
            {active.reason && <p className="mt-3 text-sm text-slate-600">Reason: {active.reason}</p>}
            {active.status === 'pending' && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">The hostel office will review your request. You'll get a notification.</p>
            )}
            {active.status === 'approved' && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Approved{active.decidedByName ? ` by ${active.decidedByName}` : ''}
                {active.decidedAt ? ` on ${formatDate(active.decidedAt)}` : ''}. Clear all dues and return your keys and ID card on the day.
                {active.response && <span className="mt-1 block">Note: {active.response}</span>}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">Requested {formatDateTime(active.createdAt)}</p>
            <Button
              variant="outline"
              className="mt-4 w-full text-red-600 hover:bg-red-50 sm:w-auto"
              icon={<X className="h-4 w-4" />}
              loading={cancel.isPending}
              onClick={() => void doCancel(active)}
            >
              Cancel request
            </Button>
          </Card>
        </>
      ) : (
        <>
          <SectionTitle>Request a move-out date</SectionTitle>
          <Card className="space-y-4 p-4">
            <Field label="Move-out date" required error={errors.date} hint={`Earliest: ${formatDate(d.earliestDate)}`}>
              <Input
                type="date"
                min={d.earliestDate}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  if (errors.date) setErrors((x) => ({ ...x, date: undefined }))
                }}
              />
            </Field>
            <Field label="Reason (optional)" error={errors.reason}>
              <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Course completed, shifting to another city" />
            </Field>
            <Button className="w-full sm:w-auto" size="lg" icon={<DoorOpen className="h-4 w-4" />} loading={request.isPending} onClick={submit}>
              Send request
            </Button>
          </Card>
        </>
      )}

      {history.length > 0 && (
        <>
          <SectionTitle>Earlier requests</SectionTitle>
          <Card className="divide-y divide-slate-100">
            {history.map((r) => (
              <div key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{formatDate(r.moveOutDate)}</p>
                    <p className="text-xs text-slate-500">Requested {formatDate(r.createdAt)}</p>
                  </div>
                  <MoveOutStatusBadge r={r} />
                </div>
                {r.reason && <p className="mt-2 text-sm text-slate-600">Reason: {r.reason}</p>}
                {r.response && (
                  <p className={cn('mt-2 rounded-lg px-3 py-2 text-sm', r.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600')}>
                    {r.status === 'rejected' ? 'Rejected: ' : 'Note: '}
                    {r.response}
                  </p>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
