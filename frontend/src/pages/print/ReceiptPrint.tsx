import { useParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { usePrintReceipt } from '@/api/fees'
import { Button, LoadingState } from '@/components/ui'
import { formatDate, formatMoney, formatMonth } from '@/lib/utils'
import { PrintMessage, PrintSheet, PrintToolbar, amountInWords, isDeposit, modeLabel } from '@/pages/admin/_fees'

export default function ReceiptPrint() {
  const { id } = useParams<{ id: string }>()
  const query = usePrintReceipt(id)

  if (query.isLoading)
    return (
      <PrintSheet>
        <PrintToolbar title="Receipt" canPrint={false} />
        <LoadingState label="Loading receipt…" />
      </PrintSheet>
    )
  if (query.error || !query.data) {
    const e = query.error
    if (e instanceof ApiError && (e.status === 404 || e.status === 400))
      return <PrintMessage title="Receipt not found" message="This payment may have been deleted or the link is incorrect." />
    if (e instanceof ApiError && e.status === 403)
      return <PrintMessage title="Not available" message="You don't have access to this receipt." />
    return (
      <PrintMessage
        title="Couldn't load the receipt"
        message={e instanceof Error ? e.message : 'Something went wrong'}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const { payment: p, invoice: inv, organization: org, hostel, hosteler: h } = query.data
  const against = inv
    ? `${isDeposit(p) ? 'Security deposit · ' : ''}Invoice ${inv.number} · ${formatMonth(inv.month)}`
    : isDeposit(p)
      ? 'Security deposit'
      : p.invoiceId
        ? 'Invoice (deleted)'
        : p.note && p.note !== 'Advance'
          ? `Advance payment · ${p.note}`
          : 'Advance payment'

  const rows: { label: string; value: string }[] = [
    { label: 'Received from', value: h ? `${h.name}${h.phone ? ` (${h.phone})` : ''}` : 'Hosteler' },
    { label: 'Room / bed', value: h?.place ?? '—' },
    { label: 'Towards', value: against },
    { label: 'Payment mode', value: modeLabel(p.mode) },
    { label: 'Reference', value: p.reference || '—' },
  ]
  if (p.recordedBy === 'hosteler') rows.push({ label: 'Paid via', value: 'UPI (reported by the resident, verified by the hostel)' })

  return (
    <PrintSheet>
      <PrintToolbar title={`Receipt ${p.receiptNo}`} />
      <div className="mx-auto my-6 w-full max-w-[210mm] bg-white px-6 py-8 shadow-sm ring-1 ring-slate-200 sm:px-12 sm:py-10 print:my-0 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <div className="rounded-2xl border-2 border-slate-900 p-6 sm:p-8">
          {/* Header */}
          <div className="flex flex-col gap-4 border-b border-dashed border-slate-300 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white print:border print:border-slate-900 print:bg-white print:text-slate-900">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">{hostel?.name ?? org?.name ?? 'HostelHub'}</p>
                {hostel && org?.name && <p className="text-sm font-medium text-slate-600">{org.name}</p>}
                {hostel && (
                  <p className="max-w-xs text-sm text-slate-500">
                    {[hostel.address, hostel.city].filter(Boolean).join(', ')}
                    {hostel.phone && <span className="block">Phone: {hostel.phone}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="sm:text-right">
              <p className="inline-block rounded-md bg-slate-900 px-3 py-1 text-sm font-bold tracking-[0.2em] text-white print:border print:border-slate-900 print:bg-white print:text-slate-900">
                PAYMENT RECEIPT
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Receipt no. <span className="font-semibold text-slate-900">{p.receiptNo}</span>
              </p>
              <p className="text-sm text-slate-500">
                Date <span className="font-semibold text-slate-900">{formatDate(p.date)}</span>
              </p>
            </div>
          </div>

          {/* Amount */}
          <div className="mt-6 flex flex-col gap-4 rounded-xl bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between print:border print:border-slate-300 print:bg-white">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Amount received</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900">{formatMoney(p.amount)}</p>
            </div>
            <p className="max-w-sm text-sm font-medium italic text-slate-700 sm:text-right">{amountInWords(p.amount)}</p>
          </div>

          {/* Details */}
          <dl className="mt-6 divide-y divide-slate-100 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
                <dt className="w-40 shrink-0 text-slate-500">{r.label}</dt>
                <dd className="font-medium text-slate-900">{r.value}</dd>
              </div>
            ))}
          </dl>

          {/* Signature */}
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-xs text-slate-500">
              Received with thanks.
              {isDeposit(p) && (
                <span className="block">Security deposit is refundable at checkout, subject to deductions as per hostel policy.</span>
              )}
            </p>
            <div className="text-center text-xs text-slate-500">
              <div className="mb-1 h-10 w-48 border-b border-slate-400" />
              Authorised signatory
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          This is a computer-generated receipt and does not require a physical signature.
        </p>
      </div>
    </PrintSheet>
  )
}
