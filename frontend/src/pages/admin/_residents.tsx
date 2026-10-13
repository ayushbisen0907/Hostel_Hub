import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, ImageIcon } from 'lucide-react'
import type { DocumentType, HDocument, Hosteler, HostelerStatus, ID, PaymentMode } from '@/api/types'
import { errorMessage } from '@/api/client'
import { useApiMutation } from '@/api/query'
import { useScope } from '@/api/common'
import { checkUploadFile, MAX_UPLOAD_MB, useProtectedFileUrl } from '@/api/files'
import { DOCUMENT_INVALIDATE, documentFilePath, documentsApi, downloadDocument } from '@/api/documents'
import { hostelerPhotoPath, useHostelers, type HostelerProfileFields, type HostelerRow } from '@/api/hostelers'
import { Avatar, Badge, Button, Field, FileDrop, Input, Modal, SearchInput, Select, Spinner, Textarea, toast, type SelectOption } from '@/components/ui'
import { cn, daysBetween, formatBytes, today } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  aadhaar: 'Aadhaar card',
  pan: 'PAN card',
  photo: 'Photograph',
  college_id: 'College ID',
  office_id: 'Office ID',
  police_verification: 'Police verification',
  rent_agreement: 'Rent agreement',
  medical: 'Medical certificate',
  other: 'Other',
}

export const DOC_TYPE_OPTIONS: SelectOption[] = (Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((k) => ({
  value: k,
  label: DOC_TYPE_LABELS[k],
}))

export const PAYMENT_MODE_OPTIONS: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'online', label: 'Online' },
]

export const GENDER_OPTIONS: SelectOption[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]

export const OCCUPATION_OPTIONS: SelectOption[] = [
  { value: 'student', label: 'Student' },
  { value: 'working', label: 'Working professional' },
  { value: 'other', label: 'Other' },
]

export const BLOOD_GROUPS: SelectOption[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b }))

export const ID_PROOF_TYPES: SelectOption[] = ['Aadhaar', 'PAN', 'Passport', 'Driving licence', 'Voter ID', 'Other'].map((b) => ({
  value: b,
  label: b,
}))

export const AMENITIES = ['WiFi', 'Attached bathroom', 'Balcony', 'Geyser', 'Study table', 'Wardrobe', 'Cooler', 'TV', 'Fridge', 'Housekeeping']

export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic'
export const UPLOAD_HINT = `JPG, PNG, WEBP, HEIC or PDF · up to ${MAX_UPLOAD_MB} MB`

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function cleanPhone(p: string): string {
  return p.replace(/\D/g, '').slice(-10)
}

export function whatsappLink(phone: string): string {
  return `https://wa.me/91${cleanPhone(phone)}`
}

/** Direct portal login link with the Hosteler ID pre-filled */
export function portalLoginUrl(loginId: string): string {
  return `${window.location.origin}/portal/login?id=${encodeURIComponent(loginId)}`
}

export interface PortalInvite {
  name: string
  phone: string
  loginId: string
  tempPassword: string
  hostelName: string
}

/** Welcome message with portal login details, ready to send to the resident */
export function portalInviteText({ name, loginId, tempPassword, hostelName }: PortalInvite): string {
  return [
    `Hi ${name.split(' ')[0]}, welcome to ${hostelName}!`,
    ``,
    `Your HostelHub resident portal is ready. Pay rent, see the mess menu, skip meals, raise complaints and apply for leave.`,
    ``,
    `Login: ${portalLoginUrl(loginId)}`,
    `Hosteler ID: ${loginId}`,
    `Temporary password: ${tempPassword}`,
    ``,
    `You'll be asked to create your own password when you first log in. Don't share it with anyone.`,
  ].join('\n')
}

export function portalInviteWhatsApp(invite: PortalInvite): string {
  return `${whatsappLink(invite.phone)}?text=${encodeURIComponent(portalInviteText(invite))}`
}

export async function copyText(text: string, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch {
    toast.error('Could not copy — select the text and copy it manually')
  }
}

export function isValidPhone(p: string): boolean {
  return /^[6-9]\d{9}$/.test(cleanPhone(p)) && p.replace(/\D/g, '').length >= 10
}

/** Validates a picked file (type + size); toasts and returns false when it can't be uploaded. */
export function acceptFile(file: File, opts: { photo?: boolean } = {}): boolean {
  const err = checkUploadFile(file, opts)
  if (err) toast.error(err)
  return !err
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none'

export function expiryState(expiry: string | null): ExpiryState {
  if (!expiry) return 'none'
  const d = daysBetween(today(), expiry)
  if (d < 0) return 'expired'
  if (d <= 30) return 'soon'
  return 'ok'
}

export function isImage(mime: string) {
  return mime.startsWith('image/')
}

export function isPdf(mime: string) {
  return mime === 'application/pdf'
}

export function firstName(name: string) {
  return name.split(' ')[0] ?? name
}

/** "Room 101 · Bed A" (or a fallback) from the labels the API adds to hostelers. */
export function bedText(h: { roomNumber: string | null; bedLabel: string | null; status?: HostelerStatus }, fallback = 'Not allotted') {
  if (h.status === 'checked_out') return '—'
  return h.roomNumber && h.bedLabel ? `Room ${h.roomNumber} · Bed ${h.bedLabel}` : h.roomNumber ? `Room ${h.roomNumber}` : fallback
}

/** Debounced copy of a value (for search boxes that hit the API). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/* ------------------------------------------------------------------ */
/* Hosteler profile form (shared by edit modal and check-in wizard)    */
/* ------------------------------------------------------------------ */

export type ProfileForm = HostelerProfileFields

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>
export type SetProfile = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => void

export function emptyProfile(): ProfileForm {
  return {
    name: '',
    phone: '',
    email: '',
    gender: 'male',
    dob: '',
    permanentAddress: '',
    occupation: 'student',
    institution: '',
    course: '',
    guardianName: '',
    guardianRelation: 'Father',
    guardianPhone: '',
    bloodGroup: '',
    idProofType: 'Aadhaar',
    idProofNumber: '',
  }
}

export function profileOf(h: Hosteler): ProfileForm {
  return {
    name: h.name,
    phone: h.phone,
    email: h.email,
    gender: h.gender,
    dob: h.dob,
    permanentAddress: h.permanentAddress,
    occupation: h.occupation,
    institution: h.institution,
    course: h.course,
    guardianName: h.guardianName,
    guardianRelation: h.guardianRelation,
    guardianPhone: h.guardianPhone,
    bloodGroup: h.bloodGroup,
    idProofType: h.idProofType,
    idProofNumber: h.idProofNumber,
  }
}

/** Trimmed profile body for the API. */
export function profileBody(f: ProfileForm): ProfileForm {
  return {
    ...f,
    name: f.name.trim(),
    phone: cleanPhone(f.phone),
    email: f.email.trim(),
    permanentAddress: f.permanentAddress.trim(),
    institution: f.institution.trim(),
    course: f.course.trim(),
    guardianName: f.guardianName.trim(),
    guardianPhone: f.guardianPhone ? cleanPhone(f.guardianPhone) : '',
    idProofNumber: f.idProofNumber.trim(),
  }
}

export function validatePersonal(f: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {}
  if (f.name.trim().length < 2) e.name = 'Name is required'
  if (!f.phone.trim()) e.phone = 'Phone is required'
  else if (!isValidPhone(f.phone)) e.phone = 'Enter a valid 10-digit mobile number'
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email'
  return e
}

export function validateGuardian(f: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {}
  if (!f.guardianName.trim()) e.guardianName = 'Guardian name is required'
  if (!f.guardianPhone.trim()) e.guardianPhone = 'Guardian phone is required'
  else if (!isValidPhone(f.guardianPhone)) e.guardianPhone = 'Enter a valid 10-digit mobile number'
  return e
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-1">
      <h4 className="text-sm font-semibold text-slate-900">{children}</h4>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/** Photo chooser. The file is kept by the caller and uploaded separately (images ≤ 2 MB). */
export function PhotoPicker({
  name,
  src,
  onPick,
  onRemove,
  busy,
}: {
  name: string
  src: string | null
  onPick: (file: File) => void
  onRemove?: () => void
  busy?: boolean
}) {
  return (
    <div className="flex items-center gap-4">
      {src ? (
        <img src={src} alt={name || 'Photo'} className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-100" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {busy ? <Spinner className="h-6 w-6" /> : <ImageIcon className="h-7 w-7" />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            'inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50',
            busy && 'pointer-events-none opacity-50',
          )}
        >
          {src ? 'Change photo' : 'Upload photo'}
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file && acceptFile(file, { photo: true })) onPick(file)
            }}
          />
        </label>
        {src && onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={busy}>
            Remove
          </Button>
        )}
        <span className="w-full text-xs text-slate-500">JPG, PNG or WEBP · up to 2 MB</span>
      </div>
    </div>
  )
}

export function PersonalFields({ f, set, errors, photo }: { f: ProfileForm; set: SetProfile; errors: ProfileErrors; photo?: ReactNode }) {
  return (
    <div className="space-y-4">
      {photo}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rahul Sharma" maxLength={80} />
        </Field>
        <Field label="Mobile number" required error={errors.phone}>
          <Input
            value={f.phone}
            inputMode="numeric"
            maxLength={10}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Gender">
          <Select value={f.gender} options={GENDER_OPTIONS} onChange={(e) => set('gender', e.target.value as ProfileForm['gender'])} />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={f.dob} max={today()} onChange={(e) => set('dob', e.target.value)} />
        </Field>
        <Field label="Blood group">
          <Select value={f.bloodGroup} options={BLOOD_GROUPS} placeholder="Select" onChange={(e) => set('bloodGroup', e.target.value)} />
        </Field>
      </div>
      <Field label="Permanent address">
        <Textarea
          value={f.permanentAddress}
          maxLength={500}
          onChange={(e) => set('permanentAddress', e.target.value)}
          placeholder="House no., street, city, state, PIN"
        />
      </Field>
    </div>
  )
}

export function AcademicFields({ f, set }: { f: ProfileForm; set: SetProfile }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="Occupation">
        <Select value={f.occupation} options={OCCUPATION_OPTIONS} onChange={(e) => set('occupation', e.target.value as ProfileForm['occupation'])} />
      </Field>
      <Field label={f.occupation === 'working' ? 'Company' : 'Institution'}>
        <Input
          value={f.institution}
          maxLength={150}
          onChange={(e) => set('institution', e.target.value)}
          placeholder={f.occupation === 'working' ? 'Company name' : 'College / school'}
        />
      </Field>
      <Field label={f.occupation === 'working' ? 'Designation' : 'Course'}>
        <Input
          value={f.course}
          maxLength={150}
          onChange={(e) => set('course', e.target.value)}
          placeholder={f.occupation === 'working' ? 'e.g. Software engineer' : 'e.g. B.Tech CSE'}
        />
      </Field>
    </div>
  )
}

export function GuardianFields({ f, set, errors }: { f: ProfileForm; set: SetProfile; errors: ProfileErrors }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="Guardian name" required error={errors.guardianName}>
        <Input value={f.guardianName} maxLength={80} onChange={(e) => set('guardianName', e.target.value)} />
      </Field>
      <Field label="Relation">
        <Select
          value={f.guardianRelation}
          options={['Father', 'Mother', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Spouse', 'Other'].map((r) => ({ value: r, label: r }))}
          onChange={(e) => set('guardianRelation', e.target.value)}
        />
      </Field>
      <Field label="Guardian phone" required error={errors.guardianPhone}>
        <Input
          value={f.guardianPhone}
          inputMode="numeric"
          maxLength={10}
          onChange={(e) => set('guardianPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
        />
      </Field>
    </div>
  )
}

export function IdProofFields({ f, set }: { f: ProfileForm; set: SetProfile }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="ID proof type">
        <Select value={f.idProofType} options={ID_PROOF_TYPES} onChange={(e) => set('idProofType', e.target.value)} />
      </Field>
      <Field label="ID number">
        <Input value={f.idProofNumber} maxLength={40} onChange={(e) => set('idProofNumber', e.target.value)} placeholder="e.g. XXXX XXXX 1234" />
      </Field>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hosteler avatar (protected photo)                                   */
/* ------------------------------------------------------------------ */

export function HostelerAvatar({
  h,
  size = 'sm',
}: {
  h: Pick<Hosteler, 'id' | 'name' | 'photoUrl'> & { updatedAt?: string }
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const { url } = useProtectedFileUrl(hostelerPhotoPath(h), h.updatedAt)
  return <Avatar name={h.name} src={url} size={size} />
}

/* ------------------------------------------------------------------ */
/* Hosteler search (server-side)                                       */
/* ------------------------------------------------------------------ */

/**
 * Type-ahead search of hostelers via GET /hostelers?q=. Shows up to 8 matches
 * in the top-bar hostel scope.
 */
export function HostelerSearch({
  onPick,
  status = 'active',
  placeholder = 'Search name, phone or Hosteler ID…',
  aside,
  emptyText,
}: {
  onPick: (h: HostelerRow) => void
  status?: HostelerStatus | 'all'
  placeholder?: string
  /** extra content on the right of each suggestion */
  aside?: (h: HostelerRow) => ReactNode
  emptyText?: string
}) {
  const scope = useScope()
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 250)
  const query = useHostelers({ q: term, status, hostelId: scope, limit: 8 }, term.length > 0)
  const items = term && q.trim() ? (query.data?.items ?? []) : []
  return (
    <div className="relative">
      <SearchInput value={q} onChange={setQ} placeholder={placeholder} />
      {q.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {query.error ? (
            <p className="px-3 py-3 text-xs text-red-600">{errorMessage(query.error)}</p>
          ) : items.length ? (
            <ul>
              {items.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(h)
                      setQ('')
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <HostelerAvatar h={h} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{h.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {h.loginId} · {bedText(h)}
                      </p>
                    </div>
                    {aside?.(h)}
                  </button>
                </li>
              ))}
            </ul>
          ) : term && !query.isFetching && term === q.trim() ? (
            <p className="px-3 py-3 text-xs text-slate-500">{emptyText ?? `No resident matches “${q.trim()}”.`}</p>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-500">Searching…</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Document preview                                                    */
/* ------------------------------------------------------------------ */

type PreviewDoc = Pick<HDocument, 'id' | 'type' | 'fileName' | 'mimeType' | 'size'>

export function DocPreviewModal({ doc, onClose }: { doc: PreviewDoc | null; onClose: () => void }) {
  const { url, error, loading } = useProtectedFileUrl(doc ? documentFilePath(doc.id) : null)
  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (!doc) return
    setDownloading(true)
    try {
      await downloadDocument(doc)
    } catch (e) {
      toast.error(errorMessage(e, 'Download failed'))
    } finally {
      setDownloading(false)
    }
  }
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      size="xl"
      title={doc ? DOC_TYPE_LABELS[doc.type] : ''}
      description={doc ? `${doc.fileName} · ${formatBytes(doc.size)}` : undefined}
      footer={
        doc && (
          <Button icon={<Download className="h-4 w-4" />} onClick={download} loading={downloading}>
            Download
          </Button>
        )
      }
    >
      {doc &&
        (loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : error || !url ? (
          <div className="flex flex-col items-center py-10 text-center">
            <FileText className="mb-3 h-10 w-10 text-slate-400" />
            <p className="text-sm text-slate-600">Couldn't load this file. Try downloading it instead.</p>
          </div>
        ) : isImage(doc.mimeType) ? (
          <img src={url} alt={doc.fileName} className="mx-auto max-h-[65vh] rounded-lg object-contain" />
        ) : isPdf(doc.mimeType) ? (
          <iframe src={url} title={doc.fileName} className="h-[65vh] w-full rounded-lg border border-slate-200" />
        ) : (
          <div className="flex flex-col items-center py-10 text-center">
            <FileText className="mb-3 h-10 w-10 text-slate-400" />
            <p className="text-sm text-slate-600">Preview isn't available for this file type. Download it to view.</p>
          </div>
        ))}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Upload document modal                                               */
/* ------------------------------------------------------------------ */

export function UploadDocModal({
  open,
  onClose,
  hostelerId,
  hostelerName,
  defaultType = 'aadhaar',
}: {
  open: boolean
  onClose: () => void
  /** Preselected hosteler. When given the picker is hidden. */
  hostelerId?: ID | null
  hostelerName?: string
  defaultType?: DocumentType
}) {
  const [picked, setPicked] = useState<{ id: ID; name: string } | null>(null)
  const [type, setType] = useState<DocumentType>(defaultType)
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const save = useApiMutation(documentsApi.upload, {
    invalidate: DOCUMENT_INVALIDATE,
    success: (_d, v) => `${DOC_TYPE_LABELS[v.type]} uploaded`,
    onSuccess: () => onClose(),
  })
  const { reset } = save

  useEffect(() => {
    if (open) {
      setPicked(hostelerId ? { id: hostelerId, name: hostelerName ?? '' } : null)
      setType(defaultType)
      setExpiry('')
      setFile(null)
      reset()
    }
  }, [open, hostelerId, hostelerName, defaultType, reset])

  const submit = () => {
    if (!picked) return toast.error('Choose a hosteler')
    if (!file) return toast.error('Choose a file to upload')
    save.mutate({ file, hostelerId: picked.id, type, expiryDate: expiry || null })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload document"
      description={hostelerId ? hostelerName : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!picked || !file}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!hostelerId && (
          <Field label="Hosteler" required>
            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="truncate text-sm font-medium text-slate-800">{picked.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <HostelerSearch status="all" onPick={(h) => setPicked({ id: h.id, name: h.name })} />
            )}
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Document type" required>
            <Select value={type} options={DOC_TYPE_OPTIONS} onChange={(e) => setType(e.target.value as DocumentType)} />
          </Field>
          <Field label="Expiry date" hint="Optional">
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </div>
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <FileText className="h-5 w-5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)} disabled={save.isPending}>
              Change
            </Button>
          </div>
        ) : (
          <FileDrop
            accept={UPLOAD_ACCEPT}
            hint={UPLOAD_HINT}
            onFiles={(files) => {
              const f = files[0]
              if (f && acceptFile(f)) setFile(f)
            }}
          />
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Small UI bits                                                       */
/* ------------------------------------------------------------------ */

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">{children}</div>
}

/** Footer with "x–y of N" and prev/next buttons for paginated lists. */
export function Pager({
  page,
  pages,
  total,
  limit,
  onPage,
  busy,
  noun = 'records',
}: {
  page: number
  pages: number
  total: number
  limit: number
  onPage: (p: number) => void
  busy?: boolean
  noun?: string
}) {
  if (!total) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span className="inline-flex items-center gap-2">
        {from}–{to} of {total} {noun}
        {busy && <Spinner className="h-3.5 w-3.5" />}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="h-4 w-4" />} />
          <span className="px-2">
            {page} / {pages}
          </span>
          <Button size="sm" variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} icon={<ChevronRight className="h-4 w-4" />} />
        </div>
      )}
    </div>
  )
}

/** Small "Inside / Outside" badge from a last gate direction. */
export function GateBadge({ direction }: { direction: 'in' | 'out' | null | undefined }) {
  if (!direction) return null
  return <Badge tone={direction === 'in' ? 'green' : 'amber'}>{direction === 'in' ? 'Inside' : 'Outside'}</Badge>
}
