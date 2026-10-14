/**
 * Move-out requests (hostelers giving notice from the portal) on the
 * Check-out page: approve with an optional note, reject with a reason, or
 * start the check-out.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, DoorOpen, LogOut, X } from 'lucide-react'
import { useScope } from '@/api/common'
import { useApproveMoveOut, useMoveOutRequests, useRejectMoveOut, type MoveOutListStatus, type MoveOutRequestRow, type MoveOutStatus } from '@/api/moveOut'
import type { ID } from '@/api/types'
import { Badge, Button, Card, CardHeader, ErrorState, Field, LoadingState, Modal, Tabs, Textarea, type BadgeTone } from '@/components/ui'
import { cn, daysBetween, formatDate, formatDateTime, today } from '@/lib/utils'

const TONE: Record<MoveOutStatus, BadgeTone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate', completed: 'blue' }
const LABEL: Record<MoveOutStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Checked out' }

export function MoveOutBadge({ status }: { status: MoveOutStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>
}

/** "in 12 days" / "today" / "3 days ago" */
function relativeDay(date: string): string {
  const n = daysBetween(today(), date)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n > 0) return `in ${n} days`
  return `${-n} day${n === -1 ? '' : 's'} ago`
}

type Decision = { r: MoveOutRequestRow; mode: 'approve' | 'reject' } | null

function DecideModal({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const approve = useApproveMoveOut()
  const reject = useRejectMoveOut()
  const busy = approve.isPending || reject.isPending
  const close = () => {
    if (busy) return
    setText('')
    setError('')
    onClose()
  }
  if (!decision) return null
  const { r, mode } = decision
  const name = r.hosteler?.name ?? 'the hosteler'

  const submit = () => {
    const response = text.trim()
    if (mode === 'reject' && !response) return setError('Give a reason for rejecting. The hosteler will see it.')
    const opts = { onSuccess: () => close() }
    if (mode === 'approve') approve.mutate({ id: r.id, response }, opts)
    else reject.mutate({ id: r.id, response }, opts)
  }

  return (
    <Modal
      open
      size="sm"
      onClose={close}
      title={mode === 'approve' ? 'Approve move-out?' : 'Reject move-out request?'}
      description={`${name} · ${formatDate(r.moveOutDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={mode === 'approve' ? 'success' : 'danger'} loading={busy} onClick={submit}>
            {mode === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        {mode === 'approve'
          ? `${formatDate(r.moveOutDate)} becomes ${name}'s expected check-out date. They'll be reminded to clear all dues before leaving.`
          : `${name} will be notified with your reason and can request another date.`}
      </p>
      <Field label={mode === 'approve' ? 'Note for the hosteler (optional)' : 'Reason'} required={mode === 'reject'} error={error}>
        <Textarea
          rows={3}
          maxLength={500}
          value={text}
          autoFocus
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError('')
          }}
          placeholder={mode === 'approve' ? 'e.g. Hand over the keys at the office by 11 AM' : 'e.g. Notice period is 30 days; choose a later date'}
        />
      </Field>
    </Modal>
  )
}

export function MoveOutRequests({ onStart, defaultOpen }: { onStart: (hostelerId: ID) => void; defaultOpen?: boolean }) {
  const scope = useScope()
  const [status, setStatus] = useState<MoveOutListStatus>('pending')
  const [decision, setDecision] = useState<Decision>(null)
  const q = useMoveOutRequests({ status, hostelId: scope })
  const pendingQ = useMoveOutRequests({ status: 'pending', hostelId: scope })
  const items = q.data?.items ?? []
  const pendingCount = pendingQ.data?.items.length

  // keep the card small when there's nothing to act on (unless opened from a notification)
  if (!defaultOpen && status === 'pending' && q.data && items.length === 0) {
    return (
      <Card className="no-print mb-6 flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <DoorOpen className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-slate-600">No pending move-out requests. Hostelers request their move-out date from the app.</p>
        <Button size="sm" variant="ghost" onClick={() => setStatus('approved')}>
          See approved
        </Button>
      </Card>
    )
  }

  return (
    <div id="move-out-requests" className="no-print mb-6 scroll-mt-20">
      <Card>
        <CardHeader title="Move-out requests" subtitle="Notice given by hostelers from the app" />
        <Tabs<MoveOutListStatus>
          className="px-2"
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'pending', label: 'Pending', count: pendingCount || undefined },
            { value: 'approved', label: 'Approved' },
            { value: 'all', label: 'All' },
          ]}
        />
        {q.isLoading ? (
          <LoadingState className="py-10" />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-10" />
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {status === 'pending' ? 'No pending requests.' : status === 'approved' ? 'No approved move-outs waiting for check-out.' : 'No move-out requests yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((r) => {
              const h = r.hosteler
              const canStart = h?.status === 'active' && (r.status === 'pending' || r.status === 'approved')
              const late = r.status === 'approved' && r.moveOutDate < today()
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {h ? (
                          <Link to={`/app/hostelers/${h.id}`} className="font-semibold text-slate-900 hover:underline">
                            {h.name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-500">Deleted hosteler</span>
                        )}
                        <MoveOutBadge status={r.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {h && <span className="font-mono">{h.loginId}</span>}
                        {r.roomNumber && ` · Room ${r.roomNumber}${r.bedLabel ? `-${r.bedLabel}` : ''}`}
                        {r.hostelName && ` · ${r.hostelName}`}
                      </p>
                      <p className={cn('mt-2 flex items-center gap-1.5 text-sm font-medium', late ? 'text-red-600' : 'text-slate-800')}>
                        <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />
                        Moving out {formatDate(r.moveOutDate, 'EEE, dd MMM yyyy')}
                        <span className="font-normal text-slate-500">({relativeDay(r.moveOutDate)})</span>
                      </p>
                      {r.reason && <p className="mt-1 text-sm text-slate-600">Reason: {r.reason}</p>}
                      {r.response && (
                        <p className={cn('mt-1 text-sm', r.status === 'rejected' ? 'text-red-700' : 'text-slate-600')}>
                          {r.status === 'rejected' ? 'Rejection reason' : 'Note'}: {r.response}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-400">
                        Requested {formatDateTime(r.createdAt)}
                        {r.decidedAt && ` · ${LABEL[r.status].toLowerCase()} ${r.decidedByName ? `by ${r.decidedByName} ` : ''}on ${formatDate(r.decidedAt)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      {r.status === 'pending' && (
                        <>
                          <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setDecision({ r, mode: 'approve' })}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" icon={<X className="h-4 w-4" />} onClick={() => setDecision({ r, mode: 'reject' })}>
                            Reject
                          </Button>
                        </>
                      )}
                      {canStart && h && (
                        <Button size="sm" variant={r.status === 'approved' ? 'primary' : 'outline'} icon={<LogOut className="h-4 w-4" />} onClick={() => onStart(h.id)}>
                          Start check-out
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <DecideModal key={decision?.r.id ?? 'none'} decision={decision} onClose={() => setDecision(null)} />
      </Card>
    </div>
  )
}
