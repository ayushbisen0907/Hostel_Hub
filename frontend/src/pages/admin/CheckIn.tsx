import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  MessageCircle,
  Printer,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { errorMessage } from '@/api/client'
import { useHostels, useOrg, useScope, useSettings } from '@/api/common'
import { useApiMutation } from '@/api/query'
import { useCan } from '@/api/session'
import { useVacantBeds, type VacantBed } from '@/api/rooms'
import { documentsApi } from '@/api/documents'
import { feesApi } from '@/api/fees'
import { HOSTELER_INVALIDATE, hostelersApi, useHostelers, type HostelerRow } from '@/api/hostelers'
import type { DocumentType, ID, PaymentMode } from '@/api/types'
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
  IconButton,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Switch,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatBytes, formatDate, formatMoney, titleCase, today } from '@/lib/utils'
import { electricityText, monthlyBillItems } from '@/lib/charges'
import {
  AcademicFields,
  DOC_TYPE_LABELS,
  DOC_TYPE_OPTIONS,
  GuardianFields,
  HostelerAvatar,
  IdProofFields,
  PAYMENT_MODE_OPTIONS,
  PersonalFields,
  PhotoPicker,
  SectionTitle,
  UPLOAD_ACCEPT,
  UPLOAD_HINT,
  acceptFile,
  bedText,
  cleanPhone,
  copyText,
  emptyProfile,
  portalInviteText,
  portalInviteWhatsApp,
  profileBody,
  validateGuardian,
  validatePersonal,
  type ProfileErrors,
  type ProfileForm,
  type SetProfile,
} from './_residents'

const STEPS = ['Personal', 'Academic & guardian', 'ID & documents', 'Room & bed', 'Rent & payment', 'Review'] as const

interface PendingDoc {
  key: string
  type: DocumentType
  file: File
  preview: string | null
}

interface Done {
  hosteler: HostelerRow
  loginId: string
  tempPassword: string
  reserved: boolean
  receiptId: ID | null
  docsUploaded: number
  failed: string[]
}

function guessDocType(name: string): DocumentType {
  const n = name.toLowerCase()
  if (n.includes('aadhar') || n.includes('aadhaar')) return 'aadhaar'
  if (n.includes('pan')) return 'pan'
  if (n.includes('police')) return 'police_verification'
  if (n.includes('college') || n.includes('student')) return 'college_id'
  if (n.includes('office') || n.includes('employee')) return 'office_id'
  if (n.includes('agreement')) return 'rent_agreement'
  if (n.includes('medical')) return 'medical'
  if (n.includes('photo')) return 'photo'
  return 'other'
}

/** Object URL for a local file (revoked on change/unmount). */
function useLocalPreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return setUrl(null)
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url
}

/* ------------------------------------------------------------------ */
/* Pending reservations                                                */
/* ------------------------------------------------------------------ */

function Reservations() {
  const scope = useScope()
  const q = useHostelers({ status: 'reserved', hostelId: scope, limit: 100 })
  const confirmIn = useApiMutation(hostelersApi.confirmCheckIn, {
    invalidate: HOSTELER_INVALIDATE,
    success: (h) => `${h.name} checked in`,
  })
  const reserved = [...(q.data?.items ?? [])].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
  if (q.error || !reserved.length) return null

  const doConfirm = async (id: ID, name: string) => {
    const ok = await confirm({
      title: `Check in ${name}?`,
      message: 'The reservation will become an active stay starting today.',
      confirmText: 'Confirm check-in',
    })
    if (ok) confirmIn.mutate({ id, date: today() })
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Pending reservations" subtitle={`${q.data?.total ?? reserved.length} resident(s) waiting to move in`} />
      <ul className="divide-y divide-slate-100">
        {reserved.map((h) => (
          <li key={h.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
            <Link to={`/app/hostelers/${h.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <HostelerAvatar h={h} />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{h.name}</p>
                <p className="text-xs text-slate-500">
                  {bedText(h, 'No bed held')} · expected {formatDate(h.checkInDate)}
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {h.checkInDate < today() && <Badge tone="amber">Overdue</Badge>}
              <Button
                size="sm"
                variant="success"
                icon={<UserCheck className="h-4 w-4" />}
                onClick={() => doConfirm(h.id, h.name)}
                loading={confirmIn.isPending && confirmIn.variables?.id === h.id}
                disabled={confirmIn.isPending}
              >
                Confirm check-in
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Step indicator                                                      */
/* ------------------------------------------------------------------ */

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between sm:hidden">
        <p className="text-sm font-semibold text-slate-900">{STEPS[step]}</p>
        <p className="text-xs text-slate-500">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-slate-100 sm:hidden">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <ol className="mb-8 hidden items-center sm:flex">
        {STEPS.map((label, i) => {
          const done = i < step
          const active = i === step
          return (
            <li key={label} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
              <button type="button" disabled={i > step} onClick={() => onJump(i)} className="flex items-center gap-2 disabled:cursor-default">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    done ? 'bg-brand-600 text-white' : active ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-600' : 'bg-slate-100 text-slate-400',
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cn('hidden whitespace-nowrap text-sm font-medium lg:inline', active ? 'text-slate-900' : 'text-slate-500')}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn('mx-3 h-0.5 flex-1 rounded', done ? 'bg-brand-600' : 'bg-slate-200')} />}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CheckIn() {
  const navigate = useNavigate()
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const scope = useScope()
  const hostelsQ = useHostels()
  const hostels = useMemo(() => hostelsQ.data ?? [], [hostelsQ.data])
  const { data: org } = useOrg()
  const settings = useSettings()

  const [step, setStep] = useState(0)
  const [done, setDone] = useState<Done | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile)
  const [photo, setPhoto] = useState<File | null>(null)
  const photoPreview = useLocalPreview(photo)
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [docs, setDocs] = useState<PendingDoc[]>([])
  const [hostelId, setHostelId] = useState<ID>('')
  const [bedId, setBedId] = useState<ID | ''>('')
  const [reserveOnly, setReserveOnly] = useState(false)
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [depTouched, setDepTouched] = useState(false)
  const [collect, setCollect] = useState(true)
  const [depAmount, setDepAmount] = useState('')
  const [depMode, setDepMode] = useState<PaymentMode>('upi')
  const [depRef, setDepRef] = useState('')
  const [messOpted, setMessOpted] = useState(true)
  const [genInvoice, setGenInvoice] = useState(true)
  const [checkInDate, setCheckInDate] = useState(today())
  const [expectedOut, setExpectedOut] = useState('')
  const [notes, setNotes] = useState('')
  const [checkingPhone, setCheckingPhone] = useState(false)

  // default hostel: top-bar scope, else the first one
  useEffect(() => {
    if (!hostelId && hostels.length) setHostelId(scope !== 'all' && hostels.some((h) => h.id === scope) ? scope : hostels[0]!.id)
  }, [hostelId, hostels, scope])

  // default deposit from org settings once loaded
  useEffect(() => {
    if (org && !depTouched) {
      setDeposit(String(org.settings.defaultSecurityDeposit))
      setDepAmount(String(org.settings.defaultSecurityDeposit))
    }
  }, [org, depTouched])

  const hostel = hostels.find((h) => h.id === hostelId)
  // mess: the hostel's own charge if set, else the organization default (same rule as the backend)
  const messCharge = hostel?.charges?.mess && hostel.charges.mess > 0 ? hostel.charges.mess : settings.messMonthlyCharge
  const billItems = monthlyBillItems({ monthlyRent: Number(rent) || 0, messOpted }, hostel?.charges, settings.messMonthlyCharge)
  const firstMonth = billItems.reduce((a, i) => a + i.amount, 0)
  // electricity is metered: units entered each month (Rooms & Beds → Electricity) × the hostel's rate
  const elecRate = hostel?.electricityRate ?? 0
  const elecNote = elecRate > 0 ? `As per meter (₹${elecRate.toLocaleString('en-IN')}/unit)` : null
  const nextLoginId = hostel ? `${hostel.code}-${String(hostel.hostelerSeq + 1).padStart(4, '0')}` : '—'

  const vacantQ = useVacantBeds(hostelId || 'all', !!hostelId)
  const vacant = useMemo(() => vacantQ.data ?? [], [vacantQ.data])

  // ?bed= preselect (looked up across all hostels)
  const bedParam = params.get('bed')
  const allVacantQ = useVacantBeds('all', !!bedParam)
  useEffect(() => {
    if (!bedParam || !allVacantQ.data) return
    const b = allVacantQ.data.find((x) => x.id === bedParam)
    if (!b) {
      toast.error('That bed is no longer vacant')
      return
    }
    setHostelId(b.hostelId)
    setBedId(b.id)
    setRent(String(b.room.rentPerBed))
  }, [bedParam, allVacantQ.data])

  const grouped = useMemo(() => {
    const m = new Map<ID, { room: VacantBed['room']; beds: { id: ID; label: string }[] }>()
    for (const b of vacant) {
      const g = m.get(b.roomId) ?? { room: b.room, beds: [] }
      g.beds.push({ id: b.id, label: b.label })
      m.set(b.roomId, g)
    }
    return [...m.values()]
  }, [vacant])

  const selected = vacant.find((v) => v.id === bedId)
  const depositNum = Math.max(0, Number(deposit) || 0)

  const set: SetProfile = (k, v) => {
    setProfile((p) => ({ ...p, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const pickBed = (id: ID, room: VacantBed['room']) => {
    setBedId(id)
    setRent(String(room.rentPerBed))
  }

  const fail = (msg: string) => {
    toast.error(msg)
    return false
  }

  const validate = (s: number): boolean => {
    if (s === 0) {
      const e = validatePersonal(profile)
      setErrors(e)
      if (Object.keys(e).length) return fail('Please fill the required details')
    }
    if (s === 1) {
      const e = validateGuardian(profile)
      setErrors(e)
      if (Object.keys(e).length) return fail('Guardian name and phone are required')
    }
    if (s === 3) {
      if (!hostelId) return fail('Choose a hostel')
      if (!reserveOnly && !selected) return fail('Select a vacant bed, or choose "Reserve only"')
    }
    if (s === 4) {
      if (rent === '' || !(Number(rent) >= 0)) return fail('Enter the monthly rent')
      if (!checkInDate) return fail('Choose a check-in date')
      if (expectedOut && expectedOut <= checkInDate) return fail('Expected check-out must be after check-in')
      if (collect && !(Number(depAmount) > 0)) return fail('Enter the deposit amount collected')
    }
    return true
  }

  /** Warn (server-side search) if a current resident already uses this phone. */
  const phoneInUse = async (): Promise<boolean> => {
    const phone = cleanPhone(profile.phone)
    setCheckingPhone(true)
    try {
      const r = await hostelersApi.list({ q: phone, limit: 5 })
      const clash = r.items.find((h) => cleanPhone(h.phone) === phone)
      if (clash) {
        setErrors((e) => ({
          ...e,
          phone: `${clash.name} (${clash.loginId}) already uses this number`,
        }))
        toast.error('A current resident already uses this number')
        return true
      }
    } catch {
      // the check is a convenience; don't block admission if it fails
    } finally {
      setCheckingPhone(false)
    }
    return false
  }

  const next = async () => {
    if (!validate(step)) return
    if (step === 0 && (await phoneInUse())) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const addFiles = (files: File[]) => {
    const out: PendingDoc[] = []
    for (const f of files) {
      if (!acceptFile(f)) continue
      out.push({
        key: `${Date.now()}-${Math.random()}`,
        type: guessDocType(f.name),
        file: f,
        preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      })
    }
    if (out.length) setDocs((d) => [...d, ...out])
  }
  const removeDoc = (key: string) =>
    setDocs((all) => {
      const d = all.find((x) => x.key === key)
      if (d?.preview) URL.revokeObjectURL(d.preview)
      return all.filter((x) => x.key !== key)
    })

  const admit = useApiMutation(hostelersApi.admit, {
    invalidate: HOSTELER_INVALIDATE,
  })

  const submit = async () => {
    for (let i = 0; i < 5; i++) {
      if (!validate(i)) {
        setStep(i)
        return
      }
    }
    const depositPayment = collect && Number(depAmount) > 0 ? { amount: Number(depAmount), mode: depMode, reference: depRef.trim() } : null
    let res: Awaited<ReturnType<typeof hostelersApi.admit>>
    try {
      setSaving(reserveOnly ? 'Reserving…' : 'Checking in…')
      res = await admit.mutateAsync({
        ...profileBody(profile),
        hostelId,
        bedId: (reserveOnly ? selected?.id : selected!.id) ?? null,
        reserveOnly,
        checkInDate,
        expectedCheckOut: expectedOut || null,
        monthlyRent: Number(rent) || 0,
        securityDeposit: depositNum,
        messOpted,
        notes: notes.trim(),
        depositPayment,
        generateFirstInvoice: genInvoice && !reserveOnly,
      })
    } catch {
      setSaving(null)
      return // error already toasted by useApiMutation
    }

    const id = res.hosteler.id
    const failed: string[] = []
    let hosteler = res.hosteler
    if (photo) {
      setSaving('Uploading photo…')
      try {
        hosteler = (await hostelersApi.uploadPhoto({ id, file: photo })).hosteler
      } catch (e) {
        failed.push(`Photo: ${errorMessage(e)}`)
      }
    }
    let docsUploaded = 0
    for (const [i, d] of docs.entries()) {
      setSaving(`Uploading documents (${i + 1}/${docs.length})…`)
      try {
        await documentsApi.upload({
          file: d.file,
          hostelerId: id,
          type: d.type,
        })
        docsUploaded++
      } catch (e) {
        failed.push(`${d.file.name}: ${errorMessage(e)}`)
      }
    }
    let receiptId: ID | null = null
    if (depositPayment && can('fees')) {
      try {
        receiptId =
          (
            await feesApi.payments({
              hostelerId: id,
              kind: 'deposit',
              limit: 1,
            })
          ).items[0]?.id ?? null
      } catch {
        receiptId = null
      }
    }
    setSaving(null)
    for (const d of docs) if (d.preview) URL.revokeObjectURL(d.preview)
    setDone({
      hosteler,
      loginId: res.credentials.loginId,
      tempPassword: res.credentials.tempPassword,
      reserved: reserveOnly,
      receiptId,
      docsUploaded,
      failed,
    })
    toast.success(reserveOnly ? `Bed reserved for ${hosteler.name}` : `${hosteler.name} checked in`)
    if (failed.length) toast.error(`${failed.length} upload(s) failed — add them from the profile`)
    if (params.get('bed')) setParams({}, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const reset = () => {
    setDone(null)
    setStep(0)
    setProfile(emptyProfile())
    setPhoto(null)
    setErrors({})
    setDocs([])
    setBedId('')
    setReserveOnly(false)
    setRent('')
    setDepTouched(false)
    setDeposit(String(settings.defaultSecurityDeposit))
    setCollect(true)
    setDepAmount(String(settings.defaultSecurityDeposit))
    setDepMode('upi')
    setDepRef('')
    setMessOpted(true)
    setGenInvoice(true)
    setCheckInDate(today())
    setExpectedOut('')
    setNotes('')
    admit.reset()
  }

  if (hostelsQ.isLoading) return <LoadingState />
  if (hostelsQ.error) return <ErrorState error={hostelsQ.error} onRetry={() => void hostelsQ.refetch()} />

  if (!hostels.length) {
    return (
      <>
        <PageHeader title="New check-in" />
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Set up a hostel first"
            description="Add a hostel and its rooms before admitting residents."
            action={
              <Link to="/app/settings?tab=hostels">
                <Button>Add hostel</Button>
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  /* ---------------- success screen ---------------- */
  if (done) {
    const h = done.hosteler
    const invite = {
      name: h.name,
      phone: h.phone,
      loginId: done.loginId,
      tempPassword: done.tempPassword,
      hostelName: h.hostelName ?? hostel?.name ?? 'the hostel',
    }
    return (
      <>
        <PageHeader title={done.reserved ? 'Bed reserved' : 'Check-in complete'} />
        <Card className="mx-auto max-w-2xl p-6 sm:p-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{done.reserved ? `${h.name}'s bed is reserved` : `Welcome, ${h.name}!`}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {bedText(h, done.reserved ? 'No bed held' : 'Not allotted')} · {h.hostelName ?? '—'}
            </p>
          </div>
          <div className="mt-6 rounded-xl border border-slate-200 p-5">
            <DescriptionList
              items={[
                {
                  label: 'Status',
                  value: done.reserved ? 'Reserved – check in later' : 'Checked in',
                },
                {
                  label: done.reserved ? 'Expected check-in' : 'Check-in date',
                  value: formatDate(h.checkInDate),
                },
                { label: 'Monthly rent', value: formatMoney(h.monthlyRent) },
                {
                  label: 'Security deposit',
                  value: formatMoney(h.securityDeposit),
                },
                {
                  label: 'Deposit collected',
                  value: collect ? `${formatMoney(Number(depAmount) || 0)} (${depMode.toUpperCase()})` : 'Not yet',
                },
                {
                  label: 'Documents uploaded',
                  value: String(done.docsUploaded),
                },
              ]}
            />
          </div>
          {done.failed.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Some uploads failed
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {done.failed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">You can upload them again from the resident's profile.</p>
            </div>
          )}
          <div className="mt-4 rounded-xl bg-brand-50 p-4 sm:p-5">
            <p className="text-sm font-semibold text-brand-900">Hosteler portal login</p>
            <p className="mt-1 text-xs text-brand-700">
              Send these to {h.name.split(' ')[0]}. On first login they'll be asked to create their own password, and the temporary one stops working. This
              password is shown only once.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white px-3 py-2.5">
                <p className="text-xs text-slate-500">Hosteler ID</p>
                <p className="font-mono text-xl font-bold tracking-wide text-slate-900">{done.loginId}</p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2.5">
                <p className="text-xs text-slate-500">Temporary password</p>
                <p className="font-mono text-xl font-bold tracking-wide text-brand-700">{done.tempPassword}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <a href={portalInviteWhatsApp(invite)} target="_blank" rel="noreferrer" className="flex-1">
                <Button variant="success" icon={<MessageCircle className="h-4 w-4" />} className="w-full">
                  Send login on WhatsApp
                </Button>
              </a>
              <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => void copyText(portalInviteText(invite), 'Login details copied')}>
                Copy message
              </Button>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => navigate(`/app/hostelers/${h.id}`)}>
              View profile
            </Button>
            {done.receiptId && (
              <Link to={`/print/receipt/${done.receiptId}`} target="_blank">
                <Button variant="outline" icon={<Printer className="h-4 w-4" />} className="w-full">
                  Print receipt
                </Button>
              </Link>
            )}
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={reset}>
              Check in another
            </Button>
          </div>
        </Card>
      </>
    )
  }

  /* ---------------- wizard ---------------- */
  let body: ReactNode = null
  if (step === 0) {
    body = (
      <>
        <SectionTitle hint="Basic details of the resident.">Personal details</SectionTitle>
        <PersonalFields
          f={profile}
          set={set}
          errors={errors}
          photo={<PhotoPicker name={profile.name} src={photoPreview} onPick={setPhoto} onRemove={() => setPhoto(null)} />}
        />
      </>
    )
  } else if (step === 1) {
    body = (
      <div className="space-y-6">
        <section>
          <SectionTitle>Academic / work</SectionTitle>
          <AcademicFields f={profile} set={set} />
        </section>
        <section>
          <SectionTitle hint="Contacted in emergencies and for fee reminders.">Guardian</SectionTitle>
          <GuardianFields f={profile} set={set} errors={errors} />
        </section>
      </div>
    )
  } else if (step === 2) {
    body = (
      <div className="space-y-6">
        <section>
          <SectionTitle>ID proof</SectionTitle>
          <IdProofFields f={profile} set={set} />
        </section>
        {can('documents') && (
          <section>
            <SectionTitle hint="Aadhaar, college/office ID, police verification… They're uploaded right after admission.">Documents</SectionTitle>
            <FileDrop multiple accept={UPLOAD_ACCEPT} onFiles={addFiles} hint={`${UPLOAD_HINT} each`} />
            {docs.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {docs.map((d) => (
                  <li key={d.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {d.preview ? (
                        <img src={d.preview} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                      ) : (
                        <FileText className="h-9 w-9 shrink-0 rounded bg-slate-100 p-2 text-slate-500" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{d.file.name}</p>
                        <p className="text-xs text-slate-500">{formatBytes(d.file.size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        className="h-9 sm:w-52"
                        value={d.type}
                        options={DOC_TYPE_OPTIONS}
                        onChange={(e) => setDocs((all) => all.map((x) => (x.key === d.key ? { ...x, type: e.target.value as DocumentType } : x)))}
                      />
                      <IconButton label="Remove" onClick={() => removeDoc(d.key)} className="hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    )
  } else if (step === 3) {
    body = (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hostel" required>
            <Select
              value={hostelId}
              options={hostels.map((h) => ({
                value: h.id,
                label: `${h.name} (${titleCase(h.type)})`,
              }))}
              onChange={(e) => {
                setHostelId(e.target.value)
                setBedId('')
              }}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={reserveOnly} onChange={setReserveOnly} label="Reserve only, check in later" />
          </div>
        </div>
        {reserveOnly && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The resident will be saved as <b>reserved</b>. Picking a bed below holds it for them (optional). Confirm the check-in when they arrive.
          </p>
        )}
        {vacantQ.isLoading ? (
          <LoadingState label="Finding vacant beds…" className="py-10" />
        ) : vacantQ.error ? (
          <ErrorState error={vacantQ.error} onRetry={() => void vacantQ.refetch()} className="py-10" />
        ) : grouped.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.map(({ room, beds }) => (
              <div
                key={room.id}
                className={cn('rounded-xl border p-3', beds.some((b) => b.id === bedId) ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200')}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-slate-900">Room {room.number}</p>
                  <p className="text-sm font-medium text-slate-700">{formatMoney(room.rentPerBed)}</p>
                </div>
                <p className="mb-2 text-xs text-slate-500">
                  Floor {room.floor} · {room.type === 'ac' ? 'AC' : 'Non-AC'} · {room.sharing} sharing
                </p>
                <div className="flex flex-wrap gap-2">
                  {beds.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => (bedId === b.id && reserveOnly ? setBedId('') : pickBed(b.id, room))}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                        bedId === b.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                      )}
                    >
                      <BedDouble className="h-3.5 w-3.5" /> Bed {b.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="text-sm text-slate-600">No vacant beds in {hostel?.name ?? 'this hostel'}.</p>
            <p className="mt-1 text-xs text-slate-500">
              {can('rooms') ? (
                <>
                  Add rooms in{' '}
                  <Link to="/app/rooms" className="text-brand-600 hover:underline">
                    Rooms & beds
                  </Link>
                  , or reserve without a bed.
                </>
              ) : (
                'Reserve without a bed, or ask a manager to add rooms.'
              )}
            </p>
          </div>
        )}
      </div>
    )
  } else if (step === 4) {
    body = (
      <div className="space-y-6">
        <section>
          <SectionTitle>Stay & rent</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Monthly rent" required hint={selected ? `Room rate ${formatMoney(selected.room.rentPerBed)}` : undefined}>
              <Input type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} />
            </Field>
            <Field label="Security deposit">
              <Input
                type="number"
                min={0}
                value={deposit}
                onChange={(e) => {
                  setDepTouched(true)
                  setDeposit(e.target.value)
                  setDepAmount(e.target.value)
                }}
              />
            </Field>
            <Field label={reserveOnly ? 'Expected check-in date' : 'Check-in date'} required>
              <Input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
            </Field>
            <Field label="Expected check-out" hint="Optional">
              <Input type="date" value={expectedOut} min={checkInDate} onChange={(e) => setExpectedOut(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Switch
              checked={messOpted}
              onChange={setMessOpted}
              label={messCharge > 0 ? `Opt for mess (${formatMoney(messCharge)}/month)` : 'Opt for mess (no mess charge set)'}
            />
            <Switch
              checked={genInvoice && !reserveOnly}
              disabled={reserveOnly}
              onChange={setGenInvoice}
              label={reserveOnly ? 'First invoice is generated at check-in' : 'Generate first month invoice now'}
            />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">{reserveOnly ? 'Monthly bill (estimate)' : 'First month’s bill (estimate)'}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {billItems.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 text-slate-600">
                  <span className="min-w-0 truncate">{it.label}</span>
                  <span className="tabular-nums text-slate-800">{formatMoney(it.amount)}</span>
                </li>
              ))}
              {elecNote && (
                <li className="flex justify-between gap-3 text-slate-600">
                  <span className="min-w-0 truncate">Electricity</span>
                  <span className="text-right text-slate-800">{elecNote}</span>
                </li>
              )}
              <li className="flex justify-between gap-3 border-t border-slate-200 pt-1.5 font-semibold text-slate-900">
                <span>{elecNote ? 'Total per month + electricity' : 'Total per month'}</span>
                <span className="tabular-nums">{formatMoney(firstMonth)}</span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Rent{messOpted ? ' and mess' : ''} (rent includes water, Wi-Fi, cleaning and maintenance).
              {elecNote
                ? ` Electricity is added each month from the meter reading (${electricityText(elecRate, hostel?.electricityBasis)}${hostel?.electricityBasis === 'bed' ? '' : ', split equally among the room'}).`
                : ''}{' '}
              Deposit is collected separately.
            </p>
          </div>
        </section>
        <section>
          <SectionTitle>Deposit payment</SectionTitle>
          <Switch
            checked={collect}
            onChange={(v) => {
              setCollect(v)
              setDepTouched(true)
            }}
            label="Collect security deposit now"
          />
          {collect && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Amount received" required>
                <Input
                  type="number"
                  min={1}
                  value={depAmount}
                  onChange={(e) => {
                    setDepTouched(true)
                    setDepAmount(e.target.value)
                  }}
                />
              </Field>
              <Field label="Mode">
                <Select value={depMode} options={PAYMENT_MODE_OPTIONS} onChange={(e) => setDepMode(e.target.value as PaymentMode)} />
              </Field>
              <Field label="Reference" hint="UTR / txn id">
                <Input value={depRef} maxLength={100} onChange={(e) => setDepRef(e.target.value)} />
              </Field>
            </div>
          )}
        </section>
        <section>
          <SectionTitle hint="Created automatically when you confirm. You'll get them on the next screen to share on WhatsApp.">Portal access</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs text-slate-500">Hosteler ID (expected)</p>
              <p className="font-mono text-lg font-bold tracking-wide text-slate-900">{nextLoginId}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs text-slate-500">Password</p>
              <p className="text-sm font-medium text-slate-700">Temporary password, auto-generated</p>
            </div>
          </div>
        </section>
        <Field label="Notes">
          <Textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the warden should know" />
        </Field>
      </div>
    )
  } else {
    body = (
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.name || '?'} src={photoPreview} size="lg" />
          <div>
            <p className="text-lg font-bold text-slate-900">{profile.name}</p>
            <p className="text-sm text-slate-500">
              {profile.phone}
              {profile.email && ` · ${profile.email}`}
            </p>
          </div>
        </div>
        <ReviewBlock title="Personal" onEdit={() => setStep(0)}>
          <DescriptionList
            cols={3}
            items={[
              { label: 'Gender', value: titleCase(profile.gender) },
              {
                label: 'Date of birth',
                value: profile.dob ? formatDate(profile.dob) : '',
              },
              { label: 'Blood group', value: profile.bloodGroup },
              { label: 'Address', value: profile.permanentAddress },
            ]}
          />
        </ReviewBlock>
        <ReviewBlock title="Academic / work & guardian" onEdit={() => setStep(1)}>
          <DescriptionList
            cols={3}
            items={[
              { label: 'Occupation', value: titleCase(profile.occupation) },
              {
                label: profile.occupation === 'working' ? 'Company' : 'Institution',
                value: profile.institution,
              },
              {
                label: profile.occupation === 'working' ? 'Designation' : 'Course',
                value: profile.course,
              },
              {
                label: 'Guardian',
                value: `${profile.guardianName} (${profile.guardianRelation})`,
              },
              { label: 'Guardian phone', value: profile.guardianPhone },
            ]}
          />
        </ReviewBlock>
        <ReviewBlock title="ID & documents" onEdit={() => setStep(2)}>
          <DescriptionList
            cols={3}
            items={[
              {
                label: 'ID proof',
                value: profile.idProofNumber ? `${profile.idProofType} · ${profile.idProofNumber}` : '',
              },
              { label: 'Photo', value: photo ? 'Added' : 'None' },
              {
                label: 'Documents',
                value: docs.length ? docs.map((d) => DOC_TYPE_LABELS[d.type]).join(', ') : 'None',
              },
            ]}
          />
        </ReviewBlock>
        <ReviewBlock title="Room & payment" onEdit={() => setStep(3)}>
          <DescriptionList
            cols={3}
            items={[
              { label: 'Hostel', value: hostel?.name ?? '' },
              {
                label: 'Bed',
                value: selected ? `Room ${selected.room.number} · Bed ${selected.label}` : 'Not allotted',
              },
              {
                label: 'Type',
                value: reserveOnly ? <Badge tone="amber">Reservation</Badge> : <Badge tone="green">Check in now</Badge>,
              },
              {
                label: reserveOnly ? 'Expected check-in' : 'Check-in date',
                value: formatDate(checkInDate),
              },
              { label: 'Monthly rent', value: formatMoney(Number(rent) || 0) },
              {
                label: 'Mess',
                value: messOpted ? `Yes (${formatMoney(messCharge)})` : 'No',
              },
              { label: 'Security deposit', value: formatMoney(depositNum) },
              {
                label: 'Collected now',
                value: collect ? `${formatMoney(Number(depAmount) || 0)} via ${depMode.toUpperCase()}` : 'No',
              },
              {
                label: 'First invoice',
                value:
                  genInvoice && !reserveOnly
                    ? `${formatMoney(firstMonth)} (${billItems.map((i) => `${i.label} ${formatMoney(i.amount)}`).join(' + ')})${elecNote ? ' + electricity as per meter' : ''}`
                    : 'Not generated',
              },
            ]}
          />
        </ReviewBlock>
      </div>
    )
  }

  const busy = !!saving
  return (
    <>
      <PageHeader title="New check-in" subtitle="Admit a resident in a few steps." />
      <Reservations />
      <Card className="p-5 sm:p-6">
        <Stepper step={step} onJump={(i) => !busy && setStep(i)} />
        <div className="min-h-[18rem]">{body}</div>
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />} onClick={back} disabled={step === 0 || busy}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => void next()} loading={checkingPhone}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="success"
              icon={reserveOnly ? <Clock className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              onClick={() => void submit()}
              loading={busy}
            >
              {saving ?? (reserveOnly ? 'Confirm reservation' : 'Confirm check-in')}
            </Button>
          )}
        </div>
      </Card>
    </>
  )
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <button type="button" onClick={onEdit} className="text-xs font-medium text-brand-600 hover:underline">
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}
