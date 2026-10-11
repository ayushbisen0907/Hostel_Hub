import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Printer,
  RefreshCw,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { useStore } from '@/store'
import { bedLabel, useHostelName, useScope, useScopedHostelers, useVacantBeds } from '@/store/selectors'
import type { DocumentType, ID, PaymentMode, Room } from '@/types'
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
  IconButton,
  Input,
  PageHeader,
  Select,
  Switch,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatBytes, formatDate, formatMoney, titleCase, today } from '@/lib/utils'
import {
  AcademicFields,
  DOC_TYPE_LABELS,
  DOC_TYPE_OPTIONS,
  GuardianFields,
  IdProofFields,
  PAYMENT_MODE_OPTIONS,
  PersonalFields,
  SectionTitle,
  emptyProfile,
  randomPin,
  readFile,
  validateGuardian,
  validatePersonal,
  type FilePayload,
  type ProfileErrors,
  type ProfileForm,
  type SetProfile,
} from './_residents'

const STEPS = ['Personal', 'Academic & guardian', 'ID & documents', 'Room & bed', 'Rent & payment', 'Review'] as const

interface PendingDoc {
  key: string
  type: DocumentType
  file: FilePayload
}

interface Done {
  hostelerId: ID
  name: string
  phone: string
  pin: string
  bed: string
  reserved: boolean
  receiptId: ID | null
  docs: number
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

/* ------------------------------------------------------------------ */
/* Pending reservations                                                */
/* ------------------------------------------------------------------ */

function Reservations() {
  const hostelers = useScopedHostelers()
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const confirmCheckIn = useStore((s) => s.confirmCheckIn)
  const reserved = hostelers.filter((h) => h.status === 'reserved').sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
  if (!reserved.length) return null

  const doConfirm = async (id: ID, name: string) => {
    const ok = await confirm({ title: `Check in ${name}?`, message: 'The reservation will become an active stay starting today.', confirmText: 'Confirm check-in' })
    if (!ok) return
    confirmCheckIn(id, today())
    toast.success(`${name} checked in`)
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Pending reservations" subtitle={`${reserved.length} resident(s) waiting to move in`} />
      <ul className="divide-y divide-slate-100">
        {reserved.map((h) => (
          <li key={h.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
            <Link to={`/app/hostelers/${h.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={h.name} src={h.photo} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{h.name}</p>
                <p className="text-xs text-slate-500">
                  {bedLabel({ rooms, beds }, h.bedId)} · expected {formatDate(h.checkInDate)}
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {h.checkInDate < today() && <Badge tone="amber">Overdue</Badge>}
              <Button size="sm" variant="success" icon={<UserCheck className="h-4 w-4" />} onClick={() => doConfirm(h.id, h.name)}>
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
              <button
                type="button"
                disabled={i > step}
                onClick={() => onJump(i)}
                className="flex items-center gap-2 disabled:cursor-default"
              >
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
  const [params, setParams] = useSearchParams()
  const scope = useScope()
  const hostels = useStore((s) => s.hostels)
  const settings = useStore((s) => s.settings)
  const allBeds = useStore((s) => s.beds)
  const allRooms = useStore((s) => s.rooms)
  const hostelers = useStore((s) => s.hostelers)
  const admitHosteler = useStore((s) => s.admitHosteler)
  const addDocument = useStore((s) => s.addDocument)
  const hostelName = useHostelName()

  const defaultHostel = scope !== 'all' ? scope : hostels[0]?.id ?? ''

  const [step, setStep] = useState(0)
  const [done, setDone] = useState<Done | null>(null)
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile)
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [docs, setDocs] = useState<PendingDoc[]>([])
  const [hostelId, setHostelId] = useState<ID>(defaultHostel)
  const [bedId, setBedId] = useState<ID | ''>('')
  const [reserveOnly, setReserveOnly] = useState(false)
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState(String(settings.defaultSecurityDeposit))
  const [collect, setCollect] = useState(true)
  const [depAmount, setDepAmount] = useState(String(settings.defaultSecurityDeposit))
  const [depMode, setDepMode] = useState<PaymentMode>('upi')
  const [depRef, setDepRef] = useState('')
  const [messOpted, setMessOpted] = useState(false)
  const [genInvoice, setGenInvoice] = useState(true)
  const [checkInDate, setCheckInDate] = useState(today())
  const [expectedOut, setExpectedOut] = useState('')
  const [pin, setPin] = useState(randomPin)
  const [notes, setNotes] = useState('')

  const vacant = useVacantBeds(hostelId || 'all')

  // ?bed= preselect
  const bedParam = params.get('bed')
  useEffect(() => {
    if (!bedParam) return
    const bed = allBeds.find((b) => b.id === bedParam)
    const room = bed && allRooms.find((r) => r.id === bed.roomId)
    if (!bed || !room) return
    if (bed.hostelerId) {
      toast.error('That bed is no longer vacant')
      return
    }
    setHostelId(bed.hostelId)
    setBedId(bed.id)
    setRent(String(room.rentPerBed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bedParam])

  useEffect(() => {
    if (!hostelId && hostels[0]) setHostelId(hostels[0].id)
  }, [hostelId, hostels])

  const grouped = useMemo(() => {
    const m = new Map<ID, { room: Room; beds: { id: ID; label: string }[] }>()
    for (const { bed, room } of vacant) {
      const g = m.get(room.id) ?? { room, beds: [] }
      g.beds.push({ id: bed.id, label: bed.label })
      m.set(room.id, g)
    }
    return [...m.values()]
  }, [vacant])

  const selected = vacant.find((v) => v.bed.id === bedId)
  const depositNum = Math.max(0, Number(deposit) || 0)

  const set: SetProfile = (k, v) => {
    setProfile((p) => ({ ...p, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const pickBed = (id: ID, room: Room) => {
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
      const phone = profile.phone.replace(/\D/g, '')
      if (!e.phone && hostelers.some((h) => h.status !== 'checked_out' && h.phone.replace(/\D/g, '').endsWith(phone)))
        e.phone = 'A current resident already uses this number'
      setErrors(e)
      if (Object.keys(e).length) {
        toast.error('Please fill the required details')
        return false
      }
    }
    if (s === 1) {
      const e = validateGuardian(profile)
      setErrors(e)
      if (Object.keys(e).length) {
        toast.error('Guardian name and phone are required')
        return false
      }
    }
    if (s === 3) {
      if (!hostelId) return fail('Choose a hostel')
      if (!reserveOnly && !selected) return fail('Select a vacant bed, or choose "Reserve only"')
    }
    if (s === 4) {
      if (!(Number(rent) >= 0) || rent === '') return fail('Enter the monthly rent')
      if (!checkInDate) return fail('Choose a check-in date')
      if (expectedOut && expectedOut <= checkInDate) return fail('Expected check-out must be after check-in')
      if (collect && !(Number(depAmount) > 0)) return fail('Enter the deposit amount collected')
    }
    return true
  }

  const next = () => {
    if (!validate(step)) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const addFiles = async (files: File[]) => {
    const out: PendingDoc[] = []
    for (const f of files) {
      const p = await readFile(f)
      if (p) out.push({ key: `${Date.now()}-${Math.random()}`, type: guessDocType(f.name), file: p })
    }
    if (out.length) setDocs((d) => [...d, ...out])
  }

  const submit = () => {
    for (let i = 0; i < 5; i++) {
      if (!validate(i)) {
        setStep(i)
        return
      }
    }
    const bed = reserveOnly ? (selected?.bed.id ?? null) : selected!.bed.id
    const id = admitHosteler({
      hosteler: {
        ...profile,
        name: profile.name.trim(),
        email: profile.email.trim(),
        hostelId,
        checkInDate,
        expectedCheckOut: expectedOut || null,
        monthlyRent: Number(rent) || 0,
        securityDeposit: depositNum,
        messOpted,
        portalPin: pin,
        notes: notes.trim(),
      },
      bedId: bed,
      reserveOnly,
      depositPayment: collect && Number(depAmount) > 0 ? { amount: Number(depAmount), mode: depMode, reference: depRef.trim() } : null,
      generateFirstInvoice: genInvoice && !reserveOnly,
    })
    for (const d of docs) {
      addDocument({ hostelerId: id, type: d.type, ...d.file, verified: false, expiryDate: null })
    }
    const st = useStore.getState()
    const pay = st.payments.find((p) => p.hostelerId === id) ?? null
    setDone({
      hostelerId: id,
      name: profile.name.trim(),
      phone: profile.phone,
      pin,
      bed: bedLabel(st, st.hostelers.find((h) => h.id === id)?.bedId ?? null),
      reserved: reserveOnly,
      receiptId: pay?.id ?? null,
      docs: docs.length,
    })
    toast.success(reserveOnly ? `Bed reserved for ${profile.name}` : `${profile.name} checked in`)
    if (params.get('bed')) setParams({}, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const reset = () => {
    setDone(null)
    setStep(0)
    setProfile(emptyProfile())
    setErrors({})
    setDocs([])
    setBedId('')
    setReserveOnly(false)
    setRent('')
    setDeposit(String(settings.defaultSecurityDeposit))
    setCollect(true)
    setDepAmount(String(settings.defaultSecurityDeposit))
    setDepMode('upi')
    setDepRef('')
    setMessOpted(false)
    setGenInvoice(true)
    setCheckInDate(today())
    setExpectedOut('')
    setPin(randomPin())
    setNotes('')
  }

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
    return (
      <>
        <PageHeader title={done.reserved ? 'Bed reserved' : 'Check-in complete'} />
        <Card className="mx-auto max-w-2xl p-6 sm:p-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{done.reserved ? `${done.name}'s bed is reserved` : `Welcome, ${done.name}!`}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {done.bed} · {hostelName(hostelId)}
            </p>
          </div>
          <div className="mt-6 rounded-xl border border-slate-200 p-5">
            <DescriptionList
              items={[
                { label: 'Status', value: done.reserved ? 'Reserved – check in later' : 'Checked in' },
                { label: done.reserved ? 'Expected check-in' : 'Check-in date', value: formatDate(checkInDate) },
                { label: 'Monthly rent', value: formatMoney(Number(rent) || 0) },
                { label: 'Security deposit', value: formatMoney(depositNum) },
                { label: 'Deposit collected', value: collect ? `${formatMoney(Number(depAmount) || 0)} (${depMode.toUpperCase()})` : 'Not yet' },
                { label: 'Documents uploaded', value: String(done.docs) },
              ]}
            />
          </div>
          <div className="mt-4 rounded-xl bg-brand-50 p-5">
            <p className="text-sm font-semibold text-brand-900">Resident portal login</p>
            <p className="mt-1 text-xs text-brand-700">Share these with the resident so they can view fees, raise complaints and apply for leave.</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-brand-700">Phone</p>
                <p className="font-semibold text-slate-900">{done.phone}</p>
              </div>
              <div>
                <p className="text-xs text-brand-700">PIN</p>
                <p className="font-mono text-2xl font-bold tracking-[0.25em] text-brand-700">{done.pin}</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={() => navigate(`/app/hostelers/${done.hostelerId}`)}>
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
        <PersonalFields f={profile} set={set} errors={errors} />
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
        <section>
          <SectionTitle hint="Aadhaar, college/office ID, police verification… They'll be saved after admission.">Documents</SectionTitle>
          <FileDrop multiple accept="image/*,application/pdf" onFiles={addFiles} hint="JPG, PNG or PDF · up to 2 MB each" />
          {docs.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {docs.map((d) => (
                <li key={d.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {d.file.mimeType.startsWith('image/') ? (
                      <img src={d.file.dataUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <FileText className="h-9 w-9 shrink-0 rounded bg-slate-100 p-2 text-slate-500" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{d.file.fileName}</p>
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
                    <IconButton label="Remove" onClick={() => setDocs((all) => all.filter((x) => x.key !== d.key))} className="hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  } else if (step === 3) {
    body = (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hostel" required>
            <Select
              value={hostelId}
              options={hostels.map((h) => ({ value: h.id, label: `${h.name} (${titleCase(h.type)})` }))}
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
        {grouped.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.map(({ room, beds }) => (
              <div key={room.id} className={cn('rounded-xl border p-3', beds.some((b) => b.id === bedId) ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200')}>
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
            <p className="text-sm text-slate-600">No vacant beds in {hostelName(hostelId)}.</p>
            <p className="mt-1 text-xs text-slate-500">
              Add rooms in <Link to="/app/rooms" className="text-brand-600 hover:underline">Rooms & beds</Link>, or reserve without a bed.
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
            <Switch checked={messOpted} onChange={setMessOpted} label={`Opt for mess (${formatMoney(settings.messMonthlyCharge)}/month)`} />
            <Switch
              checked={genInvoice && !reserveOnly}
              disabled={reserveOnly}
              onChange={setGenInvoice}
              label={reserveOnly ? 'First invoice is generated at check-in' : 'Generate first month invoice now'}
            />
          </div>
        </section>
        <section>
          <SectionTitle>Deposit payment</SectionTitle>
          <Switch checked={collect} onChange={setCollect} label="Collect security deposit now" />
          {collect && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Amount received" required>
                <Input type="number" min={1} value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
              </Field>
              <Field label="Mode">
                <Select value={depMode} options={PAYMENT_MODE_OPTIONS} onChange={(e) => setDepMode(e.target.value as PaymentMode)} />
              </Field>
              <Field label="Reference" hint="UTR / txn id">
                <Input value={depRef} onChange={(e) => setDepRef(e.target.value)} />
              </Field>
            </div>
          )}
        </section>
        <section>
          <SectionTitle hint="The resident logs in to the portal with their phone and this PIN.">Portal access</SectionTitle>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-slate-100 px-4 py-2 font-mono text-xl font-bold tracking-[0.3em] text-slate-900">{pin}</span>
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setPin(randomPin())}>
              Regenerate
            </Button>
          </div>
        </section>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the warden should know" />
        </Field>
      </div>
    )
  } else {
    const firstMonth = (Number(rent) || 0) + (messOpted ? settings.messMonthlyCharge : 0)
    body = (
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.name || '?'} src={profile.photo} size="lg" />
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
              { label: 'Date of birth', value: profile.dob ? formatDate(profile.dob) : '' },
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
              { label: profile.occupation === 'working' ? 'Company' : 'Institution', value: profile.institution },
              { label: profile.occupation === 'working' ? 'Designation' : 'Course', value: profile.course },
              { label: 'Guardian', value: `${profile.guardianName} (${profile.guardianRelation})` },
              { label: 'Guardian phone', value: profile.guardianPhone },
            ]}
          />
        </ReviewBlock>
        <ReviewBlock title="ID & documents" onEdit={() => setStep(2)}>
          <DescriptionList
            cols={3}
            items={[
              { label: 'ID proof', value: profile.idProofNumber ? `${profile.idProofType} · ${profile.idProofNumber}` : '' },
              { label: 'Documents', value: docs.length ? docs.map((d) => DOC_TYPE_LABELS[d.type]).join(', ') : 'None' },
            ]}
          />
        </ReviewBlock>
        <ReviewBlock title="Room & payment" onEdit={() => setStep(3)}>
          <DescriptionList
            cols={3}
            items={[
              { label: 'Hostel', value: hostelName(hostelId) },
              { label: 'Bed', value: selected ? `Room ${selected.room.number} · Bed ${selected.bed.label}` : 'Not allotted' },
              { label: 'Type', value: reserveOnly ? <Badge tone="amber">Reservation</Badge> : <Badge tone="green">Check in now</Badge> },
              { label: reserveOnly ? 'Expected check-in' : 'Check-in date', value: formatDate(checkInDate) },
              { label: 'Monthly rent', value: formatMoney(Number(rent) || 0) },
              { label: 'Mess', value: messOpted ? `Yes (${formatMoney(settings.messMonthlyCharge)})` : 'No' },
              { label: 'Security deposit', value: formatMoney(depositNum) },
              { label: 'Collected now', value: collect ? `${formatMoney(Number(depAmount) || 0)} via ${depMode.toUpperCase()}` : 'No' },
              { label: 'First invoice', value: genInvoice && !reserveOnly ? formatMoney(firstMonth) : 'Not generated' },
            ]}
          />
        </ReviewBlock>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="New check-in" subtitle="Admit a resident in a few steps." />
      <Reservations />
      <Card className="p-5 sm:p-6">
        <Stepper step={step} onJump={setStep} />
        <div className="min-h-[18rem]">{body}</div>
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />} onClick={back} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="success" icon={reserveOnly ? <Clock className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />} onClick={submit}>
              {reserveOnly ? 'Confirm reservation' : 'Confirm check-in'}
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
