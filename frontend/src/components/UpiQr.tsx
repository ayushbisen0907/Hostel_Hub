import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { fetchFileUrl } from '@/api/client'
import { cn } from '@/lib/utils'

/** upi://pay link understood by GPay, PhonePe, Paytm, BHIM… */
export function upiPayLink(opts: { upiId: string; payeeName: string; amount?: number; note?: string }) {
  const params = new URLSearchParams({ pa: opts.upiId, pn: opts.payeeName, cu: 'INR' })
  if (opts.amount && opts.amount > 0) params.set('am', String(Math.round(opts.amount)))
  if (opts.note) params.set('tn', opts.note.slice(0, 50))
  return `upi://pay?${params.toString()}`
}

/**
 * Shows the hostel's uploaded QR image (fetched with auth from `qrUrl`) or,
 * when there is none, a QR generated from the UPI ID (+ amount if given).
 */
export function UpiQr({
  upiId,
  payeeName,
  amount,
  note,
  qrUrl,
  className,
}: {
  upiId: string
  payeeName: string
  amount?: number
  note?: string
  /** API path of an uploaded QR image, e.g. /portal/payment-qr — omit to generate */
  qrUrl?: string | null
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setFailed(false)
    const generate = () =>
      QRCode.toDataURL(upiPayLink({ upiId, payeeName, amount, note }), { margin: 1, width: 320, errorCorrectionLevel: 'M' })
        .then((d) => !cancelled && setSrc(d))
        .catch(() => !cancelled && setFailed(true))
    if (qrUrl) {
      fetchFileUrl(qrUrl)
        .then((u) => {
          objectUrl = u
          if (!cancelled) setSrc(u)
        })
        .catch(() => void generate()) // fall back to a generated QR
    } else if (upiId) {
      void generate()
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [upiId, payeeName, amount, note, qrUrl])

  if (!upiId && !qrUrl) return null
  return (
    <div className={cn('flex h-48 w-48 items-center justify-center rounded-xl border border-slate-200 bg-white p-2', className)}>
      {src ? (
        <img src={src} alt={`UPI QR code for ${payeeName || upiId}`} className="h-full w-full object-contain" />
      ) : failed ? (
        <span className="px-3 text-center text-xs text-slate-500">QR not available. Use the UPI ID instead.</span>
      ) : (
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      )}
    </div>
  )
}
