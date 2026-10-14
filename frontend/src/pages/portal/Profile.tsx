import { useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Pencil,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { ApiError, downloadFile, errorMessage, openFile } from '@/api/client'
import { hostelerSetPassword } from '@/api/auth'
import {
  documentFileUrl,
  useDocumentBlobUrl,
  useMyAttendance,
  useMyDocuments,
  useMyGateLogs,
  usePortalHome,
  useProfilePhoto,
  useUpdateProfile,
  useUploadDocument,
  useUploadPhoto,
  type AttendanceStatus,
} from '@/api/portal'
import { useHostelerSession } from '@/api/session'
import type { DocumentType, HDocument } from '@/api/types'
import { checkPasswordStrength } from '@/lib/auth'
import { PasswordRules } from '@/components/PasswordRules'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  FileDrop,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
  toast,
  PasswordInput,
} from '@/components/ui'
import { cn, currentMonth, formatBytes, formatDate, formatDateTime, rentCycleText, titleCase, today } from '@/lib/utils'
import { NotLoggedIn, PortalTitle, SectionTitle, useMoney, useScrollToHash } from './_shared'
import { MoveOutCard } from './MoveOut'
import { RulesCard } from './_rulesCard'

/** Same limits as the server (backend/src/modules/portal/routes.ts) */
const MAX_BYTES = 2 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar card' },
  { value: 'pan', label: 'PAN card' },
  { value: 'photo', label: 'Passport photo' },
  { value: 'college_id', label: 'College ID' },
  { value: 'office_id', label: 'Office ID' },
  { value: 'police_verification', label: 'Police verification' },
  { value: 'rent_agreement', label: 'Rent agreement' },
  { value: 'medical', label: 'Medical certificate' },
  { value: 'other', label: 'Other' },
]
const DOC_LABEL = new Map(DOC_TYPES.map((d) => [d.value, d.label]))

async function openDoc(doc: HDocument, download: boolean) {
  try {
    if (download) await downloadFile(documentFileUrl(doc.id), doc.fileName)
    else await openFile(documentFileUrl(doc.id))
  } catch (e) {
    toast.error(errorMessage(e, 'Could not open this file'))
  }
}

function DocThumb({ doc }: { doc: HDocument }) {
  const isImage = doc.mimeType.startsWith('image/')
  const src = useDocumentBlobUrl(doc.id, isImage)
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500">
      {isImage && src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <FileText className="h-5 w-5" />}
    </div>
  )
}

const ATT_META: Record<AttendanceStatus, { label: string; tone: string }> = {
  present: { label: 'Present', tone: 'bg-emerald-50 text-emerald-700' },
  late: { label: 'Late', tone: 'bg-amber-50 text-amber-700' },
  leave: { label: 'On leave', tone: 'bg-violet-50 text-violet-700' },
  absent: { label: 'Absent', tone: 'bg-red-50 text-red-700' },
}

export default function Profile() {
  const session = useHostelerSession()
  const me = session?.hosteler
  const hostel = session?.hostel
  const home = usePortalHome()
  const photo = useProfilePhoto(me)
  const money = useMoney()
  useScrollToHash()

  const attendanceOn = home.data?.features.attendance === true
  const month = currentMonth()
  const docsQ = useMyDocuments()
  const gateQ = useMyGateLogs()
  const attQ = useMyAttendance(month, attendanceOn)

  const updateProfile = useUpdateProfile()
  const uploadPhoto = useUploadPhoto()
  const uploadDoc = useUploadDocument()

  const photoRef = useRef<HTMLInputElement>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ email: '', permanentAddress: '', guardianPhone: '' })
  const [formErr, setFormErr] = useState<Record<string, string>>({})

  const [docType, setDocType] = useState<DocumentType>('aadhaar')

  const [pin, setPin] = useState({ current: '', next: '', confirm: '' })
  const [pinErr, setPinErr] = useState<Record<string, string>>({})
  const [savingPin, setSavingPin] = useState(false)

  if (!me) return <NotLoggedIn />

  const bed = home.data?.bed ?? (me.roomId ? '—' : 'No bed assigned')

  const onPhoto = (file: File | undefined) => {
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type)) return toast.error('Photo must be a JPG, PNG, WEBP or HEIC image')
    if (file.size > MAX_BYTES) return toast.error('Photo must be 2 MB or smaller')
    uploadPhoto.mutate(file)
  }

  const openEdit = () => {
    setForm({ email: me.email, permanentAddress: me.permanentAddress, guardianPhone: me.guardianPhone })
    setFormErr({})
    setEditOpen(true)
  }

  const saveEdit = () => {
    const e: Record<string, string> = {}
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email'
    else if (form.email.trim().length > 120) e.email = 'Email is too long'
    const gp = form.guardianPhone.replace(/\D/g, '')
    if (gp.length < 10 || gp.length > 13) e.guardianPhone = 'Enter a valid phone number'
    if (!form.permanentAddress.trim()) e.permanentAddress = 'Address is required'
    else if (form.permanentAddress.trim().length > 500) e.permanentAddress = 'Keep the address under 500 characters'
    setFormErr(e)
    if (Object.keys(e).length) return
    updateProfile.mutate(
      {
        email: form.email.trim(),
        permanentAddress: form.permanentAddress.trim(),
        guardianPhone: form.guardianPhone.trim(),
      },
      {
        onSuccess: () => setEditOpen(false),
        onError: (err) => {
          // VALIDATION_ERROR details: [{ path, message }]
          const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as { path?: string; message?: string }[]) : []
          const first = details[0]
          if (first?.path && ['email', 'permanentAddress', 'guardianPhone'].includes(first.path))
            setFormErr({ [first.path]: first.message ?? 'Invalid value' })
          else toast.error(errorMessage(err, 'Could not save your details'))
        },
      },
    )
  }

  const onDocFiles = (files: File[]) => {
    const file = files[0]
    if (!file) return
    if (file.size > MAX_BYTES) return toast.error(`${file.name} is larger than 2 MB`)
    const okType = file.type.startsWith('image/') || file.type === 'application/pdf'
    if (!okType) return toast.error('Upload an image or PDF')
    uploadDoc.mutate(
      { file, type: docType },
      { onSuccess: () => toast.success(`${DOC_LABEL.get(docType)} uploaded — pending verification`) },
    )
  }

  const changePassword = async () => {
    const e: Record<string, string> = {}
    if (!pin.current) e.current = 'Enter your current password'
    if (!checkPasswordStrength(pin.next).ok) e.next = 'At least 8 characters with a letter and a number'
    else if (pin.next === pin.current) e.next = 'New password must be different'
    if (pin.confirm !== pin.next) e.confirm = "Passwords don't match"
    setPinErr(e)
    if (Object.keys(e).length) return
    setSavingPin(true)
    try {
      await hostelerSetPassword(pin.current, pin.next)
      setPin({ current: '', next: '', confirm: '' })
      toast.success('Password changed')
    } catch (err) {
      const msg = errorMessage(err, 'Could not change password')
      setPinErr(/current|incorrect/i.test(msg) ? { current: msg } : { next: msg })
    } finally {
      setSavingPin(false)
    }
  }

  const att = attQ.data
  const rate = att && att.summary.total ? Math.round(((att.summary.present + att.summary.late) / att.summary.total) * 100) : null
  const docs = docsQ.data ?? []
  const gate = (gateQ.data ?? []).slice(0, 10)

  return (
    <div className="pb-4">
      <PortalTitle title="My profile" />

      {/* Profile card */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-brand-600 to-brand-800" />
        <div className="-mt-10 flex flex-col items-center px-4 pb-5 text-center">
          <div className="relative">
            <div className="rounded-full ring-4 ring-white">
              <Avatar name={me.name} src={photo} size="xl" />
            </div>
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              disabled={uploadPhoto.isPending}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-brand-600 text-white shadow disabled:opacity-70"
              aria-label="Change photo"
            >
              {uploadPhoto.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              hidden
              onChange={(e) => {
                onPhoto(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
          <h2 className="mt-3 text-xl font-bold text-slate-900">{me.name}</h2>
          <p className="text-sm text-slate-500">
            {titleCase(me.occupation)}
            {me.institution && ` · ${me.institution}`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Badge tone="blue">{bed}</Badge>
            <Badge tone={me.status === 'active' ? 'green' : 'amber'}>{titleCase(me.status.replace(/_/g, ' '))}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
          <div className="px-2 py-3">
            <p className="text-xs text-slate-500">Monthly rent</p>
            <p className="font-semibold text-slate-900">{money(me.monthlyRent)}</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-xs text-slate-500">Deposit</p>
            <p className="font-semibold text-slate-900">{money(me.securityDeposit)}</p>
          </div>
          <div className="px-2 py-3">
            <p className="text-xs text-slate-500">Checked in</p>
            <p className="font-semibold text-slate-900">{formatDate(me.checkInDate, 'dd MMM yy')}</p>
          </div>
        </div>
      </Card>

      {/* Personal */}
      <Card className="mt-4">
        <CardHeader
          title="Personal details"
          action={
            <Button variant="outline" size="sm" onClick={openEdit} icon={<Pencil className="h-3.5 w-3.5" />}>
              Edit
            </Button>
          }
        />
        <div className="p-5">
          <DescriptionList
            items={[
              { label: 'Phone', value: me.phone },
              { label: 'Email', value: me.email },
              { label: 'Date of birth', value: me.dob ? formatDate(me.dob) : '' },
              { label: 'Gender', value: titleCase(me.gender) },
              { label: 'Blood group', value: me.bloodGroup },
              { label: me.occupation === 'working' ? 'Designation' : 'Course', value: me.course },
              { label: 'ID proof', value: me.idProofType ? `${me.idProofType} · ${me.idProofNumber}` : '' },
              { label: 'Permanent address', value: me.permanentAddress },
            ]}
          />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Guardian" />
          <div className="p-5">
            <DescriptionList
              cols={1}
              items={[
                { label: 'Name', value: me.guardianName },
                { label: 'Relation', value: me.guardianRelation },
                {
                  label: 'Phone',
                  value: me.guardianPhone ? (
                    <a href={`tel:${me.guardianPhone}`} className="text-brand-600">
                      {me.guardianPhone}
                    </a>
                  ) : (
                    ''
                  ),
                },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Stay details" />
          <div className="p-5">
            <DescriptionList
              cols={1}
              items={[
                { label: 'Hostel', value: hostel ? `${hostel.name}${hostel.city ? `, ${hostel.city}` : ''}` : '' },
                { label: 'Room & bed', value: bed },
                { label: 'Check-in date', value: formatDate(me.checkInDate) },
                { label: 'Rent cycle', value: me.checkInDate ? rentCycleText(me.checkInDate) : '' },
                { label: 'Expected check-out', value: me.expectedCheckOut ? formatDate(me.expectedCheckOut) : 'Not set' },
                { label: 'Mess', value: me.messOpted ? 'Enrolled' : 'Not enrolled' },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* Rules + move-out */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <RulesCard />
        {me.status === 'active' && <MoveOutCard />}
      </div>

      {/* Documents */}
      <SectionTitle id="documents">My documents</SectionTitle>
      <Card>
        {docsQ.isLoading ? (
          <LoadingState className="py-10" />
        ) : docsQ.error ? (
          <ErrorState error={docsQ.error} onRetry={() => void docsQ.refetch()} />
        ) : docs.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" description="Upload your ID and other documents below." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <DocThumb doc={d} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-medium text-slate-900">{DOC_LABEL.get(d.type) ?? titleCase(d.type)}</p>
                    {d.verified ? (
                      <Badge tone="green">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge tone="amber">
                        <Clock className="h-3 w-3" /> Pending verification
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {d.fileName} · {formatBytes(d.size)} · {formatDate(d.createdAt)}
                    {d.expiryDate && ` · Expires ${formatDate(d.expiryDate)}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" aria-label="View" onClick={() => void openDoc(d, false)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Download" onClick={() => void openDoc(d, true)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t border-slate-100 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Upload className="h-4 w-4" /> Upload a document
          </p>
          <Select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} options={DOC_TYPES} className="h-11" />
          {uploadDoc.isPending ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 py-8 text-sm text-brand-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </div>
          ) : (
            <FileDrop onFiles={onDocFiles} accept="image/*,application/pdf" label="Tap to choose a file" hint="Image or PDF, up to 2 MB" />
          )}
        </div>
      </Card>

      {/* Attendance & gate */}
      <div className={cn('grid grid-cols-1 gap-x-4', attendanceOn && 'md:grid-cols-2')}>
        {attendanceOn && (
          <div>
            <SectionTitle>Attendance · {format(new Date(), 'MMMM')}</SectionTitle>
            <Card className="p-4">
              {attQ.isLoading ? (
                <LoadingState className="py-6" />
              ) : attQ.error || !att ? (
                <ErrorState error={attQ.error} onRetry={() => void attQ.refetch()} className="py-6" />
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
                      <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                        <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" className="stroke-slate-100" />
                        <circle
                          cx="18"
                          cy="18"
                          r="15.9"
                          fill="none"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeDasharray={`${rate ?? 0} 100`}
                          className="stroke-emerald-500"
                        />
                      </svg>
                      <span className="absolute text-lg font-bold text-slate-900">{rate === null ? '—' : `${rate}%`}</span>
                    </div>
                    <div className="grid flex-1 grid-cols-2 gap-2">
                      {(Object.keys(ATT_META) as AttendanceStatus[]).map((s) => (
                        <div key={s} className={cn('rounded-lg px-2.5 py-1.5', ATT_META[s].tone)}>
                          <p className="text-lg font-bold leading-tight">{att.summary[s]}</p>
                          <p className="text-[11px]">{ATT_META[s].label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {att.summary.total} day{att.summary.total === 1 ? '' : 's'} marked this month (as of {formatDate(today(), 'dd MMM')}).
                  </p>
                </>
              )}
            </Card>
          </div>
        )}
        <div>
          <SectionTitle>Gate log · last 10</SectionTitle>
          <Card>
            {gateQ.isLoading ? (
              <LoadingState className="py-6" />
            ) : gateQ.error ? (
              <ErrorState error={gateQ.error} onRetry={() => void gateQ.refetch()} className="py-6" />
            ) : gate.length === 0 ? (
              <EmptyState title="No gate entries yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {gate.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        g.direction === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
                      )}
                    >
                      {g.direction === 'in' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{g.direction === 'in' ? 'Entered' : 'Went out'}</p>
                      {g.note && <p className="truncate text-xs text-slate-500">{g.note}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{formatDateTime(g.time)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Password */}
      <SectionTitle>Security</SectionTitle>
      <Card className="p-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">Change password</p>
            <p className="text-xs text-slate-500">
              You log in with Hosteler ID <span className="font-mono font-semibold text-slate-700">{me.loginId}</span> and your password.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Current password" error={pinErr.current}>
            <PasswordInput autoComplete="current-password" value={pin.current} onChange={(e) => setPin((p) => ({ ...p, current: e.target.value }))} />
          </Field>
          <Field label="New password" error={pinErr.next}>
            <PasswordInput autoComplete="new-password" value={pin.next} onChange={(e) => setPin((p) => ({ ...p, next: e.target.value }))} />
          </Field>
          <Field label="Confirm new password" error={pinErr.confirm}>
            <PasswordInput autoComplete="new-password" value={pin.confirm} onChange={(e) => setPin((p) => ({ ...p, confirm: e.target.value }))} />
          </Field>
        </div>
        {pin.next && (
          <div className="mt-3">
            <PasswordRules password={pin.next} />
          </div>
        )}
        <Button
          className="mt-4 w-full rounded-xl sm:w-auto"
          size="lg"
          onClick={() => void changePassword()}
          loading={savingPin}
          icon={<ShieldCheck className="h-4 w-4" />}
        >
          Update password
        </Button>
        <p className="mt-3 text-xs text-slate-500">Forgot your password? Ask the hostel office to reset it.</p>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit details"
        description="Other details can be updated by the warden."
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={updateProfile.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email" error={formErr.email}>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Guardian phone" required error={formErr.guardianPhone}>
            <Input type="tel" value={form.guardianPhone} onChange={(e) => setForm((f) => ({ ...f, guardianPhone: e.target.value }))} />
          </Field>
          <Field label="Permanent address" required error={formErr.permanentAddress}>
            <Textarea value={form.permanentAddress} onChange={(e) => setForm((f) => ({ ...f, permanentAddress: e.target.value }))} rows={3} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
