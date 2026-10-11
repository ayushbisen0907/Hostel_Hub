import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, FileText, ImageIcon } from 'lucide-react'
import { useStore } from '@/store'
import type { DocumentType, HDocument, Hosteler, ID, PaymentMode } from '@/types'
import { Button, Field, FileDrop, Input, Modal, Select, Textarea, toast, type SelectOption } from '@/components/ui'
import { cn, daysBetween, fileToDataUrl, formatBytes, today } from '@/lib/utils'
import { useScopedHostelers } from '@/store/selectors'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MAX_FILE_BYTES = 2 * 1024 * 1024

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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export function cleanPhone(p: string): string {
  return p.replace(/\D/g, '').slice(-10)
}

export function whatsappLink(phone: string): string {
  return `https://wa.me/91${cleanPhone(phone)}`
}

/** Direct portal login link with the phone pre-filled */
export function portalLoginUrl(phone: string): string {
  return `${window.location.origin}/portal/login?phone=${cleanPhone(phone)}`
}

/** Welcome message with portal login details, ready to send to the resident */
export function portalInviteText(name: string, phone: string, pin: string, hostelName: string): string {
  return [
    `Hi ${name.split(' ')[0]}, welcome to ${hostelName}!`,
    ``,
    `Use the HostelHub resident portal to pay rent, see the mess menu, skip meals, raise complaints and apply for leave.`,
    ``,
    `Login: ${portalLoginUrl(phone)}`,
    `Mobile: ${cleanPhone(phone)}`,
    `PIN: ${pin}`,
    ``,
    `Please change your PIN after first login (Profile > Change PIN).`,
  ].join('\n')
}

export function portalInviteWhatsApp(name: string, phone: string, pin: string, hostelName: string): string {
  return `${whatsappLink(phone)}?text=${encodeURIComponent(portalInviteText(name, phone, pin, hostelName))}`
}

export function isValidPhone(p: string): boolean {
  return /^[6-9]\d{9}$/.test(cleanPhone(p)) && p.replace(/\D/g, '').length >= 10
}

export interface FilePayload {
  fileName: string
  mimeType: string
  size: number
  dataUrl: string
}

/** Reads a file into a data URL, rejecting anything larger than 2 MB. */
export async function readFile(file: File): Promise<FilePayload | null> {
  if (file.size > MAX_FILE_BYTES) {
    toast.error(`"${file.name}" is ${formatBytes(file.size)}. Files must be 2 MB or smaller.`)
    return null
  }
  try {
    const dataUrl = await fileToDataUrl(file)
    return { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataUrl }
  } catch {
    toast.error(`Could not read "${file.name}"`)
    return null
  }
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

/* ------------------------------------------------------------------ */
/* Hosteler profile form (shared by edit modal and check-in wizard)    */
/* ------------------------------------------------------------------ */

export type ProfileForm = Pick<
  Hosteler,
  | 'name'
  | 'phone'
  | 'email'
  | 'gender'
  | 'dob'
  | 'photo'
  | 'permanentAddress'
  | 'occupation'
  | 'institution'
  | 'course'
  | 'guardianName'
  | 'guardianRelation'
  | 'guardianPhone'
  | 'bloodGroup'
  | 'idProofType'
  | 'idProofNumber'
>

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>
export type SetProfile = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => void

export function emptyProfile(): ProfileForm {
  return {
    name: '',
    phone: '',
    email: '',
    gender: 'male',
    dob: '',
    photo: null,
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

export function validatePersonal(f: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {}
  if (!f.name.trim()) e.name = 'Name is required'
  if (!f.phone.trim()) e.phone = 'Phone is required'
  else if (!/^\d{10}$/.test(f.phone.replace(/\D/g, ''))) e.phone = 'Enter a 10-digit mobile number'
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email'
  return e
}

export function validateGuardian(f: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {}
  if (!f.guardianName.trim()) e.guardianName = 'Guardian name is required'
  if (!f.guardianPhone.trim()) e.guardianPhone = 'Guardian phone is required'
  else if (!/^\d{10}$/.test(f.guardianPhone.replace(/\D/g, ''))) e.guardianPhone = 'Enter a 10-digit number'
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

export function PhotoPicker({ name, photo, onChange }: { name: string; photo: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-4">
      {photo ? (
        <img src={photo} alt={name || 'Photo'} className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-100" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <ImageIcon className="h-7 w-7" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {photo ? 'Change photo' : 'Upload photo'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              if (!file.type.startsWith('image/')) return toast.error('Please choose an image file')
              const p = await readFile(file)
              if (p) onChange(p.dataUrl)
            }}
          />
        </label>
        {photo && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

export function PersonalFields({ f, set, errors }: { f: ProfileForm; set: SetProfile; errors: ProfileErrors }) {
  return (
    <div className="space-y-4">
      <PhotoPicker name={f.name} photo={f.photo} onChange={(v) => set('photo', v)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={errors.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rahul Sharma" />
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
        <Textarea value={f.permanentAddress} onChange={(e) => set('permanentAddress', e.target.value)} placeholder="House no., street, city, state, PIN" />
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
        <Input value={f.institution} onChange={(e) => set('institution', e.target.value)} placeholder={f.occupation === 'working' ? 'Company name' : 'College / school'} />
      </Field>
      <Field label={f.occupation === 'working' ? 'Designation' : 'Course'}>
        <Input value={f.course} onChange={(e) => set('course', e.target.value)} placeholder={f.occupation === 'working' ? 'e.g. Software engineer' : 'e.g. B.Tech CSE'} />
      </Field>
    </div>
  )
}

export function GuardianFields({ f, set, errors }: { f: ProfileForm; set: SetProfile; errors: ProfileErrors }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="Guardian name" required error={errors.guardianName}>
        <Input value={f.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
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
        <Input value={f.idProofNumber} onChange={(e) => set('idProofNumber', e.target.value)} placeholder="e.g. XXXX XXXX 1234" />
      </Field>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Document preview                                                    */
/* ------------------------------------------------------------------ */

export function DocPreviewModal({ doc, onClose }: { doc: HDocument | null; onClose: () => void }) {
  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      size="xl"
      title={doc ? DOC_TYPE_LABELS[doc.type] : ''}
      description={doc ? `${doc.fileName} · ${formatBytes(doc.size)}` : undefined}
      footer={
        doc && (
          <a href={doc.dataUrl} download={doc.fileName}>
            <Button icon={<Download className="h-4 w-4" />}>Download</Button>
          </a>
        )
      }
    >
      {doc &&
        (isImage(doc.mimeType) ? (
          <img src={doc.dataUrl} alt={doc.fileName} className="mx-auto max-h-[65vh] rounded-lg object-contain" />
        ) : isPdf(doc.mimeType) ? (
          <iframe src={doc.dataUrl} title={doc.fileName} className="h-[65vh] w-full rounded-lg border border-slate-200" />
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
  defaultType = 'aadhaar',
}: {
  open: boolean
  onClose: () => void
  /** Preselected hosteler. When given the picker is hidden. */
  hostelerId?: ID | null
  defaultType?: DocumentType
}) {
  const addDocument = useStore((s) => s.addDocument)
  const hostelers = useScopedHostelers()
  const [hid, setHid] = useState<string>('')
  const [type, setType] = useState<DocumentType>(defaultType)
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<FilePayload | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setHid(hostelerId ?? '')
      setType(defaultType)
      setExpiry('')
      setFile(null)
    }
  }, [open, hostelerId, defaultType])

  const options = useMemo(
    () => [...hostelers].sort((a, b) => a.name.localeCompare(b.name)).map((h) => ({ value: h.id, label: `${h.name} · ${h.phone}` })),
    [hostelers],
  )

  const save = () => {
    if (!hid) return toast.error('Choose a hosteler')
    if (!file) return toast.error('Choose a file to upload')
    addDocument({ hostelerId: hid, type, ...file, verified: false, expiryDate: expiry || null })
    toast.success(`${DOC_TYPE_LABELS[type]} uploaded`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload document"
      description={hostelerId ? hostelers.find((h) => h.id === hostelerId)?.name : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!hostelerId && (
          <Field label="Hosteler" required>
            <Select value={hid} options={options} placeholder="Select hosteler" onChange={(e) => setHid(e.target.value)} />
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
              <p className="truncate text-sm font-medium text-slate-800">{file.fileName}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              Change
            </Button>
          </div>
        ) : (
          <FileDrop
            accept="image/*,application/pdf"
            hint="JPG, PNG or PDF · up to 2 MB"
            onFiles={async (files) => {
              const f = files[0]
              if (!f) return
              setBusy(true)
              const p = await readFile(f)
              setBusy(false)
              if (p) setFile(p)
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
