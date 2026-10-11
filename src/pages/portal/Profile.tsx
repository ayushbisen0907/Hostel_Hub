import { useMemo, useRef, useState } from 'react'
import { endOfMonth, format, startOfMonth } from 'date-fns'
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
  Pencil,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useStore } from '@/store'
import { bedLabel, useCurrentHosteler } from '@/store/selectors'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Field,
  FileDrop,
  Input,
  Modal,
  Select,
  Textarea,
  toast,
} from '@/components/ui'
import { cn, fileToDataUrl, formatBytes, formatDate, formatDateTime, titleCase, today } from '@/lib/utils'
import type { AttendanceStatus, DocumentType, HDocument } from '@/types'
import { NotLoggedIn, PortalTitle, SectionTitle, useMoney, useScrollToHash } from './_shared'

const MAX_BYTES = 2 * 1024 * 1024

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
    const blob = await (await fetch(doc.dataUrl)).blob()
    const url = URL.createObjectURL(blob)
    if (download) {
      const a = document.createElement('a')
      a.href = url
      a.download = doc.fileName
      a.click()
    } else {
      window.open(url, '_blank', 'noopener')
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    toast.error('Could not open this file')
  }
}

const ATT_META: Record<AttendanceStatus, { label: string; tone: string }> = {
  present: { label: 'Present', tone: 'bg-emerald-50 text-emerald-700' },
  late: { label: 'Late', tone: 'bg-amber-50 text-amber-700' },
  leave: { label: 'On leave', tone: 'bg-violet-50 text-violet-700' },
  absent: { label: 'Absent', tone: 'bg-red-50 text-red-700' },
}

export default function Profile() {
  const me = useCurrentHosteler()
  const hostels = useStore((s) => s.hostels)
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const documents = useStore((s) => s.documents)
  const gateLogs = useStore((s) => s.gateLogs)
  const attendance = useStore((s) => s.attendance)
  const updateHosteler = useStore((s) => s.updateHosteler)
  const addDocument = useStore((s) => s.addDocument)
  const money = useMoney()
  useScrollToHash()

  const photoRef = useRef<HTMLInputElement>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ email: '', permanentAddress: '', guardianPhone: '' })
  const [formErr, setFormErr] = useState<Record<string, string>>({})

  const [docType, setDocType] = useState<DocumentType>('aadhaar')
  const [uploading, setUploading] = useState(false)

  const [pin, setPin] = useState({ current: '', next: '', confirm: '' })
  const [pinErr, setPinErr] = useState<Record<string, string>>({})

  const data = useMemo(() => {
    if (!me) return null
    const myDocs = documents.filter((d) => d.hostelerId === me.id).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    const myGate = gateLogs.filter((g) => g.hostelerId === me.id).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 10)
    const start = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const end = format(endOfMonth(new Date()), 'yyyy-MM-dd')
    const monthAtt = attendance.filter((a) => a.hostelerId === me.id && a.date >= start && a.date <= end)
    const counts: Record<AttendanceStatus, number> = { present: 0, late: 0, leave: 0, absent: 0 }
    for (const a of monthAtt) counts[a.status]++
    const marked = monthAtt.length
    const rate = marked ? Math.round(((counts.present + counts.late) / marked) * 100) : null
    return { myDocs, myGate, counts, marked, rate }
  }, [me, documents, gateLogs, attendance])

  if (!me || !data) return <NotLoggedIn />

  const hostel = hostels.find((h) => h.id === me.hostelId)

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file')
    if (file.size > MAX_BYTES) return toast.error('Photo must be 2 MB or smaller')
    try {
      const url = await fileToDataUrl(file)
      updateHosteler(me.id, { photo: url })
      toast.success('Profile photo updated')
    } catch {
      toast.error('Could not read the image')
    }
  }

  const openEdit = () => {
    setForm({ email: me.email, permanentAddress: me.permanentAddress, guardianPhone: me.guardianPhone })
    setFormErr({})
    setEditOpen(true)
  }

  const saveEdit = () => {
    const e: Record<string, string> = {}
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email'
    const gp = form.guardianPhone.replace(/\D/g, '')
    if (gp.length < 10 || gp.length > 13) e.guardianPhone = 'Enter a valid phone number'
    if (!form.permanentAddress.trim()) e.permanentAddress = 'Address is required'
    setFormErr(e)
    if (Object.keys(e).length) return
    updateHosteler(me.id, {
      email: form.email.trim(),
      permanentAddress: form.permanentAddress.trim(),
      guardianPhone: form.guardianPhone.trim(),
    })
    toast.success('Details updated')
    setEditOpen(false)
  }

  const onDocFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    if (file.size > MAX_BYTES) return toast.error(`${file.name} is larger than 2 MB`)
    const okType = file.type.startsWith('image/') || file.type === 'application/pdf'
    if (!okType) return toast.error('Upload an image or PDF')
    setUploading(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      addDocument({
        hostelerId: me.id,
        type: docType,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl,
        verified: false,
        expiryDate: null,
      })
      toast.success(`${DOC_LABEL.get(docType)} uploaded — pending verification`)
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const changePin = () => {
    const e: Record<string, string> = {}
    if (pin.current !== me.portalPin) e.current = 'Current PIN is incorrect'
    if (!/^\d{4}$/.test(pin.next)) e.next = 'PIN must be exactly 4 digits'
    else if (pin.next === me.portalPin) e.next = 'New PIN must be different'
    if (pin.confirm !== pin.next) e.confirm = "PINs don't match"
    setPinErr(e)
    if (Object.keys(e).length) return
    updateHosteler(me.id, { portalPin: pin.next })
    setPin({ current: '', next: '', confirm: '' })
    toast.success('Portal PIN changed')
  }

  const pinInput = (key: keyof typeof pin) => (
    <Input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
      value={pin[key]}
      onChange={(e) => setPin((p) => ({ ...p, [key]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
      placeholder="••••"
      className="h-11 text-center text-lg tracking-[0.5em]"
    />
  )

  return (
    <div className="pb-4">
      <PortalTitle title="My profile" />

      {/* Profile card */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-brand-600 to-brand-800" />
        <div className="-mt-10 flex flex-col items-center px-4 pb-5 text-center">
          <div className="relative">
            <div className="rounded-full ring-4 ring-white">
              <Avatar name={me.name} src={me.photo} size="xl" />
            </div>
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-brand-600 text-white shadow"
              aria-label="Change photo"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onPhoto(e.target.files?.[0])
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
            <Badge tone="blue">{bedLabel({ rooms, beds }, me.bedId)}</Badge>
            <Badge tone={me.status === 'active' ? 'green' : 'amber'}>{titleCase(me.status)}</Badge>
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
              { label: 'Date of birth', value: formatDate(me.dob) },
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
                { label: 'Room & bed', value: bedLabel({ rooms, beds }, me.bedId) },
                { label: 'Check-in date', value: formatDate(me.checkInDate) },
                { label: 'Expected check-out', value: me.expectedCheckOut ? formatDate(me.expectedCheckOut) : 'Not set' },
                { label: 'Mess', value: me.messOpted ? 'Enrolled' : 'Not enrolled' },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* Documents */}
      <SectionTitle id="documents">My documents</SectionTitle>
      <Card>
        {data.myDocs.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents yet" description="Upload your ID and other documents below." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.myDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500">
                  {d.mimeType.startsWith('image/') ? (
                    <img src={d.dataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
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
                    {d.fileName} · {formatBytes(d.size)} · {formatDate(d.uploadedAt)}
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
          {uploading ? (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-brand-300 py-8 text-sm text-brand-600">
              Uploading…
            </div>
          ) : (
            <FileDrop onFiles={(f) => void onDocFiles(f)} accept="image/*,application/pdf" label="Tap to choose a file" hint="Image or PDF, up to 2 MB" />
          )}
        </div>
      </Card>

      {/* Attendance & gate */}
      <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
        <div>
          <SectionTitle>Attendance · {format(new Date(), 'MMMM')}</SectionTitle>
          <Card className="p-4">
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
                    strokeDasharray={`${data.rate ?? 0} 100`}
                    className="stroke-emerald-500"
                  />
                </svg>
                <span className="absolute text-lg font-bold text-slate-900">{data.rate === null ? '—' : `${data.rate}%`}</span>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2">
                {(Object.keys(ATT_META) as AttendanceStatus[]).map((s) => (
                  <div key={s} className={cn('rounded-lg px-2.5 py-1.5', ATT_META[s].tone)}>
                    <p className="text-lg font-bold leading-tight">{data.counts[s]}</p>
                    <p className="text-[11px]">{ATT_META[s].label}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {data.marked} day{data.marked === 1 ? '' : 's'} marked this month (as of {formatDate(today(), 'dd MMM')}).
            </p>
          </Card>
        </div>
        <div>
          <SectionTitle>Gate log · last 10</SectionTitle>
          <Card>
            {data.myGate.length === 0 ? (
              <EmptyState title="No gate entries yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.myGate.map((g) => (
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

      {/* PIN */}
      <SectionTitle>Security</SectionTitle>
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-slate-900">Change portal PIN</p>
            <p className="text-xs text-slate-500">You log in with your phone number and this 4-digit PIN.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Current PIN" error={pinErr.current}>
            {pinInput('current')}
          </Field>
          <Field label="New PIN" error={pinErr.next}>
            {pinInput('next')}
          </Field>
          <Field label="Confirm new PIN" error={pinErr.confirm}>
            {pinInput('confirm')}
          </Field>
        </div>
        <Button className="mt-4 w-full rounded-xl sm:w-auto" size="lg" onClick={changePin} icon={<ShieldCheck className="h-4 w-4" />}>
          Update PIN
        </Button>
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
            <Button onClick={saveEdit}>Save</Button>
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
