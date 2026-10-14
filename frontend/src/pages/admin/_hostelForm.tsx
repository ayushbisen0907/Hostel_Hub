/**
 * Add / edit hostel modal (Settings → Hostels): basics, the UPI ID where
 * hostelers pay rent (+ optional QR image), the monthly charge heads and the
 * stay rules (notice period, deposit refund rule, rules hostelers sign).
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, QrCode, Receipt, ScrollText, ShieldCheck, Sparkles, Trash2, Upload, Wallet, Zap } from 'lucide-react'
import { errorMessage } from '@/api/client'
import { hostelQrUrl, hostelsApi, useCreateHostel, useRemoveHostelQr, useUpdateHostel, useUploadHostelQr, type HostelInput } from '@/api/hostels'
import type { Hostel, HostelCharges, HostelType } from '@/api/types'
import { Badge, Button, Field, FileDrop, Input, Modal, Select, Textarea, confirm, toast } from '@/components/ui'
import { UpiQr } from '@/components/UpiQr'
import { INCLUDED_IN_RENT, UPI_ID_RE, configuredCharges, type ElectricityBasis } from '@/lib/charges'
import { cn } from '@/lib/utils'

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
const blankHostel: HostelForm = {
  name: '',
  type: 'boys',
  address: '',
  city: '',
  phone: '',
  code: '',
  upiId: '',
  payeeName: '',
}

interface ChargeDraft {
  mess: string
  /** ₹ per unit */
  electricityRate: string
  electricityBasis: ElectricityBasis | ''
}
const QR_MAX = 2 * 1024 * 1024
const RULES_MAX = 10_000
const MAX_NOTICE_DAYS = 90

const DEPOSIT_STAY_OPTIONS = [
  { value: '0', label: 'Always (no minimum stay)' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `After ${i + 1} month${i ? 's' : ''} of stay` })),
]

function depositRuleText(months: number | undefined): string {
  return months && months > 0 ? `Deposit refundable after ${months} month${months === 1 ? '' : 's'}` : 'Deposit always refundable'
}

/** Notice period, deposit rule and rules version as chips (hostel cards). */
export function HostelStayChips({ hostel }: { hostel: Hostel }) {
  const notice = hostel.noticePeriodDays ?? 30
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Badge tone="violet">
        <CalendarClock className="mr-1 inline h-3 w-3" />
        {notice > 0 ? `${notice} days notice` : 'No notice period'}
      </Badge>
      <Badge tone="violet">
        <Wallet className="mr-1 inline h-3 w-3" />
        {depositRuleText(hostel.depositMinStayMonths)}
      </Badge>
      {hostel.rulesText && hostel.rulesVersion > 0 ? (
        <Badge tone="green">
          <ScrollText className="mr-1 inline h-3 w-3" />
          Rules v{hostel.rulesVersion}
        </Badge>
      ) : (
        <Badge tone="amber">
          <ScrollText className="mr-1 inline h-3 w-3" />
          No rules yet
        </Badge>
      )}
    </div>
  )
}
const MAX_CHARGE = 1_000_000
const MAX_UNIT_RATE = 1000

function chargeDraft(h: Hostel | null): ChargeDraft {
  const v = (n: number | undefined) => (n && n > 0 ? String(n) : '')
  return {
    mess: v(h?.charges?.mess),
    electricityRate: v(h?.electricityRate),
    electricityBasis: h && h.electricityRate > 0 ? (h.electricityBasis ?? 'room') : '',
  }
}

/** Configured charges besides rent as small chips (hostel cards). */
export function HostelChargeChips({ hostel }: { hostel: Hostel }) {
  const list = configuredCharges(hostel)
  if (!list.length) return <p className="mt-3 text-xs text-slate-500">Monthly bill: room rent only (no extra charges set)</p>
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {list.map((x, i) => (
        <Badge key={i}>
          {x.label} {x.value}
        </Badge>
      ))}
    </div>
  )
}

const BASIS_CHOICES: {
  value: ElectricityBasis
  title: string
  hint: string
}[] = [
  {
    value: 'room',
    title: 'Meter per room',
    hint: "Bill shared among the room's hostelers by days stayed",
  },
  {
    value: 'bed',
    title: 'Meter per bed',
    hint: 'Each bed has its own meter; that hosteler pays all of it',
  },
]

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

type Errors = Partial<Record<keyof HostelForm | 'charges' | 'electricityRate' | 'electricityBasis' | 'qr' | 'noticePeriodDays' | 'rulesText', string>>

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
  const [charges, setCharges] = useState<ChargeDraft>(() => chargeDraft(editing))
  const [errors, setErrors] = useState<Errors>({})
  const [apiError, setApiError] = useState('')
  // QR: for a new hostel the file is uploaded right after the hostel is created;
  // when editing it is uploaded / removed immediately.
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const [hasQr, setHasQr] = useState(!!editing?.hasQr)
  const [qrVersion, setQrVersion] = useState(0)
  const [savingQr, setSavingQr] = useState(false)
  // stay rules
  const [notice, setNotice] = useState(String(editing?.noticePeriodDays ?? 30))
  const [minStay, setMinStay] = useState(String(editing?.depositMinStayMonths ?? 0))
  const [rulesText, setRulesText] = useState(editing?.rulesText ?? '')
  const [addDefaultRules, setAddDefaultRules] = useState(true)
  const [loadingRules, setLoadingRules] = useState(false)
  const qc = useQueryClient()
  const rulesChanged = !!editing && rulesText.trim() !== (editing.rulesText ?? '').trim()

  const create = useCreateHostel()
  const update = useUpdateHostel(onClose)
  const uploadQr = useUploadHostelQr()
  const removeQr = useRemoveHostelQr()
  const pending = create.isPending || update.isPending || savingQr || loadingRules
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

  /** Parsed charges, or an error message. The old fixed electricity amount is always cleared (electricity is metered). */
  const buildCharges = (): HostelCharges | string => {
    let mess = 0
    if (charges.mess.trim()) {
      const n = Number(charges.mess)
      if (!Number.isFinite(n) || n < 0 || n > MAX_CHARGE) return 'Enter a valid amount for mess.'
      mess = Math.round(n)
    }
    return {
      mess,
      electricity: 0,
      water: 0,
      internet: 0,
      laundry: 0,
      maintenance: 0,
      others: [],
    }
  }

  /** ₹ per unit (up to 2 decimals), or null if invalid. */
  const parseRate = (): number | null => {
    if (!charges.electricityRate.trim()) return 0
    const n = Number(charges.electricityRate)
    return Number.isFinite(n) && n >= 0 && n <= MAX_UNIT_RATE ? Math.round(n * 100) / 100 : null
  }
  /** Fill the textarea with the suggested rules (built from this hostel's saved settings). */
  const loadDefaultRules = async () => {
    if (!editing) return
    if (rulesText.trim()) {
      const ok = await confirm({
        title: 'Replace the rules?',
        message: 'The text in the box will be replaced with the default rules. Nothing is saved until you click "Save changes".',
        confirmText: 'Replace',
      })
      if (!ok) return
    }
    setLoadingRules(true)
    try {
      const r = await hostelsApi.defaultRules(editing.id)
      setRulesText(r.rulesText)
      setErr('rulesText', undefined)
      toast.info('Default rules added. Review and edit them, then save.')
    } catch (e) {
      setErr('rulesText', errorMessage(e))
    } finally {
      setLoadingRules(false)
    }
  }

  /** After a new hostel is created: upload the chosen QR and add the default rules (both need the hostel id). */
  const afterCreate = async (h: Hostel) => {
    setSavingQr(true)
    if (qrFile) {
      try {
        await uploadQr.mutateAsync({ id: h.id, file: qrFile })
      } catch (err) {
        toast.error(`Hostel added, but the QR image couldn't be uploaded (${errorMessage(err)}). Edit the hostel to try again.`)
      }
    }
    if (!rulesText.trim() && addDefaultRules) {
      try {
        const r = await hostelsApi.defaultRules(h.id)
        await hostelsApi.update({ id: h.id, rulesText: r.rulesText })
        await qc.invalidateQueries({ queryKey: ['hostels'] })
      } catch (err) {
        toast.error(`Hostel added, but the default rules couldn't be added (${errorMessage(err)}). Edit the hostel to add them.`)
      }
    }
    setSavingQr(false)
    onClose()
  }

  const rateNum = Number(charges.electricityRate)
  const rateOn = Number.isFinite(rateNum) && rateNum > 0

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
    const rate = parseRate()
    if (rate === null) e.electricityRate = `Enter a rate between ₹0 and ₹${MAX_UNIT_RATE} per unit.`
    else if (rate > 0 && !charges.electricityBasis) e.electricityBasis = 'Choose how the meters are read.'
    const noticeNum = Number(notice)
    if (notice.trim() === '' || !Number.isInteger(noticeNum) || noticeNum < 0 || noticeNum > MAX_NOTICE_DAYS)
      e.noticePeriodDays = `Enter 0 to ${MAX_NOTICE_DAYS} days.`
    if (rulesText.trim().length > RULES_MAX) e.rulesText = `Rules can be at most ${RULES_MAX.toLocaleString('en-IN')} characters.`
    setErrors((prev) => ({ ...e, qr: prev.qr }))
    setApiError('')
    if (Object.keys(e).length || typeof built === 'string' || rate === null) return

    const body: HostelInput = {
      name: form.name.trim(),
      type: form.type,
      city: form.city.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      upiId,
      payeeName,
      charges: built,
      electricityRate: rate,
      electricityBasis: charges.electricityBasis || 'room',
      noticePeriodDays: noticeNum,
      depositMinStayMonths: Number(minStay) || 0,
      rulesText: rulesText.trim(),
    }
    const onError = (err: unknown) => setApiError(errorMessage(err))
    if (editing) {
      update.mutate(
        {
          id: editing.id,
          ...body,
          ...(!codeLocked && code !== editing.code ? { code } : {}),
        },
        { onError },
      )
      return
    }
    create.mutate(
      { ...body, ...(code ? { code } : {}) },
      {
        onError,
        onSuccess: (h) => void afterCreate(h),
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
          <Input
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Sunrise Boys Hostel"
            autoFocus
          />
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
            onChange={(e) =>
              setForm({
                ...form,
                code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
              })
            }
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
            Room rent (set per room) already includes {INCLUDED_IN_RENT}. Only mess and electricity are billed separately.
          </p>
        </div>
        <Field label="Mess (per month)" hint="Mess members only. Leave blank if you don't run a mess.">
          <AmountInput label="Mess" value={charges.mess} onChange={(v) => setCharges({ ...charges, mess: v })} />
        </Field>
        <div className="hidden sm:block" />

        <div className="sm:col-span-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Zap className="h-4 w-4 text-amber-500" /> Electricity (as per meter)
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Every month staff enter the units used (Rooms &amp; Beds → Electricity). Amount = units × rate, added to each hosteler's bill. Leave the rate blank
            if you don't charge electricity.
          </p>
        </div>
        <Field label="Electricity rate (₹ per unit)" error={errors.electricityRate} hint={errors.electricityRate ? undefined : 'e.g. 10'}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_UNIT_RATE}
              step="0.01"
              value={charges.electricityRate}
              placeholder="0"
              aria-label="Electricity rate per unit"
              onChange={(e) => {
                const v = e.target.value
                setCharges((c) => ({
                  ...c,
                  electricityRate: v,
                  electricityBasis: c.electricityBasis || (Number(v) > 0 ? 'room' : ''),
                }))
              }}
              className="pl-7 pr-14 text-right"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">/unit</span>
          </div>
        </Field>
        <div className="hidden sm:block" />
        <fieldset className="sm:col-span-2" disabled={!rateOn}>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">How are the meters? {rateOn && <span className="text-red-500">*</span>}</legend>
          <div className={cn('grid gap-2 sm:grid-cols-2', !rateOn && 'opacity-50')}>
            {BASIS_CHOICES.map((b) => (
              <label
                key={b.value}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 transition-colors',
                  rateOn ? 'cursor-pointer' : 'cursor-not-allowed',
                  charges.electricityBasis === b.value ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="electricityBasis"
                  value={b.value}
                  checked={charges.electricityBasis === b.value}
                  onChange={() => setCharges((c) => ({ ...c, electricityBasis: b.value }))}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{b.title}</span>
                  <span className="block text-xs text-slate-500">{b.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.electricityBasis && <p className="mt-1 text-xs text-red-600">{errors.electricityBasis}</p>}
          {rateOn && charges.electricityBasis === 'room' && (
            <p className="mt-2 text-xs text-slate-500">
              Example: 100 units × ₹{rateNum.toLocaleString('en-IN')} = ₹{Math.round(100 * rateNum).toLocaleString('en-IN')}. With 2 hostelers in the room, each
              pays ₹{Math.ceil(Math.round(100 * rateNum) / 2).toLocaleString('en-IN')}.
            </p>
          )}
        </fieldset>
        {errors.charges && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{errors.charges}</p>}

        {/* ---------------- Stay rules ---------------- */}
        <div className="border-t border-slate-100 pt-4 sm:col-span-2">
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            <ScrollText className="h-4 w-4 text-brand-600" /> Stay rules
          </p>
          <p className="mt-0.5 text-sm text-slate-500">Notice for moving out, when the security deposit is refunded, and the rules every hosteler signs in the app.</p>
        </div>
        <Field
          label="Notice period (days)"
          error={errors.noticePeriodDays}
          hint={errors.noticePeriodDays ? undefined : 'Hostelers must request a move-out at least this many days ahead. 0 = no notice.'}
        >
          <Input type="number" inputMode="numeric" min={0} max={MAX_NOTICE_DAYS} step={1} value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="30" />
        </Field>
        <Field label="Deposit refundable" hint="If a hosteler leaves earlier, the deposit is kept and is not adjusted against dues.">
          <Select value={minStay} onChange={(e) => setMinStay(e.target.value)} options={DEPOSIT_STAY_OPTIONS} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
            <span className="text-sm font-medium text-slate-700">
              Hostel rules
              {editing && editing.rulesVersion > 0 && editing.rulesText && <span className="ml-2 text-xs font-normal text-slate-500">version {editing.rulesVersion}</span>}
            </span>
            {editing && (
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                loading={loadingRules}
                disabled={pending && !loadingRules}
                onClick={() => void loadDefaultRules()}
              >
                Use default rules
              </Button>
            )}
          </div>
          <Textarea
            rows={8}
            maxLength={RULES_MAX}
            value={rulesText}
            aria-label="Hostel rules"
            onChange={(e) => {
              setRulesText(e.target.value)
              if (errors.rulesText) setErr('rulesText', undefined)
            }}
            placeholder={
              editing ? 'Write your hostel rules, or click "Use default rules" to start from a ready-made set.' : 'Write your hostel rules here, or leave blank to use the default rules.'
            }
            className="text-xs leading-relaxed sm:text-sm"
          />
          <div className="mt-1 flex items-start justify-between gap-3">
            {errors.rulesText ? <p className="text-xs text-red-600">{errors.rulesText}</p> : <span />}
            <span className="shrink-0 text-xs text-slate-400">
              {rulesText.length.toLocaleString('en-IN')} / {RULES_MAX.toLocaleString('en-IN')}
            </span>
          </div>
          {!editing && !rulesText.trim() && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={addDefaultRules} onChange={(e) => setAddDefaultRules(e.target.checked)} />
              <span>Add the default rules (rent, deposit, notice, timings, visitors, conduct…) built from these settings. You can edit them later.</span>
            </label>
          )}
          <p className={cn('mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs', rulesChanged ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600')}>
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Hostelers read and sign these rules in the app after check-in.{' '}
              {rulesChanged
                ? 'You changed the rules: when you save, every hosteler of this hostel will be asked to sign the new version before using the app.'
                : 'Changing the rules later asks every hosteler to sign again.'}
            </span>
          </p>
        </div>
      </div>
    </Modal>
  )
}
