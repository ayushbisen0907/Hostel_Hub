/**
 * Rooms & Beds → Electricity: meter readings by period.
 *
 * One meter per room (hostel.electricityBasis 'room') or per bed ('bed').
 * A reading says which period it covers (from–to) and how many units were
 * used. Amount = units × rate, shared among everyone who stayed on that meter
 * during the period in proportion to the days each stayed; each share is added
 * to the hosteler's current bill (or their next bill if they have none yet).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronUp, History, Info, Pencil, Plus, Settings2, Trash2, Zap } from 'lucide-react'
import { useHostels, useSingleHostelId } from '@/api/common'
import {
  savedMessage,
  useCreateReading,
  useDeleteReading,
  useElectricity,
  useMeterReadings,
  useReadingPreview,
  useUpdateReading,
  type ElectricityMeter,
  type ElectricityReading,
  type ReadingInput,
  type SaveReadingResult,
} from '@/api/electricity'
import { useCan } from '@/api/session'
import type { ID } from '@/api/types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Select, Spinner, confirm, toast } from '@/components/ui'
import { cn, formatDateTime, formatMoney, formatPeriod } from '@/lib/utils'
import { useDebounced } from './_fees'

const MAX_UNITS = 100_000

const meterName = (m: { roomNumber: string; bedId: ID | null; bedLabel: string | null }) => `Room ${m.roomNumber}${m.bedId ? ` · Bed ${m.bedLabel ?? ''}` : ''}`
const rateText = (rate: number) => `₹${rate.toLocaleString('en-IN')}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function floorName(f: number) {
  if (f === 0) return 'Ground floor'
  const mod100 = f % 100
  const mod10 = f % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${f}${suffix} floor`
}

/** Toast for a saved / updated reading: bill counts, then each warning. */
function announce(r: SaveReadingResult, verb: string) {
  toast.success(savedMessage(r, verb))
  for (const w of r.warnings) toast.info(w)
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function ElectricityPanel() {
  const can = useCan()
  const hostelsQ = useHostels()
  const hostels = useMemo(() => hostelsQ.data ?? [], [hostelsQ.data])
  const defaultHostel = useSingleHostelId()
  const [picked, setPicked] = useState<ID | null>(null)
  const hostelId = picked && hostels.some((h) => h.id === picked) ? picked : defaultHostel

  const q = useElectricity(hostelId)
  const data = q.data
  const rate = data?.hostel.rate ?? 0
  const basis = data?.hostel.basis ?? 'room'

  if (hostelsQ.isLoading) return <LoadingState />
  if (!hostels.length || !hostelId)
    return (
      <Card>
        <EmptyState icon={<Zap className="h-6 w-6" />} title="Add a hostel first" description="Electricity readings are entered per hostel." />
      </Card>
    )

  const settingsLink = can('hostels') ? (
    <Link to="/app/settings?tab=hostels" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
      <Settings2 className="h-3.5 w-3.5" /> Change in Settings → Hostels
    </Link>
  ) : (
    <span className="text-slate-500">Ask the owner or manager to change it.</span>
  )

  return (
    <div className="space-y-4">
      {/* ---------------- hostel + rate ---------------- */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
          <Field label="Hostel">
            {hostels.length > 1 ? (
              <Select value={hostelId} options={hostels.map((h) => ({ value: h.id, label: h.name }))} onChange={(e) => setPicked(e.target.value)} />
            ) : (
              <p className="flex h-10 items-center truncate text-sm font-medium text-slate-900">{hostels[0]!.name}</p>
            )}
          </Field>
          {data && rate > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 font-medium text-amber-900">
                <Zap className="h-4 w-4 text-amber-500" /> {rateText(rate)} per unit · {basis === 'room' ? 'Meter per room' : 'Meter per bed'}
              </p>
              <p className="mt-0.5 text-xs">{settingsLink}</p>
            </div>
          )}
        </div>
      </Card>

      {q.isLoading ? (
        <Card>
          <LoadingState label="Loading meters…" />
        </Card>
      ) : q.error ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : !data ? null : rate <= 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-5">
          <p className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Set the electricity rate for {data.hostel.name} first
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Electricity is billed as units × rate per unit. Add the rate (₹ per unit) and choose whether each room or each bed has its own meter in the hostel's
            settings.
          </p>
          <div className="mt-3 text-sm">{settingsLink}</div>
        </Card>
      ) : !data.meters.length ? (
        <Card>
          <EmptyState icon={<Zap className="h-6 w-6" />} title="No rooms yet" description="Add rooms and beds to this hostel to enter meter readings." />
        </Card>
      ) : (
        <>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            For each reading, choose the period it covers (from – to) and the units used. The bill is shared by everyone who stayed on that{' '}
            {basis === 'room' ? 'room' : 'bed'}’s meter in that period, by the number of days each stayed, and added to their current bill.
          </p>
          <div className="space-y-2">
            {data.meters.map((m, idx) => {
              const showFloor = idx === 0 || m.floor !== data.meters[idx - 1]!.floor
              return (
                <div key={`${m.roomId}|${m.bedId ?? ''}`}>
                  {showFloor && <p className="px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{floorName(m.floor)}</p>}
                  <MeterCard meter={m} hostelId={data.hostel.id} today={data.today} rate={rate} />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One meter                                                           */
/* ------------------------------------------------------------------ */

function MeterCard({ meter, hostelId, today, rate }: { meter: ElectricityMeter; hostelId: ID; today: string; rate: number }) {
  const [adding, setAdding] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const last = meter.lastReading
  const from = meter.suggestedFrom && meter.suggestedFrom <= today ? meter.suggestedFrom : today

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {meterName(meter)}
            <span className="text-xs font-normal text-slate-500">
              {meter.bedId ? (meter.occupants.length ? 'Occupied' : 'Vacant') : `${meter.occupants.length}/${meter.beds} beds occupied`}
            </span>
          </p>
          <p className="mt-0.5 truncate text-sm text-slate-600">{meter.occupants.length ? meter.occupants.map((o) => o.name).join(', ') : 'Nobody staying now'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {last ? (
              <>
                Last reading: <span className="font-medium text-slate-700">{formatPeriod(last.fromDate, last.toDate)}</span> · {last.units.toLocaleString('en-IN')} units ·{' '}
                {formatMoney(last.amount)}
              </>
            ) : (
              'No readings yet'
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={showHistory ? <ChevronUp className="h-4 w-4" /> : <History className="h-4 w-4" />}
            onClick={() => setShowHistory((v) => !v)}
            className="flex-1 sm:flex-none"
          >
            History
          </Button>
          {!adding && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} className="flex-1 sm:flex-none">
              Add reading
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <ReadingForm
            meter={meter}
            today={today}
            rate={rate}
            initial={{ fromDate: from, toDate: today, units: '' }}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {showHistory && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <MeterHistory meter={meter} hostelId={hostelId} today={today} rate={rate} />
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Add / edit a reading (with live preview)                            */
/* ------------------------------------------------------------------ */

function ReadingForm({
  meter,
  today,
  rate,
  initial,
  readingId,
  onDone,
}: {
  meter: ElectricityMeter
  today: string
  rate: number
  initial: { fromDate: string; toDate: string; units: string }
  /** set when editing */
  readingId?: ID
  onDone: () => void
}) {
  const [fromDate, setFrom] = useState(initial.fromDate)
  const [toDate, setTo] = useState(initial.toDate)
  const [units, setUnits] = useState(initial.units)

  const n = Number(units)
  const unitsOk = units.trim() !== '' && Number.isFinite(n) && n > 0 && n <= MAX_UNITS
  const datesError = !fromDate || !toDate ? 'Choose both dates' : fromDate > toDate ? '“From” must be on or before “To”' : toDate > today ? 'The period can’t end in the future' : ''
  const unitsError = units.trim() === '' ? '' : unitsOk ? '' : `Enter units between 1 and ${MAX_UNITS.toLocaleString('en-IN')}`

  // preview as soon as the dates are valid (units 0 still shows each person's days)
  const input: ReadingInput | null = datesError
    ? null
    : { roomId: meter.roomId, bedId: meter.bedId, fromDate, toDate, units: unitsOk ? Math.round(n * 100) / 100 : 0 }
  const debounced = useDebounced(input ? JSON.stringify(input) : '', 400)
  const preview = useReadingPreview(debounced ? (JSON.parse(debounced) as ReadingInput) : null)
  const p = preview.data
  const settling = !!input && JSON.stringify(input) !== debounced

  const create = useCreateReading((r) => {
    announce(r, 'Reading saved')
    onDone()
  })
  const update = useUpdateReading((r) => {
    announce(r, 'Reading updated')
    onDone()
  })
  const saving = create.isPending || update.isPending

  const submit = () => {
    if (datesError) return toast.error(datesError)
    if (!unitsOk) return toast.error(`Enter the units used (1 – ${MAX_UNITS.toLocaleString('en-IN')})`)
    const body = { fromDate, toDate, units: Math.round(n * 100) / 100 }
    if (readingId) update.mutate({ id: readingId, ...body })
    else create.mutate({ roomId: meter.roomId, bedId: meter.bedId, ...body })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="From">
          <Input type="date" value={fromDate} max={toDate || today} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={toDate} min={fromDate || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Units used" className="col-span-2 sm:col-span-1" error={unitsError || undefined}>
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_UNITS}
              step="any"
              placeholder="0"
              value={units}
              autoFocus={!readingId}
              onChange={(e) => setUnits(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              className="pr-12 text-right font-semibold tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">units</span>
          </div>
        </Field>
      </div>
      {datesError && <p className="text-xs text-red-600">{datesError}</p>}

      {/* preview */}
      {input && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          {preview.isLoading || (settling && !p) ? (
            <p className="flex items-center gap-2 text-slate-500">
              <Spinner className="h-4 w-4" /> Working out the shares…
            </p>
          ) : preview.error ? (
            <ErrorState error={preview.error} className="py-2" />
          ) : p ? (
            <div className={cn('space-y-2', settling && 'opacity-60')}>
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-slate-600">
                  {formatPeriod(fromDate, toDate)} · {plural(p.periodDays, 'day')}
                </span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {unitsOk ? (
                    <>
                      {n.toLocaleString('en-IN')} × {rateText(p.rate || rate)} = {formatMoney(p.amount)}
                    </>
                  ) : (
                    'Enter units to see the amount'
                  )}
                </span>
              </p>
              {p.shares.length ? (
                <ul className="divide-y divide-slate-200/70">
                  {p.shares.map((s) => (
                    <li key={s.hostelerId} className="flex items-baseline gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-slate-800">{s.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">{plural(s.days, 'day')}</span>
                      {unitsOk && <span className="w-20 shrink-0 text-right font-medium tabular-nums text-slate-900">{formatMoney(s.amount)}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Nobody stayed here during this period — this reading won’t be billed to anyone.
                </p>
              )}
              {p.shares.length > 1 && (
                <p className="text-[11px] text-slate-500">Split by days stayed ({p.totalDays} days in total). Shares are whole rupees.</p>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!!datesError || !unitsOk}>
          {readingId ? 'Save changes' : 'Save reading'}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function MeterHistory({ meter, hostelId, today, rate }: { meter: ElectricityMeter; hostelId: ID; today: string; rate: number }) {
  const q = useMeterReadings(hostelId, meter.roomId, meter.bedId)
  // when the hostel meters per room, the room's list also returns bed readings from before a basis change — keep this meter's only
  const items = (q.data?.items ?? []).filter((r) => (r.bedId ?? null) === (meter.bedId ?? null))

  if (q.isLoading) return <LoadingState label="Loading history…" className="py-4" />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-4" />
  if (!items.length) return <p className="py-2 text-sm text-slate-500">No readings for this meter yet.</p>
  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <ReadingRow key={r.id} reading={r} meter={meter} today={today} rate={rate} />
      ))}
    </ul>
  )
}

function ReadingRow({ reading: r, meter, today, rate }: { reading: ElectricityReading; meter: ElectricityMeter; today: string; rate: number }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const remove = useDeleteReading()

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this reading?',
      message: `${formatPeriod(r.fromDate, r.toDate)} · ${r.units} units · ${formatMoney(r.amount)}. Its electricity lines are removed from the bills they were added to.`,
      confirmText: 'Delete',
      danger: true,
    })
    if (ok) remove.mutate(r.id)
  }

  if (editing)
    return (
      <li className="rounded-lg border border-brand-200 bg-brand-50/30 p-3">
        <p className="mb-2 text-sm font-medium text-slate-900">Edit reading</p>
        <ReadingForm
          meter={meter}
          today={today}
          rate={rate}
          readingId={r.id}
          initial={{ fromDate: r.fromDate, toDate: r.toDate, units: String(r.units) }}
          onDone={() => setEditing(false)}
        />
      </li>
    )

  const waiting = r.splits.filter((s) => s.amount > 0 && !s.invoiceId).length
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-slate-900">
            {formatPeriod(r.fromDate, r.toDate)}
            {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </p>
          <p className="text-xs text-slate-500">
            {r.units.toLocaleString('en-IN')} units × {rateText(r.rate)} = <span className="font-medium text-slate-800">{formatMoney(r.amount)}</span> ·{' '}
            {plural(r.splits.length, 'person')}
            {waiting ? ` · ${waiting} on next bill` : ''}
          </p>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)} aria-label="Edit reading">
            <span className="hidden sm:inline">Edit</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:bg-red-50"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => void onDelete()}
            loading={remove.isPending}
            aria-label="Delete reading"
          >
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          {r.splits.length ? (
            <ul className="space-y-1 text-sm">
              {r.splits.map((s) => (
                <li key={s.hostelerId} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 flex-1 truncate text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-500">{plural(s.days, 'day')}</span>
                  <span className="w-20 text-right font-medium tabular-nums text-slate-900">{formatMoney(s.amount)}</span>
                  <span className="w-full text-right text-[11px] sm:w-32">
                    {s.invoiceId ? (
                      <Badge tone="green">{s.invoiceNumber ?? 'Bill'}</Badge>
                    ) : s.amount > 0 ? (
                      <Badge tone="amber">Added to next bill</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-amber-700">Nobody stayed here during this period — not billed to anyone.</p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            Saved{r.enteredByName ? ` by ${r.enteredByName}` : ''}
            {r.updatedAt ? `, ${formatDateTime(r.updatedAt)}` : ''}
          </p>
        </div>
      )}
    </li>
  )
}
