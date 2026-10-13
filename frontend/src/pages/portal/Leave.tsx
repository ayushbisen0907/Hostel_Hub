import { useMemo, useState } from 'react'
import { BellRing, CalendarDays, CalendarPlus, MapPin } from 'lucide-react'
import { useStore } from '@/store'
import { useCurrentHosteler } from '@/store/selectors'
import { Button, Card, EmptyState, Field, Input, StatusBadge, Textarea, toast } from '@/components/ui'
import { cn, daysBetween, formatDate, today } from '@/lib/utils'
import { NoticeCard, NotLoggedIn, PortalTitle, SectionTitle, useMyNotices, useScrollToHash } from './_shared'

export default function Leave() {
  const me = useCurrentHosteler()
  const leaves = useStore((s) => s.leaves)
  const requestLeave = useStore((s) => s.requestLeave)
  const notices = useMyNotices(me)
  useScrollToHash()

  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mine = useMemo(
    () => (me ? leaves.filter((l) => l.hostelerId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [leaves, me],
  )

  if (!me) return <NotLoggedIn />

  const nights = from && to && to >= from ? daysBetween(from, to) + 1 : 0

  const submit = () => {
    const e: Record<string, string> = {}
    const t = today()
    if (!from) e.from = 'Pick a start date'
    else if (from < t) e.from = "Start date can't be in the past"
    if (!to) e.to = 'Pick an end date'
    else if (from && to < from) e.to = 'End date must be on or after the start date'
    if (!destination.trim()) e.destination = 'Where are you going?'
    if (reason.trim().length < 3) e.reason = 'Please add a short reason'
    const overlap = mine.find((l) => l.status !== 'rejected' && l.from <= to && l.to >= from)
    if (!e.from && !e.to && overlap)
      e.to = `Overlaps with your ${overlap.status} leave (${formatDate(overlap.from, 'dd MMM')} – ${formatDate(overlap.to, 'dd MMM')})`
    setErrors(e)
    if (Object.keys(e).length) return
    requestLeave({ hostelerId: me.id, from, to, destination: destination.trim(), reason: reason.trim() })
    toast.success('Leave request sent to the warden')
    setFrom(today())
    setTo(today())
    setDestination('')
    setReason('')
  }

  return (
    <div className="pb-4">
      <PortalTitle title="Leave & notices" subtitle="Going home or travelling? Let the warden know." />

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <p className="font-semibold text-slate-900">Apply for leave</p>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required error={errors.from}>
              <Input
                type="date"
                min={today()}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  if (to < e.target.value) setTo(e.target.value)
                }}
                className="h-11"
              />
            </Field>
            <Field label="To" required error={errors.to}>
              <Input type="date" min={from || today()} value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
            </Field>
          </div>
          {nights > 0 && (
            <p className="-mt-1 text-xs text-slate-500">
              {nights} day{nights > 1 ? 's' : ''} away
            </p>
          )}
          <Field label="Destination" required error={errors.destination}>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Home – Jaipur" className="h-11" />
          </Field>
          <Field label="Reason" required error={errors.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Festival holidays with family" rows={3} />
          </Field>
          <Button size="lg" className="w-full rounded-xl" onClick={submit}>
            Submit request
          </Button>
        </div>
      </Card>

      <SectionTitle>My leave requests</SectionTitle>
      <Card>
        {mine.length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No leave requests" description="Requests you submit will appear here with their status." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.map((l) => {
              const days = daysBetween(l.from, l.to) + 1
              const ongoing = l.status === 'approved' && l.from <= today() && l.to >= today()
              return (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {formatDate(l.from, 'dd MMM')} – {formatDate(l.to, 'dd MMM yyyy')}
                        <span className="ml-1.5 text-xs font-normal text-slate-500">
                          ({days} day{days > 1 ? 's' : ''})
                        </span>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <span className="truncate">{l.destination || '—'}</span>
                      </p>
                      {l.reason && <p className="mt-0.5 text-sm text-slate-500">{l.reason}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={l.status} />
                      {ongoing && <span className="text-[11px] font-medium text-violet-600">On leave now</span>}
                    </div>
                  </div>
                  <p className={cn('mt-1 text-[11px] text-slate-400')}>
                    Applied {formatDate(l.createdAt)}
                    {l.decidedAt && ` · ${l.status === 'approved' ? 'Approved' : 'Rejected'} ${formatDate(l.decidedAt)}`}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <SectionTitle id="notices">Notices</SectionTitle>
      {notices.length === 0 ? (
        <Card>
          <EmptyState icon={<BellRing className="h-5 w-5" />} title="No notices" description="Announcements from the hostel will appear here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </div>
      )}
    </div>
  )
}
