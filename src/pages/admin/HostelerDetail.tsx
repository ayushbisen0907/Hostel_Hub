import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { subDays } from 'date-fns'
import {
  ArrowLeft,
  ArrowRightLeft,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  IndianRupee,
  KeyRound,
  LogOut,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  Trash2,
  Upload,
  UserCheck,
  UserX,
} from 'lucide-react'
import { useStore } from '@/store'
import { bedLabel, hostelerDues, invoiceBalance, invoiceStatus, useHostelName, useVacantBeds } from '@/store/selectors'
import type { HDocument, Hosteler, Invoice, PaymentMode } from '@/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  StatusBadge,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, daysBetween, formatBytes, formatDate, formatDateTime, formatMoney, formatMonth, titleCase, toDateKey, today } from '@/lib/utils'
import {
  AcademicFields,
  DOC_TYPE_LABELS,
  DocPreviewModal,
  GuardianFields,
  IdProofFields,
  PAYMENT_MODE_OPTIONS,
  PersonalFields,
  SectionTitle,
  UploadDocModal,
  expiryState,
  randomPin,
  readFile,
  validateGuardian,
  validatePersonal,
  whatsappLink,
  type ProfileErrors,
  type ProfileForm,
  type SetProfile,
} from './_residents'

type Tab = 'overview' | 'fees' | 'documents' | 'attendance' | 'gate' | 'requests'

/* ------------------------------------------------------------------ */
/* Edit modal                                                          */
/* ------------------------------------------------------------------ */

type EditForm = ProfileForm & {
  monthlyRent: string
  securityDeposit: string
  checkInDate: string
  expectedCheckOut: string
  messOpted: boolean
  notes: string
}

function toEditForm(h: Hosteler): EditForm {
  return {
    name: h.name,
    phone: h.phone,
    email: h.email,
    gender: h.gender,
    dob: h.dob,
    photo: h.photo,
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
    monthlyRent: String(h.monthlyRent),
    securityDeposit: String(h.securityDeposit),
    checkInDate: h.checkInDate,
    expectedCheckOut: h.expectedCheckOut ?? '',
    messOpted: h.messOpted,
    notes: h.notes,
  }
}

function EditModal({ open, onClose, h }: { open: boolean; onClose: () => void; h: Hosteler }) {
  const updateHosteler = useStore((s) => s.updateHosteler)
  const [f, setF] = useState<EditForm>(() => toEditForm(h))
  const [errors, setErrors] = useState<ProfileErrors>({})

  useEffect(() => {
    if (open) {
      setF(toEditForm(h))
      setErrors({})
    }
  }, [open, h])

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const setProfile: SetProfile = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const save = () => {
    const e = { ...validatePersonal(f), ...validateGuardian(f) }
    setErrors(e)
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields')
    if (!f.checkInDate) return toast.error('Check-in date is required')
    const { monthlyRent, securityDeposit, expectedCheckOut, ...rest } = f
    updateHosteler(h.id, {
      ...rest,
      name: f.name.trim(),
      monthlyRent: Math.max(0, Number(monthlyRent) || 0),
      securityDeposit: Math.max(0, Number(securityDeposit) || 0),
      expectedCheckOut: expectedCheckOut || null,
    })
    toast.success('Profile updated')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Edit profile"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <SectionTitle>Personal details</SectionTitle>
          <PersonalFields f={f} set={setProfile} errors={errors} />
        </section>
        <section>
          <SectionTitle>Academic / work</SectionTitle>
          <AcademicFields f={f} set={setProfile} />
        </section>
        <section>
          <SectionTitle>Guardian</SectionTitle>
          <GuardianFields f={f} set={setProfile} errors={errors} />
        </section>
        <section>
          <SectionTitle>ID proof</SectionTitle>
          <IdProofFields f={f} set={setProfile} />
        </section>
        <section>
          <SectionTitle>Stay & rent</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Monthly rent">
              <Input type="number" min={0} value={f.monthlyRent} onChange={(e) => set('monthlyRent', e.target.value)} />
            </Field>
            <Field label="Security deposit">
              <Input type="number" min={0} value={f.securityDeposit} onChange={(e) => set('securityDeposit', e.target.value)} />
            </Field>
            <Field label="Check-in date">
              <Input type="date" value={f.checkInDate} onChange={(e) => set('checkInDate', e.target.value)} />
            </Field>
            <Field label="Expected check-out">
              <Input type="date" value={f.expectedCheckOut} onChange={(e) => set('expectedCheckOut', e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Switch checked={f.messOpted} onChange={(v) => set('messOpted', v)} label="Opted for mess" />
          </div>
          <Field label="Notes" className="mt-4">
            <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </section>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Transfer modal                                                      */
/* ------------------------------------------------------------------ */

function TransferModal({ open, onClose, h }: { open: boolean; onClose: () => void; h: Hosteler }) {
  const hostels = useStore((s) => s.hostels)
  const transferBed = useStore((s) => s.transferBed)
  const updateHosteler = useStore((s) => s.updateHosteler)
  const [hostelId, setHostelId] = useState(h.hostelId)
  const [bedId, setBedId] = useState('')
  const [updateRent, setUpdateRent] = useState(false)
  const vacant = useVacantBeds(hostelId)
  const current = useStore((s) => bedLabel(s, h.bedId))

  useEffect(() => {
    if (open) {
      setHostelId(h.hostelId)
      setBedId('')
      setUpdateRent(false)
    }
  }, [open, h.hostelId])

  const selected = vacant.find((v) => v.bed.id === bedId)

  const save = () => {
    if (!selected) return toast.error('Choose a vacant bed')
    const res = transferBed(h.id, selected.bed.id)
    if (!res.ok) return toast.error(res.error ?? 'Transfer failed')
    if (updateRent) updateHosteler(h.id, { monthlyRent: selected.room.rentPerBed })
    toast.success(`Moved to Room ${selected.room.number} · Bed ${selected.bed.label}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Transfer bed"
      description={`Currently: ${current}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!selected}>
            Transfer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hostels.length > 1 && (
          <Field label="Hostel">
            <Select
              value={hostelId}
              options={hostels.map((x) => ({ value: x.id, label: x.name }))}
              onChange={(e) => {
                setHostelId(e.target.value)
                setBedId('')
              }}
            />
          </Field>
        )}
        {vacant.length ? (
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {vacant.map(({ bed, room }) => (
              <button
                key={bed.id}
                type="button"
                onClick={() => setBedId(bed.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition',
                  bedId === bed.id ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <p className="font-semibold text-slate-900">
                  Room {room.number} · {bed.label}
                </p>
                <p className="text-xs text-slate-500">
                  {room.type === 'ac' ? 'AC' : 'Non-AC'} · {formatMoney(room.rentPerBed)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No vacant beds in this hostel.</p>
        )}
        {selected && selected.room.rentPerBed !== h.monthlyRent && (
          <div className="rounded-lg bg-amber-50 px-4 py-3">
            <Switch
              checked={updateRent}
              onChange={setUpdateRent}
              label={`Update monthly rent from ${formatMoney(h.monthlyRent)} to ${formatMoney(selected.room.rentPerBed)}`}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Record payment modal                                                */
/* ------------------------------------------------------------------ */

function PaymentModal({ open, onClose, h, openInvoices }: { open: boolean; onClose: () => void; h: Hosteler; openInvoices: { inv: Invoice; balance: number }[] }) {
  const recordPayment = useStore((s) => s.recordPayment)
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('upi')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    const first = openInvoices[0]
    setInvoiceId(first?.inv.id ?? '')
    setAmount(first ? String(first.balance) : '')
    setMode('upi')
    setReference('')
    setDate(today())
    setNote('')
  }, [open, openInvoices])

  const save = () => {
    const amt = Number(amount)
    if (!(amt > 0)) return toast.error('Enter an amount greater than zero')
    if (!date) return toast.error('Choose a payment date')
    const pay = recordPayment({ invoiceId: invoiceId || null, hostelerId: h.id, amount: amt, mode, reference: reference.trim(), date, note: note.trim() })
    toast.success(`Payment recorded · ${pay.receiptNo}`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      description={h.name}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Record payment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Against invoice">
          <Select
            value={invoiceId}
            placeholder="No invoice (advance / other)"
            options={openInvoices.map(({ inv, balance }) => ({ value: inv.id, label: `${inv.number} · ${formatMonth(inv.month)} · due ${formatMoney(balance)}` }))}
            onChange={(e) => {
              setInvoiceId(e.target.value)
              const o = openInvoices.find((x) => x.inv.id === e.target.value)
              if (o) setAmount(String(o.balance))
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount" required>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={mode} options={PAYMENT_MODE_OPTIONS} onChange={(e) => setMode(e.target.value as PaymentMode)} />
          </Field>
          <Field label="Reference" hint="UTR / cheque no.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-5 py-5 last:border-0">
      <h4 className="mb-4 text-sm font-semibold text-slate-900">{title}</h4>
      {children}
    </div>
  )
}

export default function HostelerDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const h = useStore((s) => s.hostelers.find((x) => x.id === id))
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const invoices = useStore((s) => s.invoices)
  const payments = useStore((s) => s.payments)
  const documents = useStore((s) => s.documents)
  const attendance = useStore((s) => s.attendance)
  const gateLogs = useStore((s) => s.gateLogs)
  const complaints = useStore((s) => s.complaints)
  const leaves = useStore((s) => s.leaves)
  const updateHosteler = useStore((s) => s.updateHosteler)
  const deleteHosteler = useStore((s) => s.deleteHosteler)
  const confirmCheckIn = useStore((s) => s.confirmCheckIn)
  const updateDocument = useStore((s) => s.updateDocument)
  const deleteDocument = useStore((s) => s.deleteDocument)
  const hostelName = useHostelName()

  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [preview, setPreview] = useState<HDocument | null>(null)
  const [pinShown, setPinShown] = useState<string | null>(null)

  const db = useMemo(() => ({ rooms, beds, invoices, payments }), [rooms, beds, invoices, payments])

  const myInvoices = useMemo(
    () =>
      invoices
        .filter((i) => i.hostelerId === id)
        .sort((a, b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt))
        .map((inv) => ({ inv, status: invoiceStatus(db, inv), balance: invoiceBalance(db, inv) })),
    [invoices, id, db],
  )
  const openInvoices = useMemo(() => myInvoices.filter((x) => x.balance > 0), [myInvoices])
  const myPayments = useMemo(
    () => payments.filter((p) => p.hostelerId === id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [payments, id],
  )
  const myDocs = useMemo(() => documents.filter((d) => d.hostelerId === id), [documents, id])
  const since = toDateKey(subDays(new Date(), 29))
  const myAttendance = useMemo(
    () => attendance.filter((a) => a.hostelerId === id && a.date >= since).sort((a, b) => b.date.localeCompare(a.date)),
    [attendance, id, since],
  )
  const myGate = useMemo(() => gateLogs.filter((g) => g.hostelerId === id).sort((a, b) => b.time.localeCompare(a.time)), [gateLogs, id])
  const myComplaints = useMemo(() => complaints.filter((c) => c.hostelerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [complaints, id])
  const myLeaves = useMemo(() => leaves.filter((l) => l.hostelerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [leaves, id])

  if (!h) {
    return (
      <Card>
        <EmptyState
          icon={<UserX className="h-6 w-6" />}
          title="Hosteler not found"
          description="This record may have been deleted."
          action={
            <Link to="/app/hostelers">
              <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />}>
                Back to hostelers
              </Button>
            </Link>
          }
        />
      </Card>
    )
  }

  const dues = hostelerDues(db, h.id)
  const totalPaid = myPayments.reduce((a, p) => a + p.amount, 0)
  const room = h.roomId ? rooms.find((r) => r.id === h.roomId) : undefined
  const daysStayed = h.status === 'active' ? Math.max(daysBetween(h.checkInDate, today()), 0) : h.checkOutDate ? Math.max(daysBetween(h.checkInDate, h.checkOutDate), 0) : 0

  const changePhoto = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file')
    const p = await readFile(file)
    if (!p) return
    updateHosteler(h.id, { photo: p.dataUrl })
    toast.success('Photo updated')
  }

  const doDelete = async () => {
    const ok = await confirm({
      title: `Delete ${h.name}?`,
      message: 'This permanently removes the hosteler with all invoices, payments, documents, attendance and gate records. Prefer "Check out" for residents who are leaving.',
      danger: true,
      confirmText: 'Delete permanently',
    })
    if (!ok) return
    deleteHosteler(h.id)
    toast.success(`${h.name} deleted`)
    navigate('/app/hostelers')
  }

  const doConfirm = async () => {
    const ok = await confirm({ title: 'Confirm check-in?', message: `${h.name} will be marked as checked in today.`, confirmText: 'Confirm check-in' })
    if (!ok) return
    confirmCheckIn(h.id, today())
    toast.success(`${h.name} checked in`)
  }

  const resetPin = async () => {
    const ok = await confirm({ title: 'Reset portal PIN?', message: 'The old PIN will stop working immediately.', confirmText: 'Reset PIN' })
    if (!ok) return
    const pin = randomPin()
    updateHosteler(h.id, { portalPin: pin })
    setPinShown(pin)
  }

  const removeDoc = async (d: HDocument) => {
    const ok = await confirm({ title: 'Delete document?', message: `${DOC_TYPE_LABELS[d.type]} (${d.fileName}) will be removed.`, danger: true, confirmText: 'Delete' })
    if (!ok) return
    deleteDocument(d.id)
    toast.success('Document deleted')
  }

  const attSummary = myAttendance.reduce(
    (acc, a) => {
      acc[a.status]++
      return acc
    },
    { present: 0, absent: 0, leave: 0, late: 0 },
  )

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'fees', label: 'Fees', count: openInvoices.length || undefined },
    { value: 'documents', label: 'Documents', count: myDocs.length },
    { value: 'attendance', label: 'Attendance' },
    { value: 'gate', label: 'Gate log' },
    { value: 'requests', label: 'Complaints & leaves', count: myComplaints.length + myLeaves.length || undefined },
  ]

  return (
    <>
      <Link to="/app/hostelers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All hostelers
      </Link>

      {/* Header card */}
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <label className="group relative shrink-0 cursor-pointer" title="Change photo">
              <Avatar name={h.name} src={h.photo} size="xl" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100">
                <Camera className="h-5 w-5" />
              </span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void changePhoto(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{h.name}</h1>
                <StatusBadge status={h.status} />
                {dues > 0 && <Badge tone="red">Dues {formatMoney(dues)}</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {h.status === 'checked_out' ? `Checked out on ${formatDate(h.checkOutDate)}` : bedLabel(db, h.bedId)} · {hostelName(h.hostelId)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`tel:${h.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Phone className="h-3.5 w-3.5" /> {h.phone}
                </a>
                <a
                  href={whatsappLink(h.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            {h.status === 'reserved' && (
              <Button variant="success" size="sm" icon={<UserCheck className="h-4 w-4" />} onClick={doConfirm}>
                Confirm check-in
              </Button>
            )}
            <Button variant="outline" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {h.status !== 'checked_out' && (
              <Button variant="outline" size="sm" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransferOpen(true)}>
                Transfer bed
              </Button>
            )}
            {h.status === 'active' && (
              <Button variant="outline" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={() => navigate(`/app/check-out?h=${h.id}`)}>
                Check out
              </Button>
            )}
            {h.status !== 'checked_out' && (
              <Button variant="outline" size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={resetPin}>
                Reset portal PIN
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={doDelete}>
              Delete
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Monthly rent</p>
            <p className="font-semibold text-slate-900">{formatMoney(h.monthlyRent)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Outstanding</p>
            <p className={cn('font-semibold', dues > 0 ? 'text-red-600' : 'text-emerald-600')}>{formatMoney(dues)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total paid</p>
            <p className="font-semibold text-slate-900">{formatMoney(totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{h.status === 'reserved' ? 'Expected check-in' : 'Days stayed'}</p>
            <p className="font-semibold text-slate-900">{h.status === 'reserved' ? formatDate(h.checkInDate) : `${daysStayed} days`}</p>
          </div>
        </div>
      </Card>

      <Card>
        <Tabs<Tab> className="px-2" tabs={tabs} value={tab} onChange={setTab} />

        {tab === 'overview' && (
          <div>
            <Section title="Personal">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Full name', value: h.name },
                  { label: 'Phone', value: h.phone },
                  { label: 'Email', value: h.email },
                  { label: 'Gender', value: titleCase(h.gender) },
                  { label: 'Date of birth', value: h.dob ? formatDate(h.dob) : '' },
                  { label: 'Blood group', value: h.bloodGroup },
                  { label: 'Permanent address', value: h.permanentAddress },
                ]}
              />
            </Section>
            <Section title={h.occupation === 'working' ? 'Work' : 'Academic'}>
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Occupation', value: titleCase(h.occupation) },
                  { label: h.occupation === 'working' ? 'Company' : 'Institution', value: h.institution },
                  { label: h.occupation === 'working' ? 'Designation' : 'Course', value: h.course },
                ]}
              />
            </Section>
            <Section title="Guardian">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Name', value: h.guardianName },
                  { label: 'Relation', value: h.guardianRelation },
                  {
                    label: 'Phone',
                    value: h.guardianPhone ? (
                      <a href={`tel:${h.guardianPhone}`} className="text-brand-600 hover:underline">
                        {h.guardianPhone}
                      </a>
                    ) : (
                      ''
                    ),
                  },
                ]}
              />
            </Section>
            <Section title="ID proof">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Type', value: h.idProofType },
                  { label: 'Number', value: h.idProofNumber },
                ]}
              />
            </Section>
            <Section title="Stay & rent">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Hostel', value: hostelName(h.hostelId) },
                  { label: 'Room / bed', value: h.status === 'checked_out' ? '—' : bedLabel(db, h.bedId) },
                  { label: 'Room type', value: room ? `${room.type === 'ac' ? 'AC' : 'Non-AC'} · ${room.sharing} sharing` : '' },
                  { label: 'Check-in date', value: formatDate(h.checkInDate) },
                  { label: 'Expected check-out', value: h.expectedCheckOut ? formatDate(h.expectedCheckOut) : '' },
                  { label: 'Checked out', value: h.checkOutDate ? formatDate(h.checkOutDate) : '' },
                  { label: 'Monthly rent', value: formatMoney(h.monthlyRent) },
                  {
                    label: 'Mess',
                    value: (
                      <Switch
                        checked={h.messOpted}
                        disabled={h.status === 'checked_out'}
                        onChange={(v) => {
                          updateHosteler(h.id, { messOpted: v })
                          toast.success(v ? 'Mess enabled' : 'Mess disabled')
                        }}
                        label={h.messOpted ? 'Opted' : 'Not opted'}
                      />
                    ),
                  },
                  { label: 'Portal PIN', value: <span className="font-mono">{h.portalPin}</span> },
                ]}
              />
            </Section>
            <Section title="Security deposit">
              <DescriptionList
                cols={3}
                items={[
                  { label: 'Deposit amount', value: formatMoney(h.securityDeposit) },
                  {
                    label: 'Collected',
                    value: formatMoney(myPayments.filter((p) => /deposit/i.test(p.note) && !p.invoiceId).reduce((a, p) => a + p.amount, 0)),
                  },
                  { label: 'Refunded', value: h.depositRefunded !== null ? formatMoney(h.depositRefunded) : '' },
                ]}
              />
            </Section>
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{h.notes || <span className="text-slate-400">No notes.</span>}</p>
            </Section>
          </div>
        )}

        {tab === 'fees' && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="text-sm text-slate-600">
                Outstanding <b className={dues > 0 ? 'text-red-600' : 'text-emerald-600'}>{formatMoney(dues)}</b> across {openInvoices.length} invoice(s)
              </div>
              <Button size="sm" icon={<IndianRupee className="h-4 w-4" />} onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            </div>
            <CardHeader title="Invoices" className="border-t" />
            {myInvoices.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Invoice</TH>
                    <TH>Month</TH>
                    <TH>Due date</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Balance</TH>
                    <TH>Status</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {myInvoices.map(({ inv, status, balance }) => (
                    <TR key={inv.id}>
                      <TD className="font-medium text-slate-900">{inv.number}</TD>
                      <TD>{formatMonth(inv.month)}</TD>
                      <TD className="whitespace-nowrap">{formatDate(inv.dueDate)}</TD>
                      <TD className="text-right">{formatMoney(inv.total)}</TD>
                      <TD className={cn('text-right', balance > 0 && 'font-medium text-red-600')}>{formatMoney(balance)}</TD>
                      <TD>
                        <StatusBadge status={status} />
                      </TD>
                      <TD className="text-right">
                        <Link to={`/print/invoice/${inv.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                          <Printer className="h-3.5 w-3.5" /> Invoice
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No invoices yet.</p>
            )}
            <CardHeader title="Payments" className="border-t" />
            {myPayments.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Receipt</TH>
                    <TH>Date</TH>
                    <TH>Mode</TH>
                    <TH>For</TH>
                    <TH className="text-right">Amount</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {myPayments.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-medium text-slate-900">{p.receiptNo}</TD>
                      <TD className="whitespace-nowrap">{formatDate(p.date)}</TD>
                      <TD>
                        {p.mode.toUpperCase()}
                        {p.reference && <p className="text-xs text-slate-400">{p.reference}</p>}
                      </TD>
                      <TD className="text-slate-500">
                        {p.invoiceId ? invoices.find((i) => i.id === p.invoiceId)?.number ?? 'Invoice' : p.note || 'Advance'}
                      </TD>
                      <TD className="text-right font-medium text-emerald-700">{formatMoney(p.amount)}</TD>
                      <TD className="text-right">
                        <Link to={`/print/receipt/${p.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                          <Printer className="h-3.5 w-3.5" /> Receipt
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No payments recorded.</p>
            )}
          </div>
        )}

        {tab === 'documents' && (
          <div>
            <div className="flex items-center justify-between px-5 py-4">
              <p className="text-sm text-slate-600">
                {myDocs.length} document(s) · {myDocs.filter((d) => d.verified).length} verified
              </p>
              <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
                Upload document
              </Button>
            </div>
            {myDocs.length ? (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {myDocs.map((d) => {
                  const ex = expiryState(d.expiryDate)
                  return (
                    <li key={d.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {d.mimeType.startsWith('image/') ? (
                          <img src={d.dataUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <FileText className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{DOC_TYPE_LABELS[d.type]}</p>
                          <p className="truncate text-xs text-slate-500">
                            {d.fileName} · {formatBytes(d.size)} · uploaded {formatDate(d.uploadedAt)}
                            {d.expiryDate && (
                              <span className={cn(ex === 'expired' && 'font-medium text-red-600', ex === 'soon' && 'font-medium text-amber-600')}>
                                {' '}
                                · {ex === 'expired' ? 'expired' : 'expires'} {formatDate(d.expiryDate)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={d.verified}
                          onChange={(v) => {
                            updateDocument(d.id, { verified: v })
                            toast.success(v ? 'Marked verified' : 'Marked unverified')
                          }}
                          label={d.verified ? 'Verified' : 'Unverified'}
                        />
                        <IconButton label="Preview" onClick={() => setPreview(d)}>
                          <Eye className="h-4 w-4" />
                        </IconButton>
                        <a href={d.dataUrl} download={d.fileName} title="Download" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                          <Download className="h-4 w-4" />
                        </a>
                        <IconButton label="Delete" onClick={() => removeDoc(d)} className="hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents" description="Upload Aadhaar, ID cards, police verification and more." />
            )}
          </div>
        )}

        {tab === 'attendance' && (
          <div>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              {(
                [
                  ['present', 'Present', 'text-emerald-600'],
                  ['absent', 'Absent', 'text-red-600'],
                  ['late', 'Late', 'text-amber-600'],
                  ['leave', 'On leave', 'text-violet-600'],
                ] as const
              ).map(([k, label, color]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-4 py-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={cn('text-xl font-bold', color)}>{attSummary[k]}</p>
                </div>
              ))}
            </div>
            <p className="px-5 pb-2 text-xs text-slate-500">Last 30 days</p>
            {myAttendance.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Date</TH>
                    <TH>Day</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <tbody>
                  {myAttendance.map((a) => (
                    <TR key={a.id}>
                      <TD>{formatDate(a.date)}</TD>
                      <TD>{formatDate(a.date, 'EEEE')}</TD>
                      <TD>
                        <StatusBadge status={a.status} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No attendance marked in the last 30 days.</p>
            )}
          </div>
        )}

        {tab === 'gate' &&
          (myGate.length ? (
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Direction</TH>
                  <TH>Note</TH>
                </tr>
              </THead>
              <tbody>
                {myGate.slice(0, 100).map((g) => (
                  <TR key={g.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(g.time)}</TD>
                    <TD>
                      <Badge tone={g.direction === 'in' ? 'green' : 'amber'}>{g.direction === 'in' ? 'IN' : 'OUT'}</Badge>
                    </TD>
                    <TD className="text-slate-500">{g.note || '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No gate entries.</p>
          ))}

        {tab === 'requests' && (
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="border-b border-slate-100 lg:border-b-0 lg:border-r">
              <CardHeader title="Complaints" subtitle={`${myComplaints.length} raised`} />
              {myComplaints.length ? (
                <ul className="divide-y divide-slate-100">
                  {myComplaints.map((c) => (
                    <li key={c.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{c.title}</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {titleCase(c.category)} · {titleCase(c.priority)} priority · {formatDate(c.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No complaints.</p>
              )}
            </div>
            <div>
              <CardHeader title="Leave requests" subtitle={`${myLeaves.length} requests`} />
              {myLeaves.length ? (
                <ul className="divide-y divide-slate-100">
                  {myLeaves.map((l) => (
                    <li key={l.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {formatDate(l.from)} – {formatDate(l.to)}
                        </p>
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {l.reason}
                        {l.destination && ` · ${l.destination}`}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No leave requests.</p>
              )}
            </div>
          </div>
        )}
      </Card>

      <EditModal open={editOpen} onClose={() => setEditOpen(false)} h={h} />
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} h={h} />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} h={h} openInvoices={openInvoices} />
      <UploadDocModal open={uploadOpen} onClose={() => setUploadOpen(false)} hostelerId={h.id} />
      <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />
      <Modal
        open={!!pinShown}
        onClose={() => setPinShown(null)}
        size="sm"
        title="New portal PIN"
        footer={<Button onClick={() => setPinShown(null)}>Done</Button>}
      >
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <p className="text-sm text-slate-600">Share these login details with {h.name}:</p>
          <p className="mt-3 text-sm text-slate-500">Phone</p>
          <p className="font-semibold text-slate-900">{h.phone}</p>
          <p className="mt-2 text-sm text-slate-500">PIN</p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-brand-700">{pinShown}</p>
        </div>
      </Modal>
    </>
  )
}
