/**
 * Rooms & Beds → Electricity: enter the month's meter readings.
 *
 * One row per room (hostel.electricityBasis 'room' — the amount is split
 * equally among the room's hostelers) or per bed ('bed'). Amount = units ×
 * rate; each hosteler's share is added to their bill for that month
 * (immediately if the bill exists, otherwise when the bills are generated).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Save, Settings2, Zap } from 'lucide-react'
import { useHostels, useSingleHostelId } from '@/api/common'
import { useElectricitySheet, useSaveReadings, type ElectricityRow, type ReadingInput, type SaveReadingsResult } from '@/api/electricity'
import { useCan } from '@/api/session'
import type { ID } from '@/api/types'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Select, confirm, toast } from '@/components/ui'
import { splitEqually } from '@/lib/charges'
import { cn, currentMonth, formatDateTime, formatMoney, formatMonth } from '@/lib/utils'

const MAX_UNITS = 100_000

const rowKey = (r: { roomId: ID; bedId: ID | null }) => `${r.roomId}|${r.bedId ?? ''}`
const rowName = (r: ElectricityRow) => `Room ${r.roomNumber}${r.bedId ? ` · Bed ${r.bedLabel ?? ''}` : ''}`
const rateText = (rate: number) => `₹${rate.toLocaleString('en-IN')}`

function floorName(f: number) {
  if (f === 0) return 'Ground floor'
  const mod100 = f % 100
  const mod10 = f % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${f}${suffix} floor`
}

/** '' -> null (no reading); invalid -> undefined */
function parseUnits(v: string): number | null | undefined {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > MAX_UNITS) return undefined
  return n === 0 ? null : Math.round(n * 100) / 100
}

interface RowState {
  row: ElectricityRow
  key: string
  value: string
  units: number | null | undefined
  changed: boolean
  /** saved reading no longer matches the current rate / occupants */
  stale: boolean
  amount: number
  shares: { id: string; name: string; amount: number; billed: boolean }[]
}

export function ElectricityPanel() {
  const can = useCan()
  const hostelsQ = useHostels()
  const hostels = useMemo(() => hostelsQ.data ?? [], [hostelsQ.data])
  const defaultHostel = useSingleHostelId()
  const [picked, setPicked] = useState<ID | null>(null)
  const hostelId = picked && hostels.some((h) => h.id === picked) ? picked : defaultHostel
  const [month, setMonth] = useState(currentMonth())

  // only the user's edits; everything else comes from the saved readings
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [forced, setForced] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{
    res: SaveReadingsResult
    pending: number
  } | null>(null)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const saveBtn = useRef<HTMLButtonElement>(null)

  const sheetQ = useElectricitySheet(hostelId, month)
  const sheet = sheetQ.data
  const rate = sheet?.hostel.rate ?? 0
  const basis = sheet?.hostel.basis ?? 'room'

  const save = useSaveReadings()

  const rows: RowState[] = useMemo(() => {
    if (!sheet) return []
    return sheet.rows.map((row) => {
      const key = rowKey(row)
      const saved = row.reading?.units ?? null
      const value = draft[key] ?? (saved != null ? String(saved) : '')
      const units = parseUnits(value)
      const stale =
        !!row.reading &&
        (row.reading.rate !== sheet.hostel.rate ||
          row.reading.splits.length !== row.occupants.length ||
          row.reading.splits.some((s, i) => s.hostelerId !== row.occupants[i]?.id))
      const changed = (units !== undefined && units !== saved) || (forced.has(key) && units !== undefined)
      let amount = 0
      let shares: RowState['shares'] = []
      if (!changed && row.reading) {
        amount = row.reading.amount
        shares = row.reading.splits.map((s) => ({
          id: s.hostelerId,
          name: s.name,
          amount: s.amount,
          billed: row.occupants.find((o) => o.id === s.hostelerId)?.billed ?? false,
        }))
      } else if (units) {
        amount = Math.round(units * sheet.hostel.rate)
        const parts = splitEqually(amount, row.occupants.length)
        shares = row.occupants.map((o, i) => ({
          id: o.id,
          name: o.name,
          amount: parts[i] ?? 0,
          billed: o.billed,
        }))
      }
      return { row, key, value, units, changed, stale, amount, shares }
    })
  }, [sheet, draft, forced])

  const changedRows = rows.filter((r) => r.changed)
  const invalidRows = rows.filter((r) => r.units === undefined)
  const dirty = changedRows.length > 0 || invalidRows.length > 0
  const totals = rows.reduce(
    (a, r) => ({
      units: a.units + (r.units ?? 0),
      amount: a.amount + (r.units ? r.amount : 0),
    }),
    { units: 0, amount: 0 },
  )
  const filledRows = rows.filter((r) => r.units).length

  const resetDraft = () => {
    setDraft({})
    setForced(new Set())
  }

  const guardDirty = async () =>
    !dirty ||
    (await confirm({
      title: 'Discard unsaved readings?',
      message: `You have ${changedRows.length || invalidRows.length} unsaved change(s). They will be lost.`,
      confirmText: 'Discard',
      danger: true,
    }))

  const switchHostel = async (id: ID) => {
    if (!(await guardDirty())) return
    resetDraft()
    setResult(null)
    setPicked(id)
  }
  const switchMonth = async (m: string) => {
    if (!m || !(await guardDirty())) return
    resetDraft()
    setResult(null)
    setMonth(m)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = inputs.current.slice(i + 1).find(Boolean)
    if (next) {
      next.focus()
      next.select()
    } else saveBtn.current?.focus()
  }

  const submit = () => {
    if (!sheet || !hostelId) return
    if (invalidRows.length) {
      const first = rows.indexOf(invalidRows[0]!)
      inputs.current[first]?.focus()
      return toast.error(`${rowName(invalidRows[0]!.row)}: enter units between 0 and ${MAX_UNITS.toLocaleString('en-IN')}`)
    }
    if (!changedRows.length) return toast.info('Nothing to save')
    const readings: ReadingInput[] = changedRows.map((r) => ({
      roomId: r.row.roomId,
      bedId: r.row.bedId,
      units: r.units ?? null,
    }))
    save.mutate(
      { hostelId, month, readings },
      {
        onSuccess: (res) => {
          resetDraft()
          // hostelers whose share waits for the month's bills to be generated
          const pending = new Set(res.rows.filter((r) => r.reading).flatMap((r) => r.occupants.filter((o) => !o.billed).map((o) => o.id))).size
          setResult({ res, pending })
          toast.success(
            `Saved — ${res.billsUpdated} bill${res.billsUpdated === 1 ? '' : 's'} updated${res.warnings.length ? ` · ${res.warnings.length} warning(s)` : ''}`,
          )
        },
      },
    )
  }

  /* ---------------- render ---------------- */

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
    <div className="space-y-4 pb-24">
      {/* ---------------- pickers + rate ---------------- */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,12rem)_1fr] sm:items-end">
          {hostels.length > 1 ? (
            <Field label="Hostel">
              <Select value={hostelId} options={hostels.map((h) => ({ value: h.id, label: h.name }))} onChange={(e) => void switchHostel(e.target.value)} />
            </Field>
          ) : (
            <Field label="Hostel">
              <p className="flex h-10 items-center truncate text-sm font-medium text-slate-900">{hostels[0]!.name}</p>
            </Field>
          )}
          <Field label="Month">
            <Input type="month" value={month} onChange={(e) => void switchMonth(e.target.value)} />
          </Field>
          {sheet && rate > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 font-medium text-amber-900">
                <Zap className="h-4 w-4 text-amber-500" /> {rateText(rate)} per unit ·{' '}
                {basis === 'room' ? 'Meter per room — split equally among the room’s hostelers' : 'Meter per bed'}
              </p>
              <p className="mt-0.5 text-xs">{settingsLink}</p>
            </div>
          )}
        </div>
      </Card>

      {sheetQ.isLoading ? (
        <Card>
          <LoadingState label="Loading readings…" />
        </Card>
      ) : sheetQ.error ? (
        <Card>
          <ErrorState error={sheetQ.error} onRetry={() => void sheetQ.refetch()} />
        </Card>
      ) : !sheet ? null : rate <= 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 p-5">
          <p className="flex items-center gap-2 font-semibold text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Set the electricity rate for {sheet.hostel.name} first
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Electricity is billed as units × rate per unit. Add the rate (₹ per unit) and choose whether each room or each bed has its own meter in the hostel's
            settings.
          </p>
          <div className="mt-3 text-sm">{settingsLink}</div>
        </Card>
      ) : !sheet.rows.length ? (
        <Card>
          <EmptyState icon={<Zap className="h-6 w-6" />} title="No rooms yet" description="Add rooms and beds to this hostel to enter meter readings." />
        </Card>
      ) : (
        <>
          {result && (
            <Card className="border-emerald-200 bg-emerald-50/60 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 font-semibold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4" /> Readings saved for {formatMonth(month)} — {result.res.billsUpdated} bill
                    {result.res.billsUpdated === 1 ? '' : 's'} updated
                  </p>
                  {result.pending > 0 && (
                    <p className="text-emerald-800">
                      {result.pending} hosteler
                      {result.pending === 1 ? ' doesn’t' : 's don’t'} have a bill for {formatMonth(month)} yet — their share is added automatically when the
                      month's bills are generated (Fees → Generate invoices).
                    </p>
                  )}
                  {result.res.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                    </p>
                  ))}
                </div>
                <button type="button" className="shrink-0 text-xs text-emerald-700 hover:underline" onClick={() => setResult(null)}>
                  Dismiss
                </button>
              </div>
            </Card>
          )}

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Enter the units used in {formatMonth(month)} for each {basis === 'room' ? 'room' : 'bed'} (press Enter to jump to the next one). Leave blank or 0 to
            remove a reading. Shares are whole rupees; any extra rupee goes to the first hostelers.
          </p>

          <Card className="overflow-hidden">
            {/* header (desktop) */}
            <div className="hidden grid-cols-[9rem_minmax(0,1fr)_9rem_8rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
              <span>{basis === 'room' ? 'Room' : 'Bed'}</span>
              <span>Hostelers &amp; share</span>
              <span className="text-right">Units</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map((r, idx) => {
                const showFloor = idx === 0 || r.row.floor !== rows[idx - 1]!.row.floor
                const empty = !r.row.occupants.length
                const noOne = !!r.units && empty
                const n = r.row.occupants.length
                return (
                  <div key={r.key}>
                    {showFloor && (
                      <p className="bg-slate-50/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{floorName(r.row.floor)}</p>
                    )}
                    <div
                      className={cn(
                        'grid grid-cols-[minmax(0,1fr)_7.5rem] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[9rem_minmax(0,1fr)_9rem_8rem] md:items-center md:gap-4',
                        r.changed && 'bg-brand-50/40',
                        r.units === undefined && 'bg-red-50/60',
                      )}
                    >
                      {/* room / bed */}
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {basis === 'room' ? `Room ${r.row.roomNumber}` : `${r.row.roomNumber} · ${r.row.bedLabel ?? ''}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          {basis === 'room' ? `${n}/${r.row.beds} bed${r.row.beds === 1 ? '' : 's'} occupied` : empty ? 'Vacant' : 'Occupied'}
                        </p>
                      </div>

                      {/* units (right column on phones, 3rd column on desktop) */}
                      <div className="row-span-2 md:order-3 md:row-span-1">
                        <label className="sr-only" htmlFor={`units-${r.key}`}>
                          Units for {rowName(r.row)}
                        </label>
                        <div className="relative">
                          <Input
                            id={`units-${r.key}`}
                            ref={(el) => {
                              inputs.current[idx] = el
                            }}
                            type="number"
                            inputMode="decimal"
                            enterKeyHint="next"
                            min={0}
                            max={MAX_UNITS}
                            step="any"
                            placeholder="0"
                            value={r.value}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                [r.key]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => onKey(e, idx)}
                            onFocus={(e) => e.target.select()}
                            className={cn('h-11 pr-11 text-right text-base font-semibold tabular-nums', r.units === undefined && 'border-red-400')}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">units</span>
                        </div>
                        <p className="mt-1 text-right text-sm font-semibold tabular-nums text-slate-900 md:hidden">{r.units ? formatMoney(r.amount) : '—'}</p>
                      </div>

                      {/* occupants + shares */}
                      <div className="min-w-0 text-sm md:order-2">
                        {empty ? (
                          <p className="text-xs text-slate-400">Nobody staying</p>
                        ) : r.units && r.shares.length ? (
                          <ul className="space-y-0.5">
                            {r.shares.map((s) => (
                              <li key={s.id} className="flex items-baseline gap-2">
                                <span className="min-w-0 truncate text-slate-700">{s.name}</span>
                                <span className="shrink-0 tabular-nums font-medium text-slate-900">{formatMoney(s.amount)}</span>
                                {!s.billed && <span className="shrink-0 text-[11px] text-slate-400">· bill not generated yet</span>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="truncate text-slate-700">{r.row.occupants.map((o) => o.name).join(', ')}</p>
                        )}
                        {noOne && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Nobody is staying here — this reading won’t be billed to anyone.
                          </p>
                        )}
                        {r.units === undefined && <p className="mt-1 text-xs text-red-600">Enter units between 0 and {MAX_UNITS.toLocaleString('en-IN')}</p>}
                        {r.row.reading && !r.changed && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            Saved
                            {r.row.reading.enteredByName ? ` by ${r.row.reading.enteredByName}` : ''}
                            {r.row.reading.updatedAt ? `, ${formatDateTime(r.row.reading.updatedAt)}` : ''}
                            {r.row.reading.rate !== rate ? ` · at ${rateText(r.row.reading.rate)}/unit` : ''}
                          </p>
                        )}
                        {r.stale && !r.changed && r.units ? (
                          <button
                            type="button"
                            onClick={() => setForced((f) => new Set(f).add(r.key))}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                          >
                            <RotateCcw className="h-3 w-3" /> Rate or hostelers changed — recalculate
                          </button>
                        ) : null}
                        {r.changed && r.units ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {r.units} × {rateText(rate)} = {formatMoney(r.amount)}
                            {n > 1 ? ` · split ${n} ways` : ''}
                          </p>
                        ) : null}
                        {r.changed && !r.units && r.row.reading ? <p className="mt-1 text-xs text-amber-700">Reading will be removed</p> : null}
                      </div>

                      {/* amount (desktop) */}
                      <div className="hidden text-right md:order-4 md:block">
                        <p className="font-semibold tabular-nums text-slate-900">{r.units ? formatMoney(r.amount) : '—'}</p>
                        {r.changed && <Badge tone="blue">Unsaved</Badge>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* totals */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm md:grid-cols-[9rem_minmax(0,1fr)_9rem_8rem]">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="hidden text-slate-500 md:block">
                {filledRows} of {rows.length} {basis === 'room' ? 'rooms' : 'beds'} entered
              </span>
              <span className="hidden text-right font-semibold tabular-nums text-slate-900 md:block">{totals.units.toLocaleString('en-IN')} units</span>
              <span className="text-right font-semibold tabular-nums text-slate-900">
                <span className="md:hidden">{totals.units.toLocaleString('en-IN')} units · </span>
                {formatMoney(totals.amount)}
              </span>
            </div>
          </Card>

          {/* sticky save bar */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm text-slate-600">
                {dirty ? (
                  <>
                    <b className="text-slate-900">{changedRows.length}</b> unsaved change{changedRows.length === 1 ? '' : 's'}
                    {invalidRows.length ? <span className="text-red-600"> · {invalidRows.length} invalid</span> : null}
                  </>
                ) : (
                  'All readings saved'
                )}
              </p>
              <div className="flex shrink-0 gap-2">
                {dirty && (
                  <Button variant="outline" onClick={resetDraft} disabled={save.isPending}>
                    Undo
                  </Button>
                )}
                <Button ref={saveBtn} icon={<Save className="h-4 w-4" />} onClick={submit} loading={save.isPending} disabled={!dirty}>
                  Save readings
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
