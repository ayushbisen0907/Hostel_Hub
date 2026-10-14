import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, LogOut, Plus, Printer, Trash2, UserMinus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg, useScope } from '@/api/common'
import { useApiMutation } from '@/api/query'
import { useCan } from '@/api/session'
import { useInvoices } from '@/api/fees'
import { HOSTELER_INVALIDATE, hostelersApi, useHosteler, useHostelers, type HostelerDetail, type Settlement } from '@/api/hostelers'
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

/* ------------------------------------------------------------------ */
/* Printable summary                                                   */
/* ------------------------------------------------------------------ */

function SettlementSummary({ r, orgName, onDone }: { r: Result; orgName: string; onDone: () => void }) {
  const s = r.s
  return (
    <>
      <div className="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">{s.name} has been checked out</h1>
            <p className="text-sm text-slate-500">The bed is now vacant and the portal account is closed. Print the settlement for your records.</p>
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
      <Card className="mx-auto max-w-2xl p-6 print:border-0 print:shadow-none sm:p-8">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold text-slate-900">{orgName}</p>
            <p className="text-sm text-slate-500">{r.hostel}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">Checkout settlement</p>
            <p className="text-xs text-slate-500">{formatDate(s.checkOut)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-slate-200 py-4 text-sm">
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
              {formatDate(s.checkIn)} – {formatDate(s.checkOut)} ({s.days} days)
            </p>
          </div>
        </div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-1.5 text-slate-600">Security deposit held</td>
              <td className="py-1.5 text-right font-medium">{formatMoney(s.held)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-slate-600">
                Outstanding dues{s.adjusted > 0 && ` (${formatMoney(s.adjusted)} adjusted from deposit)`}
              </td>
              <td className="py-1.5 text-right font-medium text-red-600">− {formatMoney(s.dues)}</td>
            </tr>
            {s.deductions.map((d, i) => (
              <tr key={i}>
                <td className="py-1.5 text-slate-600">{d.label}</td>
                <td className="py-1.5 text-right font-medium text-red-600">− {formatMoney(d.amount)}</td>
              </tr>
            ))}
            {s.deductions.length > 1 && (
              <tr>
                <td className="py-1.5 text-xs text-slate-500">Total deductions</td>
                <td className="py-1.5 text-right text-xs text-slate-500">{formatMoney(s.totalDeductions)}</td>
              </tr>
            )}
            <tr className="border-t-2 border-slate-900">
              <td className="pt-3 font-semibold text-slate-900">{s.toCollect > 0 ? 'Amount to collect from resident' : 'Refund to resident'}</td>
              <td className={cn('pt-3 text-right text-lg font-bold', s.toCollect > 0 ? 'text-red-600' : 'text-emerald-700')}>
                {formatMoney(s.toCollect > 0 ? s.toCollect : s.refund)}
              </td>
            </tr>
          </tbody>
        </table>
        {s.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{s.notes}</p>}
        <div className="mt-4 text-xs text-slate-500">Keys, ID card returned and room inspected.</div>
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

function ChooseResident({ onSelect, notice }: { onSelect: (id: ID) => void; notice?: string }) {
  const scope = useScope()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebounced(q.trim(), 300)
  useEffect(() => setPage(1), [term, scope])
  const list = useHostelers({ status: 'active', hostelId: scope, q: term || undefined, page, limit: 30 })
  const items = list.data?.items ?? []
  return (
    <>
      <PageHeader title="Check-out" subtitle="Settle dues and deposit, then free up the bed." />
      {notice && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</p>}
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
  const q = useHosteler(selectedId || null)

  const select = (id: ID | null) => {
    setResult(null)
    setParams(id ? { h: id } : {}, { replace: false })
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

  if (!selectedId) return <ChooseResident onSelect={select} />
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

function SettlementForm({ h, onBack, onDone }: { h: HostelerDetail; onBack: () => void; onDone: (r: Result) => void }) {
  const can = useCan()
  const qc = useQueryClient()
  const canFees = can('fees')
  const invoicesQ = useInvoices({ hostelerId: h.id, limit: 500 }, { enabled: canFees })

  const [date, setDate] = useState(today())
  const [held, setHeld] = useState(String(h.depositCollected || h.securityDeposit))
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [adjust, setAdjust] = useState(true)
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({ keys: false, idcard: false, inspected: false })

  const checkOut = useApiMutation(hostelersApi.checkOut, {
    // the profile query is refreshed after the summary is shown (else this form would unmount first)
    invalidate: [...HOSTELER_INVALIDATE.filter((k) => k[0] !== 'hosteler'), ['dues'], ['deposits'], ['attendance']],
    success: (r) => `${r.settlement.name} checked out`,
    onSuccess: (r) => {
      onDone({ s: r.settlement, phone: h.phone, hostel: h.hostelName ?? '' })
      window.scrollTo({ top: 0 })
      void qc.invalidateQueries({ queryKey: ['hosteler'] })
    },
  })

  const unpaid = useMemo(
    () => (invoicesQ.data?.items ?? []).filter((i) => i.status !== 'cancelled' && i.balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoicesQ.data],
  )
  const dues = h.dues
  const heldNum = Math.max(0, Math.round(Number(held) || 0))
  const deductionLines = deductions
    .map((d) => ({ label: d.label.trim() || 'Deduction', amount: Math.max(0, Math.round(Number(d.amount) || 0)) }))
    .filter((d) => d.amount > 0)
  const totalDeductions = deductionLines.reduce((a, d) => a + d.amount, 0)
  const balance = heldNum - dues - totalDeductions
  const refund = Math.max(balance, 0)
  const toCollect = Math.max(-balance, 0)
  const adjustable = Math.min(dues, heldNum)
  const days = Math.max(daysBetween(h.checkInDate, date || today()), 0)
  const allChecked = CHECKLIST.every((c) => checks[c.key])
  const bed = bedText(h)

  const submit = async () => {
    if (!date) return toast.error('Choose the checkout date')
    if (date < h.checkInDate) return toast.error('Checkout date cannot be before check-in')
    if (!allChecked) return toast.error('Complete the checkout checklist first')
    const ok = await confirm({
      title: `Check out ${h.name}?`,
      message: `${bed} will be freed and the portal account closed. ${toCollect > 0 ? `Collect ${formatMoney(toCollect)} from the resident.` : `Refund ${formatMoney(refund)} to the resident.`}`,
      confirmText: 'Check out',
      danger: true,
    })
    if (!ok) return
    checkOut.mutate({
      id: h.id,
      date,
      deductions: deductionLines,
      adjustDuesFromDeposit: adjust,
      depositHeld: heldNum,
      note: notes.trim(),
    })
  }

  return (
    <>
      <PageHeader
        title="Check-out"
        subtitle="Settle dues and deposit, then free up the bed."
        actions={
          <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} disabled={checkOut.isPending}>
            Choose another
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
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
                <p className="text-xs text-slate-500">Days stayed</p>
                <p className="font-medium text-slate-900">{days}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Monthly rent</p>
                <p className="font-medium text-slate-900">{formatMoney(h.monthlyRent)}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Outstanding dues"
              subtitle={dues > 0 ? (canFees && invoicesQ.data ? `${unpaid.length} unpaid invoice(s)` : 'Unpaid invoices') : 'All invoices are paid'}
              action={<span className={cn('text-lg font-bold', dues > 0 ? 'text-red-600' : 'text-emerald-600')}>{formatMoney(dues)}</span>}
            />
            {dues > 0 && (
              <>
                {canFees &&
                  (invoicesQ.isLoading ? (
                    <LoadingState className="py-8" />
                  ) : invoicesQ.error ? (
                    <ErrorState error={invoicesQ.error} onRetry={() => void invoicesQ.refetch()} className="py-8" />
                  ) : (
                    unpaid.length > 0 && (
                      <Table>
                        <THead>
                          <tr>
                            <TH>Invoice</TH>
                            <TH>Month</TH>
                            <TH>Due</TH>
                            <TH className="text-right">Balance</TH>
                          </tr>
                        </THead>
                        <tbody>
                          {unpaid.map((inv) => (
                            <TR key={inv.id}>
                              <TD className="font-medium text-slate-900">{inv.number}</TD>
                              <TD>{billPeriod(inv)}</TD>
                              <TD className="whitespace-nowrap">{formatDate(inv.dueDate)}</TD>
                              <TD className="text-right font-medium text-red-600">{formatMoney(inv.balance)}</TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    )
                  ))}
                <div className="border-t border-slate-100 px-5 py-3">
                  <Switch
                    checked={adjust}
                    onChange={setAdjust}
                    label={`Adjust dues against deposit (records ${formatMoney(adjustable)} as cash payments)`}
                  />
                  {!adjust && <p className="mt-1 text-xs text-slate-500">Dues stay open in Fees and are still subtracted in this settlement.</p>}
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Deductions"
              subtitle="Damages, cleaning, lost keys…"
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
                    placeholder="Amount"
                    className="w-32 shrink-0"
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
            <h3 className="mb-4 font-semibold text-slate-900">Settlement</h3>
            <Field label="Security deposit held" hint={`Agreed ${formatMoney(h.securityDeposit)} · collected ${formatMoney(h.depositCollected)}`}>
              <Input type="number" min={0} value={held} onChange={(e) => setHeld(e.target.value)} />
            </Field>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Deposit</dt>
                <dd className="font-medium">{formatMoney(heldNum)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Dues</dt>
                <dd className="font-medium text-red-600">− {formatMoney(dues)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Deductions</dt>
                <dd className="font-medium text-red-600">− {formatMoney(totalDeductions)}</dd>
              </div>
              <div className={cn('flex justify-between rounded-lg px-3 py-3', toCollect > 0 ? 'bg-red-50' : 'bg-emerald-50')}>
                <dt className={cn('font-semibold', toCollect > 0 ? 'text-red-800' : 'text-emerald-800')}>{toCollect > 0 ? 'Amount to collect' : 'Refund'}</dt>
                <dd className={cn('text-lg font-bold', toCollect > 0 ? 'text-red-700' : 'text-emerald-700')}>{formatMoney(toCollect > 0 ? toCollect : refund)}</dd>
              </div>
            </dl>
            <Field label="Checkout date" className="mt-4">
              <Input type="date" value={date} min={h.checkInDate} onChange={(e) => setDate(e.target.value)} />
            </Field>
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
              disabled={!allChecked}
              loading={checkOut.isPending}
              onClick={() => void submit()}
            >
              Complete check-out
            </Button>
            {!allChecked && <p className="mt-2 text-center text-xs text-slate-500">Tick every checklist item to continue.</p>}
          </Card>
        </div>
      </div>
      <RecentCheckouts />
    </>
  )
}
