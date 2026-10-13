/**
 * Add / edit hostel modal (Settings → Hostels): basics, the UPI ID where
 * hostelers pay rent (+ optional QR image) and the monthly charge heads.
 */
import { useEffect, useState } from 'react'
import { QrCode, Receipt, Trash2, Upload } from 'lucide-react'
import { errorMessage } from '@/api/client'
import { hostelQrUrl, useCreateHostel, useRemoveHostelQr, useUpdateHostel, useUploadHostelQr, type HostelInput } from '@/api/hostels'
import type { Hostel, HostelCharges, HostelType } from '@/api/types'
import { Badge, Button, Field, FileDrop, Input, Modal, Select, Textarea, confirm, toast } from '@/components/ui'
import { UpiQr } from '@/components/UpiQr'
import { FIXED_CHARGES, INCLUDED_IN_RENT, UPI_ID_RE, configuredCharges } from '@/lib/charges'
import { cn, formatMoney } from '@/lib/utils'

export const HOSTEL_TYPES: { value: HostelType; label: string }[] = [
  { value: 'boys', label: 'Boys' },
  { value: 'girls', label: 'Girls' },
  { value: 'coed', label: 'Co-ed' },
]

interface HostelForm {
  name: string
  type: HostelType
  address: string
  city: string
  phone: string
  code: string
  upiId: string
  payeeName: string
}
const blankHostel: HostelForm = { name: '', type: 'boys', address: '', city: '', phone: '', code: '', upiId: '', payeeName: '' }

type FixedKey = (typeof FIXED_CHARGES)[number]['key']
type ChargeDraft = Record<'mess' | FixedKey, string>
const QR_MAX = 2 * 1024 * 1024
const MAX_CHARGE = 1_000_000

function chargeDraft(c: HostelCharges | undefined): ChargeDraft {
  const v = (n: number | undefined) => (n && n > 0 ? String(n) : '')
  return { mess: v(c?.mess), electricity: v(c?.electricity) }
}

/** Configured monthly charges as small chips (hostel cards). */
export function HostelChargeChips({ charges }: { charges: HostelCharges | undefined }) {
  const list = configuredCharges(charges)
  if (!list.length) return <p className="mt-3 text-xs text-slate-500">Monthly bill: room rent only (no extra charges set)</p>
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {list.map((x, i) => (
        <Badge key={i}>
          {x.label}: {formatMoney(x.amount)}
        </Badge>
      ))}
    </div>
  )
}

function AmountInput({ value, onChange, className, label }: { value: string; onChange: (v: string) => void; className?: string; label?: string }) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value}
        placeholder="0"
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7 text-right"
      />
    </div>
  )
}

type Errors = Partial<Record<keyof HostelForm | 'charges' | 'qr', string>>

export function HostelModal({ editing, onClose }: { editing: Hostel | null; onClose: () => void }) {
  const [form, setForm] = useState<HostelForm>(
    editing
      ? {
          name: editing.name,
          type: editing.type,
          address: editing.address,
          city: editing.city,
          phone: editing.phone,
          code: editing.code,
          upiId: editing.upiId ?? '',
          payeeName: editing.payeeName ?? '',
        }
      : blankHostel,
  )
  const [charges, setCharges] = useState<ChargeDraft>(() => chargeDraft(editing?.charges))
  const [errors, setErrors] = useState<Errors>({})
  const [apiError, setApiError] = useState('')
  // QR: for a new hostel the file is uploaded right after the hostel is created;
  // when editing it is uploaded / removed immediately.
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [hasQr, setHasQr] = useState(!!editing?.hasQr)
  const [qrVersion, setQrVersion] = useState(0)
  const [savingQr, setSavingQr] = useState(false)

  const create = useCreateHostel()
  const update = useUpdateHostel(onClose)
  const uploadQr = useUploadHostelQr()
  const removeQr = useRemoveHostelQr()
  const pending = create.isPending || update.isPending || savingQr
  const qrBusy = uploadQr.isPending || removeQr.isPending
  const codeLocked = !!editing && editing.hostelerSeq > 0
  const upiId = form.upiId.trim()
  const payeeName = form.payeeName.trim()
  const upiValid = UPI_ID_RE.test(upiId)

  useEffect(() => {
    if (!qrFile) {
      setQrPreview(null)
      return
    }
    const url = URL.createObjectURL(qrFile)
    setQrPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [qrFile])

  const setErr = (k: keyof Errors, v: string | undefined) => setErrors((e) => ({ ...e, [k]: v }))

  const pickQr = (files: File[]) => {
    const f = files[0]
    if (!f) return
    if (!f.type.startsWith('image/')) return setErr('qr', 'Choose an image (JPG, PNG or WEBP).')
    if (f.size > QR_MAX) return setErr('qr', 'The QR image must be 2 MB or smaller.')
    setErr('qr', undefined)
    if (!editing) return setQrFile(f)
    uploadQr.mutate(
      { id: editing.id, file: f },
      {
        onSuccess: () => {
          setHasQr(true)
          setQrVersion((v) => v + 1)
          toast.success('QR image uploaded')
        },
        onError: (err) => setErr('qr', errorMessage(err)),
      },
    )
  }

  const dropQr = async () => {
    if (!editing) return setQrFile(null)
    const ok = await confirm({
      title: 'Remove the QR image?',
      message: 'Hostelers will see a QR code generated from the UPI ID instead.',
      confirmText: 'Remove',
      danger: true,
    })
    if (!ok) return
    removeQr.mutate(editing.id, {
      onSuccess: () => {
        setHasQr(false)
        toast.success('QR image removed')
      },
      onError: (err) => setErr('qr', errorMessage(err)),
    })
  }

  /** Parsed charges, or an error message. */
  const buildCharges = (): HostelCharges | string => {
    const parse = (v: string): number | null => {
      if (!v.trim()) return 0
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 && n <= MAX_CHARGE ? Math.round(n) : null
    }
    const mess = parse(charges.mess)
    if (mess === null) return 'Enter a valid amount for mess.'
    const out: HostelCharges = { mess, electricity: 0, water: 0, internet: 0, laundry: 0, maintenance: 0, others: [] }
    for (const f of FIXED_CHARGES) {
      const n = parse(charges[f.key])
      if (n === null) return `Enter a valid amount for ${f.label.toLowerCase()}.`
      out[f.key] = n
    }
    return out
  }

  const save = () => {
    const e: Errors = {}
    if (form.name.trim().length < 2) e.name = 'Enter a hostel name.'
    if (!form.city.trim()) e.city = 'Enter the city.'
    const code = form.code.trim().toUpperCase()
    if (code && !/^[A-Z0-9]{2,8}$/.test(code)) e.code = '2–8 letters or numbers, e.g. SBH'
    if (editing && !code) e.code = 'The prefix cannot be empty.'
    if (!upiId) e.upiId = 'Enter the UPI ID where hostelers pay rent.'
    else if (!upiValid) e.upiId = 'Enter a valid UPI ID, e.g. name@okhdfc'
    if (payeeName.length < 2) e.payeeName = 'Enter the name shown on the UPI account.'
    const built = buildCharges()
    if (typeof built === 'string') e.charges = built
    setErrors((prev) => ({ ...e, qr: prev.qr }))
    setApiError('')
    if (Object.keys(e).length || typeof built === 'string') return

    const body: HostelInput = {
      name: form.name.trim(),
      type: form.type,
      city: form.city.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      upiId,
      payeeName,
      charges: built,
    }
    const onError = (err: unknown) => setApiError(errorMessage(err))
    if (editing) {
      update.mutate({ id: editing.id, ...body, ...(!codeLocked && code !== editing.code ? { code } : {}) }, { onError })
      return
    }
    create.mutate(
      { ...body, ...(code ? { code } : {}) },
      {
        onError,
        onSuccess: (h) => {
          if (!qrFile) return onClose()
          setSavingQr(true)
          uploadQr.mutate(
            { id: h.id, file: qrFile },
            {
              onError: (err) => toast.error(`Hostel added, but the QR image couldn't be uploaded (${errorMessage(err)}). Edit the hostel to try again.`),
              onSettled: () => {
                setSavingQr(false)
                onClose()
              },
            },
          )
        },
      },
    )
  }

  const showUploaded = !!editing && hasQr
  const hasImage = !!qrPreview || showUploaded

  return (
    <Modal
      open
      size="lg"
      onClose={() => !pending && onClose()}
      title={editing ? 'Edit hostel' : 'Add hostel'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {editing ? 'Save changes' : 'Add hostel'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {apiError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{apiError}</p>}
        <Field label="Hostel name" required error={errors.name} className="sm:col-span-2">
          <Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sunrise Boys Hostel" autoFocus />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as HostelType })} options={HOSTEL_TYPES} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea rows={2} maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="City" required error={errors.city}>
          <Input value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field
          label="Hosteler ID prefix"
          error={errors.code}
          hint={
            codeLocked
              ? `Locked: ${editing!.hostelerSeq} IDs already issued (${editing!.code}-0001…)`
              : `Hosteler IDs will look like ${form.code.trim().toUpperCase() || 'auto'}-0001.${editing ? '' : ' Leave blank to auto-generate.'}`
          }
        >
          <Input
            value={form.code}
            maxLength={8}
            disabled={codeLocked}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
            placeholder="e.g. SBH"
            className="font-mono uppercase"
          />
        </Field>

        {/* ---------------- Rent payment (UPI) ---------------- */}
        <div className="border-t border-slate-100 pt-4 sm:col-span-2">
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            <QrCode className="h-4 w-4 text-brand-600" /> Rent payment (UPI)
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            Hostelers pay this UPI ID from any UPI app, then report the transaction ID in the app. You verify it against your bank.
          </p>
        </div>
        <Field label="UPI ID" required error={errors.upiId} hint={errors.upiId ? undefined : 'e.g. sunrisehostel@okhdfc'}>
          <Input
            value={form.upiId}
            maxLength={320}
            onChange={(e) => setForm({ ...form, upiId: e.target.value.replace(/\s/g, '') })}
            placeholder="name@bank"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field label="Payee name" required error={errors.payeeName} hint={errors.payeeName ? undefined : 'Name shown on the UPI account'}>
          <Input value={form.payeeName} maxLength={80} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} placeholder="e.g. Sunrise Hostel" />
        </Field>

        <div className="flex flex-col items-center gap-4 sm:col-span-2 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col items-center gap-1">
            {qrPreview ? (
              <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-slate-200 bg-white p-2">
                <img src={qrPreview} alt="Chosen UPI QR code" className="h-full w-full object-contain" />
              </div>
            ) : showUploaded ? (
              <UpiQr key={qrVersion} upiId={upiId} payeeName={payeeName} qrUrl={hostelQrUrl(editing!.id)} className="h-40 w-40" />
            ) : upiValid ? (
              <UpiQr upiId={upiId} payeeName={payeeName || upiId} className="h-40 w-40" />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-center text-xs text-slate-500">
                Enter a valid UPI ID to preview the QR code
              </div>
            )}
            <span className="text-xs text-slate-500">{hasImage ? 'Your QR image' : 'Generated from the UPI ID'}</span>
          </div>
          <div className="w-full min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium text-slate-700">QR code image (optional)</p>
            <p className="text-xs text-slate-500">
              Upload the QR from your bank or UPI app. Without one, hostelers see a QR generated from the UPI ID.
              {!editing && qrFile ? ' It is uploaded when you add the hostel.' : ''}
            </p>
            {hasImage ? (
              <div className="flex flex-wrap gap-2">
                <label className={cn('inline-flex', qrBusy && 'pointer-events-none opacity-60')}>
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      pickQr(Array.from(e.target.files ?? []))
                      e.target.value = ''
                    }}
                  />
                  <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" /> {uploadQr.isPending ? 'Uploading…' : 'Replace'}
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  loading={removeQr.isPending}
                  disabled={qrBusy || pending}
                  onClick={() => void dropQr()}
                >
                  Remove
                </Button>
              </div>
            ) : uploadQr.isPending ? (
              <p className="text-sm text-slate-500">Uploading…</p>
            ) : (
              <FileDrop accept="image/*" onFiles={pickQr} label="Upload QR image" hint="JPG, PNG or WEBP · up to 2 MB" />
            )}
            {errors.qr && <p className="text-xs text-red-600">{errors.qr}</p>}
          </div>
        </div>

        {/* ---------------- Monthly charges ---------------- */}
        <div className="border-t border-slate-100 pt-4 sm:col-span-2">
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            <Receipt className="h-4 w-4 text-brand-600" /> Monthly charges besides rent (optional)
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            Room rent (set per room) already includes {INCLUDED_IN_RENT}. Only mess and electricity are billed separately. Leave blank if you don't charge them.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field label="Mess" hint="Mess members only">
            <AmountInput label="Mess" value={charges.mess} onChange={(v) => setCharges({ ...charges, mess: v })} />
          </Field>
          {FIXED_CHARGES.map((f) => (
            <Field key={f.key} label={f.label}>
              <AmountInput label={f.label} value={charges[f.key]} onChange={(v) => setCharges({ ...charges, [f.key]: v })} />
            </Field>
          ))}
        </div>
        {errors.charges && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{errors.charges}</p>}
      </div>
    </Modal>
  )
}
