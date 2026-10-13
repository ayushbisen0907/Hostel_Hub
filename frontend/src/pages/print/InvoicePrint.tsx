import { useParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { usePrintInvoice } from '@/api/fees'
import { Button, LoadingState } from '@/components/ui'
import { cn, formatDate, formatMoney, formatMonth } from '@/lib/utils'
import { PrintMessage, PrintSheet, PrintToolbar, amountInWords, modeLabel } from '@/pages/admin/_fees'

export default function InvoicePrint() {
  const { id } = useParams<{ id: string }>()
  const query = usePrintInvoice(id)

  if (query.isLoading)
    return (
      <PrintSheet>
        <PrintToolbar title="Invoice" canPrint={false} />
        <LoadingState label="Loading invoice…" />
      </PrintSheet>
    )
  if (query.error || !query.data) {
    const e = query.error
    if (e instanceof ApiError && (e.status === 404 || e.status === 400))
      return <PrintMessage title="Invoice not found" message="This invoice may have been deleted or the link is incorrect." />
    if (e instanceof ApiError && e.status === 403)
      return <PrintMessage title="Not available" message="You don't have access to this invoice." />
    return (
      <PrintMessage
        title="Couldn't load the invoice"
        message={e instanceof Error ? e.message : 'Something went wrong'}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const { invoice: inv, payments: invPayments, organization: org, hostel, hosteler: h } = query.data
  const paid = inv.paidAmount
  const balance = inv.balance
  const status = inv.status
  const stamp =
    status === 'cancelled'
      ? { text: 'CANCELLED', cls: 'border-slate-400 text-slate-400' }
      : status === 'paid'
        ? { text: 'PAID', cls: 'border-emerald-600 text-emerald-600' }
        : { text: status === 'overdue' ? 'OVERDUE' : 'DUE', cls: 'border-red-600 text-red-600' }

  return (
    <PrintSheet>
      <PrintToolbar title={`Invoice ${inv.number}`} />
      <div className="mx-auto my-6 w-full max-w-[210mm] bg-white px-6 py-8 shadow-sm ring-1 ring-slate-200 sm:px-12 sm:py-10 print:my-0 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        {/* Header */}
        <div className="flex flex-col gap-6 border-b-2 border-slate-900 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white print:border print:border-slate-900 print:bg-white print:text-slate-900">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{org?.name ?? 'HostelHub'}</p>
              <p className="font-medium text-slate-700">{hostel?.name ?? '—'}</p>
              {hostel && (
                <p className="mt-0.5 max-w-xs text-sm text-slate-500">
                  {[hostel.address, hostel.city].filter(Boolean).join(', ')}
                  {hostel.phone && <span className="block">Phone: {hostel.phone}</span>}
                </p>
              )}
              {org?.email && <p className="text-sm text-slate-500">{org.email}</p>}
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-extrabold tracking-wide text-slate-900">RENT INVOICE</p>
            <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm sm:justify-end">
              <dt className="text-slate-500">Invoice no.</dt>
              <dd className="font-semibold text-slate-900">{inv.number}</dd>
              <dt className="text-slate-500">Invoice date</dt>
              <dd className="text-slate-800">{formatDate(inv.createdAt.slice(0, 10))}</dd>
              <dt className="text-slate-500">Billing period</dt>
              <dd className="text-slate-800">{formatMonth(inv.month)}</dd>
              <dt className="text-slate-500">Due date</dt>
              <dd className="font-semibold text-slate-900">{formatDate(inv.dueDate)}</dd>
            </dl>
          </div>
        </div>

        {/* Billed to + stamp */}
        <div className="relative mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billed to</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{h?.name ?? 'Hosteler'}</p>
            {h && (
              <div className="text-sm text-slate-600">
                <p>Phone: {h.phone}</p>
                {h.email && <p>{h.email}</p>}
                <p>{h.place}</p>
              </div>
            )}
          </div>
          <div
            className={cn(
              'self-start rounded-lg border-4 px-5 py-1.5 text-2xl font-black tracking-[0.2em] opacity-80 sm:-rotate-6',
              stamp.cls,
            )}
          >
            {stamp.text}
          </div>
        </div>

        {/* Items */}
        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 print:bg-white">
              <th className="w-10 py-2.5 pl-2 font-semibold">#</th>
              <th className="py-2.5 font-semibold">Description</th>
              <th className="py-2.5 pr-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2.5 pl-2 text-slate-500">{i + 1}</td>
                <td className="py-2.5 text-slate-800">{it.label}</td>
                <td className="py-2.5 pr-2 text-right tabular-nums text-slate-900">{formatMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <p className="max-w-xs text-xs italic text-slate-500 sm:pt-2">{amountInWords(inv.total)}</p>
          <dl className="w-full space-y-1.5 text-sm sm:w-72">
            <div className="flex justify-between">
              <dt className="text-slate-600">Total</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatMoney(inv.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Paid</dt>
              <dd className="tabular-nums text-emerald-700">− {formatMoney(Math.min(paid, inv.total))}</dd>
            </div>
            <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-base">
              <dt className="font-bold text-slate-900">Balance due</dt>
              <dd className={cn('font-bold tabular-nums', balance > 0 ? 'text-red-600' : 'text-slate-900')}>{formatMoney(balance)}</dd>
            </div>
          </dl>
        </div>

        {/* Payments */}
        {invPayments.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payments received</p>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-1.5 font-medium">Receipt</th>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 font-medium">Mode</th>
                  <th className="hidden py-1.5 font-medium sm:table-cell print:table-cell">Reference</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invPayments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-800">{p.receiptNo}</td>
                    <td className="py-1.5 text-slate-600">{formatDate(p.date)}</td>
                    <td className="py-1.5 text-slate-600">{modeLabel(p.mode)}</td>
                    <td className="hidden py-1.5 text-slate-500 sm:table-cell print:table-cell">{p.reference || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-900">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Instructions */}
        {balance > 0 && (
          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm print:bg-white">
            <p className="font-semibold text-slate-900">How to pay</p>
            <ul className="mt-1.5 space-y-1 text-slate-600">
              <li>
                • Online: from the resident portal (Fees → Pay now) — or quote invoice{' '}
                <span className="font-medium text-slate-800">{inv.number}</span> when paying by UPI / bank transfer.
              </li>
              <li>• Cash / card at the hostel office between 10:00 AM and 7:00 PM.</li>
              <li>• Payments after the due date may attract a late fee as per hostel policy.</li>
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 flex flex-col gap-6 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row sm:items-end sm:justify-between">
          <p>
            Thank you for staying with {hostel?.name ?? org?.name ?? 'us'}.
            <br />
            This is a computer-generated invoice.
          </p>
          <div className="text-center">
            <div className="mb-1 h-10 w-44 border-b border-slate-400" />
            Authorised signatory
          </div>
        </div>
      </div>
    </PrintSheet>
  )
}
