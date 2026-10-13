import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { addMonths, format, parseISO, startOfMonth } from 'date-fns'
import {
  BedDouble,
  Building2,
  Check,
  CreditCard,
  Database,
  Download,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { emptyDB, useStore, type DB } from '@/store'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  Select,
  Tabs,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { PLANS, planInfo, type PlanInfo } from '@/lib/plans'
import { cn, downloadCsv, formatDate, formatMoney, titleCase } from '@/lib/utils'
import type { Hostel, HostelType, Plan, Settings as SettingsT } from '@/types'

type TabKey = 'profile' | 'hostels' | 'billing' | 'preferences' | 'data'
const TABS: { value: TabKey; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'hostels', label: 'Hostels' },
  { value: 'billing', label: 'Plan & billing' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'data', label: 'Data & backup' },
]

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = TABS.some((t) => t.value === raw) ? (raw as TabKey) : 'profile'
  const hostelCount = useStore((s) => s.hostels.length)

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your account, hostels, plan and data." />
      <Tabs
        className="mb-6"
        tabs={TABS.map((t) => (t.value === 'hostels' ? { ...t, count: hostelCount } : t))}
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
      />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'hostels' && <HostelsTab />}
      {tab === 'billing' && <BillingTab />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'data' && <DataTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

function ProfileTab() {
  const org = useStore((s) => s.org)
  const updateOrg = useStore((s) => s.updateOrg)
  const [form, setForm] = useState({ name: org?.name ?? '', ownerName: org?.ownerName ?? '', email: org?.email ?? '', phone: org?.phone ?? '' })
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({})
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')

  if (!org) return <EmptyState title="No organization" />

  const dirty = form.name !== org.name || form.ownerName !== org.ownerName || form.email !== org.email || form.phone !== org.phone

  const saveProfile = () => {
    const e: typeof errors = {}
    if (form.name.trim().length < 2) e.name = 'Enter a business name.'
    if (form.ownerName.trim().length < 2) e.ownerName = 'Enter your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email.'
    if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a valid mobile number.'
    setErrors(e)
    if (Object.keys(e).length) return
    updateOrg({ name: form.name.trim(), ownerName: form.ownerName.trim(), email: form.email.trim(), phone: form.phone.trim() })
    toast.success('Profile updated')
  }

  const changePassword = () => {
    setPwError('')
    if (pw.current !== org.password) return setPwError('Current password is incorrect.')
    if (pw.next.length < 6) return setPwError('New password must be at least 6 characters.')
    if (pw.next !== pw.confirm) return setPwError('New passwords do not match.')
    updateOrg({ password: pw.next })
    setPw({ current: '', next: '', confirm: '' })
    toast.success('Password changed')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Organization profile" subtitle="Shown on invoices, receipts and the hosteler portal." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Business / hostel group name" required error={errors.name} className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Owner name" required error={errors.ownerName}>
            <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          </Field>
          <Field label="Mobile" required error={errors.phone}>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          </Field>
          <Field label="Login email" required error={errors.email} hint="You use this email to log in." className="sm:col-span-2">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
          <p className="text-xs text-slate-500">Member since {formatDate(org.createdAt)}</p>
          <div className="flex gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setForm({ name: org.name, ownerName: org.ownerName, email: org.email, phone: org.phone })}>
                Discard
              </Button>
            )}
            <Button onClick={saveProfile} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Change password" />
        <div className="space-y-4 p-5">
          {pwError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pwError}</p>}
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 6 characters">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <Button className="w-full" onClick={changePassword} disabled={!pw.current || !pw.next}>
            Update password
          </Button>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hostels                                                             */
/* ------------------------------------------------------------------ */

type HostelForm = Omit<Hostel, 'id' | 'createdAt' | 'hostelerSeq'>
const blankHostel: HostelForm = { name: '', type: 'boys', address: '', city: '', phone: '', code: '' }
const HOSTEL_TYPES: { value: HostelType; label: string }[] = [
  { value: 'boys', label: 'Boys' },
  { value: 'girls', label: 'Girls' },
  { value: 'coed', label: 'Co-ed' },
]

function HostelsTab() {
  const hostels = useStore((s) => s.hostels)
  const rooms = useStore((s) => s.rooms)
  const beds = useStore((s) => s.beds)
  const hostelers = useStore((s) => s.hostelers)
  const addHostel = useStore((s) => s.addHostel)
  const updateHostel = useStore((s) => s.updateHostel)
  const deleteHostel = useStore((s) => s.deleteHostel)
  const setCurrentHostel = useStore((s) => s.setCurrentHostel)
  const navigate = useNavigate()

  const [editing, setEditing] = useState<Hostel | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<HostelForm>(blankHostel)
  const [errors, setErrors] = useState<Partial<Record<keyof HostelForm, string>>>({})

  const openNew = () => {
    setEditing(null)
    setForm(blankHostel)
    setErrors({})
    setOpen(true)
  }
  const openEdit = (h: Hostel) => {
    setEditing(h)
    setForm({ name: h.name, type: h.type, address: h.address, city: h.city, phone: h.phone, code: h.code })
    setErrors({})
    setOpen(true)
  }

  const save = () => {
    const e: typeof errors = {}
    if (form.name.trim().length < 2) e.name = 'Enter a hostel name.'
    else if (hostels.some((h) => h.id !== editing?.id && h.name.trim().toLowerCase() === form.name.trim().toLowerCase())) e.name = 'A hostel with this name already exists.'
    if (!form.city.trim()) e.city = 'Enter the city.'
    const code = form.code.trim().toUpperCase()
    if (code && !/^[A-Z0-9]{2,5}$/.test(code)) e.code = '2–5 letters or numbers, e.g. SBH'
    else if (code && hostels.some((h) => h.id !== editing?.id && h.code === code)) e.code = 'Another hostel already uses this prefix.'
    setErrors(e)
    if (Object.keys(e).length) return
    const clean = { ...form, code, name: form.name.trim(), city: form.city.trim(), address: form.address.trim(), phone: form.phone.trim() }
    if (editing) {
      updateHostel(editing.id, { ...clean, code: editing.hostelerSeq > 0 || !code ? editing.code : code })
      toast.success('Hostel updated')
    } else {
      addHostel(clean)
      toast.success(`${clean.name} added`)
    }
    setOpen(false)
  }

  const remove = async (h: Hostel) => {
    const roomCount = rooms.filter((r) => r.hostelId === h.id).length
    const ok = await confirm({
      title: `Delete ${h.name}?`,
      message: `This permanently removes the hostel along with its ${roomCount} rooms, beds, mess menu and staff records. This cannot be undone.`,
      confirmText: 'Delete hostel',
      danger: true,
    })
    if (!ok) return
    const res = deleteHostel(h.id)
    if (res.ok) toast.success(`${h.name} deleted`)
    else toast.error(res.error ?? 'Could not delete hostel')
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {hostels.length} hostel{hostels.length === 1 ? '' : 's'} · {beds.length} beds in total
        </p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>
          Add hostel
        </Button>
      </div>

      {hostels.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Add your first hostel"
            description="Every room, bed and hosteler belongs to a hostel. You can add more later."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>Add hostel</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hostels.map((h) => {
            const hRooms = rooms.filter((r) => r.hostelId === h.id)
            const hBeds = beds.filter((b) => b.hostelId === h.id)
            const occ = hBeds.filter((b) => b.hostelerId).length
            const residents = hostelers.filter((x) => x.hostelId === h.id && x.status !== 'checked_out').length
            return (
              <Card key={h.id} className="flex flex-col">
                <div className="flex-1 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{h.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={h.type === 'girls' ? 'violet' : h.type === 'boys' ? 'blue' : 'green'}>
                            {HOSTEL_TYPES.find((t) => t.value === h.type)?.label}
                          </Badge>
                          <Badge>IDs: {h.code}-0001</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                    <p className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span>{[h.address, h.city].filter(Boolean).join(', ') || '—'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                      {h.phone || '—'}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-slate-900">{hRooms.length}</p>
                      <p className="text-xs text-slate-500">Rooms</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">{hBeds.length}</p>
                      <p className="text-xs text-slate-500">Beds</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">{residents}</p>
                      <p className="text-xs text-slate-500">Residents</p>
                    </div>
                  </div>
                  {hBeds.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>Occupancy</span>
                        <span>{Math.round((occ / hBeds.length) * 100)}%</span>
                      </div>
                      <ProgressBar value={(occ / hBeds.length) * 100} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<BedDouble className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setCurrentHostel(h.id)
                      navigate('/app/rooms')
                    }}
                  >
                    Rooms
                  </Button>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(h)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove(h)}>
                    Delete
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit hostel' : 'Add hostel'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Add hostel'}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hostel name" required error={errors.name} className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sunrise Boys Hostel" autoFocus />
          </Field>
          <Field label="Type" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as HostelType })} options={HOSTEL_TYPES} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="City" required error={errors.city}>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field
            label="Hosteler ID prefix"
            error={errors.code}
            hint={
              editing && editing.hostelerSeq > 0
                ? `Locked: ${editing.hostelerSeq} IDs already issued (${editing.code}-0001…)`
                : `Hosteler IDs will look like ${(form.code.trim().toUpperCase() || 'auto')}-0001. Leave blank to auto-generate.`
            }
          >
            <Input
              value={form.code}
              maxLength={5}
              disabled={!!editing && editing.hostelerSeq > 0}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              placeholder="e.g. SBH"
              className="font-mono uppercase"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

type PayMethod = { kind: 'upi'; upiId: string } | { kind: 'card'; last4: string; brand: string; expiry: string }
const PAY_KEY = 'hostelhub-payment-method'

function readPayMethod(): PayMethod {
  try {
    const raw = localStorage.getItem(PAY_KEY)
    if (raw) return JSON.parse(raw) as PayMethod
  } catch {
    /* ignore */
  }
  return { kind: 'upi', upiId: 'owner@okhdfcbank' }
}

function BillingTab() {
  const org = useStore((s) => s.org)
  const totalBeds = useStore((s) => s.beds.length)
  const setPlan = useStore((s) => s.setPlan)
  const [checkout, setCheckout] = useState<PlanInfo | null>(null)
  const [processing, setProcessing] = useState(false)
  const [method, setMethod] = useState<PayMethod>(readPayMethod)
  const [methodOpen, setMethodOpen] = useState(false)
  const [methodForm, setMethodForm] = useState({ kind: 'upi' as 'upi' | 'card', upiId: '', card: '', expiry: '' })
  const [methodError, setMethodError] = useState('')

  const current = planInfo(org?.plan ?? 'free')
  const billableBeds = Math.max(totalBeds, 0)
  const monthly = (p: PlanInfo) => p.pricePerBed * billableBeds

  const history = useMemo(() => {
    if (!org) return []
    const created = startOfMonth(parseISO(org.createdAt))
    const rows: { id: string; period: string; date: string; amount: number; plan: string }[] = []
    for (let i = 1; i <= 3; i++) {
      const m = addMonths(startOfMonth(new Date()), -i)
      if (m < created) break
      rows.push({
        id: `HH-${format(m, 'yyyyMM')}-${org.id.slice(-4).toUpperCase()}`,
        period: format(m, 'MMM yyyy'),
        date: format(addMonths(m, 1), 'yyyy-MM-01'),
        amount: current.pricePerBed * billableBeds,
        plan: current.name,
      })
    }
    return rows
  }, [org, current, billableBeds])

  if (!org) return null

  const usagePct = current.maxBeds ? (billableBeds / current.maxBeds) * 100 : 0
  const order = (p: Plan) => PLANS.findIndex((x) => x.id === p)

  const confirmPlan = () => {
    if (!checkout) return
    setProcessing(true)
    setTimeout(() => {
      setPlan(checkout.id)
      setProcessing(false)
      setCheckout(null)
      toast.success(`You're now on the ${checkout.name} plan`)
    }, 900)
  }

  const saveMethod = () => {
    setMethodError('')
    let next: PayMethod
    if (methodForm.kind === 'upi') {
      if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(methodForm.upiId.trim())) return setMethodError('Enter a valid UPI ID, e.g. name@okicici')
      next = { kind: 'upi', upiId: methodForm.upiId.trim() }
    } else {
      const digits = methodForm.card.replace(/\D/g, '')
      if (digits.length < 15 || digits.length > 16) return setMethodError('Enter a valid card number.')
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(methodForm.expiry.trim())) return setMethodError('Expiry must be MM/YY.')
      const brand = digits.startsWith('4') ? 'Visa' : digits.startsWith('5') ? 'Mastercard' : digits.startsWith('6') ? 'RuPay' : 'Card'
      next = { kind: 'card', last4: digits.slice(-4), brand, expiry: methodForm.expiry.trim() }
    }
    setMethod(next)
    try {
      localStorage.setItem(PAY_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
    setMethodOpen(false)
    toast.success('Payment method updated')
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="text-sm text-slate-500">Current plan</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-900">{current.name}</h2>
              <Badge tone="blue">{current.pricePerBed ? `${formatMoney(current.pricePerBed)}/bed/mo` : 'Free'}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">{current.tagline}</p>
          </div>
          <div className="w-full md:w-80">
            <div className="mb-1.5 flex justify-between text-sm">
              <span className="text-slate-600">Beds used</span>
              <span className="font-medium text-slate-900">
                {billableBeds} / {current.maxBeds ?? '∞'}
              </span>
            </div>
            <ProgressBar value={current.maxBeds ? usagePct : 8} tone={usagePct > 100 ? 'red' : usagePct > 85 ? 'amber' : 'brand'} />
            {current.maxBeds && billableBeds > current.maxBeds ? (
              <p className="mt-1.5 text-xs text-red-600">You're over your plan's bed limit. Upgrade to keep adding hostelers.</p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                Estimated bill: <span className="font-semibold text-slate-800">{formatMoney(monthly(current))}</span> / month
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = p.id === current.id
          const tooSmall = p.maxBeds !== null && billableBeds > p.maxBeds
          const up = order(p.id) > order(current.id)
          return (
            <Card key={p.id} className={cn('flex flex-col p-6', isCurrent && 'border-brand-600 ring-1 ring-brand-600')}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
                {isCurrent && <Badge tone="blue">Current</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
              <p className="mt-4">
                <span className="text-3xl font-extrabold text-slate-900">{formatMoney(p.pricePerBed)}</span>
                <span className="text-sm text-slate-500"> / bed / month</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {p.maxBeds ? `Up to ${p.maxBeds} beds` : 'Unlimited beds'} · your estimate{' '}
                <span className="font-semibold text-slate-700">{formatMoney(monthly(p))}/mo</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6 w-full"
                variant={isCurrent ? 'secondary' : up ? 'primary' : 'outline'}
                disabled={isCurrent || tooSmall}
                icon={up && !isCurrent ? <Sparkles className="h-4 w-4" /> : undefined}
                onClick={() => setCheckout(p)}
              >
                {isCurrent ? 'Current plan' : tooSmall ? `Too many beds (${billableBeds})` : up ? `Upgrade to ${p.name}` : `Downgrade to ${p.name}`}
              </Button>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Payment method"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMethodForm({ kind: method.kind, upiId: method.kind === 'upi' ? method.upiId : '', card: '', expiry: '' })
                  setMethodError('')
                  setMethodOpen(true)
                }}
              >
                Change
              </Button>
            }
          />
          <div className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              {method.kind === 'upi' ? <Smartphone className="h-6 w-6" /> : <CreditCard className="h-6 w-6" />}
            </div>
            <div>
              {method.kind === 'upi' ? (
                <>
                  <p className="font-medium text-slate-900">UPI AutoPay</p>
                  <p className="text-sm text-slate-500">{method.upiId}</p>
                </>
              ) : (
                <>
                  <p className="font-medium text-slate-900">
                    {method.brand} •••• {method.last4}
                  </p>
                  <p className="text-sm text-slate-500">Expires {method.expiry}</p>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Billing history" subtitle="HostelHub subscription invoices" />
          {history.length === 0 || history.every((h) => h.amount === 0) ? (
            <EmptyState title="No invoices yet" description={current.pricePerBed === 0 ? "You're on the Free plan — nothing to pay." : 'Your first invoice will appear after your first billing cycle.'} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{h.period}</p>
                    <p className="text-xs text-slate-500">
                      {h.id} · {h.plan} plan · paid {formatDate(h.date)}
                    </p>
                  </div>
                  <Badge tone="green">Paid</Badge>
                  <span className="w-24 text-right text-sm font-semibold text-slate-900">{formatMoney(h.amount)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Download className="h-3.5 w-3.5" />}
                    onClick={() =>
                      downloadCsv(`${h.id}.csv`, [
                        ['HostelHub subscription invoice'],
                        ['Invoice', h.id],
                        ['Billed to', org.name],
                        ['Period', h.period],
                        ['Plan', h.plan],
                        ['Beds', billableBeds],
                        ['Amount', h.amount],
                        ['Status', 'Paid'],
                        ['Paid on', h.date],
                      ])
                    }
                  >
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Checkout */}
      <Modal
        open={!!checkout}
        onClose={() => !processing && setCheckout(null)}
        size="sm"
        title={checkout && order(checkout.id) > order(current.id) ? `Upgrade to ${checkout.name}` : `Switch to ${checkout?.name ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setCheckout(null)} disabled={processing}>Cancel</Button>
            <Button onClick={confirmPlan} loading={processing}>
              {checkout && checkout.pricePerBed > 0 ? `Pay & switch` : 'Confirm'}
            </Button>
          </>
        }
      >
        {checkout && (
          <div className="space-y-4 text-sm">
            <div className="space-y-2 rounded-xl border border-slate-200 p-4">
              <Row label="Plan" value={checkout.name} />
              <Row label="Price" value={`${formatMoney(checkout.pricePerBed)} × ${billableBeds} beds`} />
              <div className="border-t border-slate-100 pt-2">
                <Row label="Monthly total" value={<span className="text-base font-bold text-slate-900">{formatMoney(monthly(checkout))}</span>} />
              </div>
            </div>
            {checkout.pricePerBed > 0 && (
              <p className="text-slate-600">
                Charged to {method.kind === 'upi' ? `UPI ${method.upiId}` : `${method.brand} •••• ${method.last4}`}. Billed monthly, cancel anytime.
              </p>
            )}
            {order(checkout.id) < order(current.id) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                Modules not included in {checkout.name} will be locked. Your data stays safe and unlocks again if you upgrade.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Payment method */}
      <Modal
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        size="sm"
        title="Update payment method"
        footer={
          <>
            <Button variant="outline" onClick={() => setMethodOpen(false)}>Cancel</Button>
            <Button onClick={saveMethod}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['upi', 'card'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setMethodForm({ ...methodForm, kind: k })}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium',
                  methodForm.kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                )}
              >
                {k === 'upi' ? <Smartphone className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                {k === 'upi' ? 'UPI' : 'Card'}
              </button>
            ))}
          </div>
          {methodError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{methodError}</p>}
          {methodForm.kind === 'upi' ? (
            <Field label="UPI ID">
              <Input value={methodForm.upiId} onChange={(e) => setMethodForm({ ...methodForm, upiId: e.target.value })} placeholder="name@okicici" />
            </Field>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Card number" className="col-span-2">
                <Input inputMode="numeric" value={methodForm.card} onChange={(e) => setMethodForm({ ...methodForm, card: e.target.value })} placeholder="4111 1111 1111 1111" />
              </Field>
              <Field label="Expiry">
                <Input value={methodForm.expiry} onChange={(e) => setMethodForm({ ...methodForm, expiry: e.target.value })} placeholder="MM/YY" />
              </Field>
            </div>
          )}
          <p className="text-xs text-slate-500">This is a demo — no real payment details are processed or sent anywhere.</p>
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-800">{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

function PreferencesTab() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const toForm = (s: SettingsT) => ({
    rentDueDay: String(s.rentDueDay),
    lateFeePerDay: String(s.lateFeePerDay),
    receiptPrefix: s.receiptPrefix,
    defaultSecurityDeposit: String(s.defaultSecurityDeposit),
    messMonthlyCharge: String(s.messMonthlyCharge),
    nightCurfew: s.nightCurfew,
  })
  const [form, setForm] = useState(() => toForm(settings))
  const [errors, setErrors] = useState<Partial<Record<keyof ReturnType<typeof toForm>, string>>>({})

  const save = () => {
    const e: typeof errors = {}
    const due = Number(form.rentDueDay)
    if (!Number.isInteger(due) || due < 1 || due > 28) e.rentDueDay = 'Enter a day between 1 and 28.'
    const num = (k: 'lateFeePerDay' | 'defaultSecurityDeposit' | 'messMonthlyCharge') => {
      const v = Number(form[k])
      if (form[k] === '' || Number.isNaN(v) || v < 0) e[k] = 'Enter a valid amount.'
      return v
    }
    const late = num('lateFeePerDay')
    const dep = num('defaultSecurityDeposit')
    const mess = num('messMonthlyCharge')
    const prefix = form.receiptPrefix.trim().toUpperCase()
    if (!/^[A-Z0-9-]{1,10}$/.test(prefix)) e.receiptPrefix = 'Use 1–10 letters, digits or dashes.'
    if (!/^\d{2}:\d{2}$/.test(form.nightCurfew)) e.nightCurfew = 'Enter a time.'
    setErrors(e)
    if (Object.keys(e).length) return
    updateSettings({ rentDueDay: due, lateFeePerDay: late, receiptPrefix: prefix, defaultSecurityDeposit: dep, messMonthlyCharge: mess, nightCurfew: form.nightCurfew })
    setForm((f) => ({ ...f, receiptPrefix: prefix }))
    toast.success('Preferences saved')
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Hostel preferences" subtitle="Defaults used for rent, receipts, check-ins and the mess." />
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <Field label="Rent due day" error={errors.rentDueDay} hint="Day of the month rent invoices are due (1–28)">
          <Input type="number" min={1} max={28} value={form.rentDueDay} onChange={set('rentDueDay')} />
        </Field>
        <Field label="Late fee per day (₹)" error={errors.lateFeePerDay} hint="Shown on overdue invoices">
          <Input type="number" min={0} value={form.lateFeePerDay} onChange={set('lateFeePerDay')} />
        </Field>
        <Field label="Receipt number prefix" error={errors.receiptPrefix} hint={`Next receipt looks like ${form.receiptPrefix.trim().toUpperCase() || 'RCPT'}-5001`}>
          <Input value={form.receiptPrefix} onChange={set('receiptPrefix')} maxLength={10} />
        </Field>
        <Field label="Default security deposit (₹)" error={errors.defaultSecurityDeposit} hint="Pre-filled during check-in">
          <Input type="number" min={0} value={form.defaultSecurityDeposit} onChange={set('defaultSecurityDeposit')} />
        </Field>
        <Field label="Mess charge per month (₹)" error={errors.messMonthlyCharge} hint="Added to invoices of hostelers who opt for mess">
          <Input type="number" min={0} value={form.messMonthlyCharge} onChange={set('messMonthlyCharge')} />
        </Field>
        <Field label="Night curfew" error={errors.nightCurfew} hint="Gate entries after this time are flagged late">
          <Input type="time" value={form.nightCurfew} onChange={set('nightCurfew')} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
        <Button variant="ghost" onClick={() => { setForm(toForm(settings)); setErrors({}) }}>
          Reset
        </Button>
        <Button onClick={save}>Save preferences</Button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const DB_KEYS = Object.keys(emptyDB()) as (keyof DB)[]

function DataTab() {
  const org = useStore((s) => s.org)
  const hostelsN = useStore((s) => s.hostels.length)
  const roomsN = useStore((s) => s.rooms.length)
  const hostelersN = useStore((s) => s.hostelers.length)
  const invoicesN = useStore((s) => s.invoices.length)
  const paymentsN = useStore((s) => s.payments.length)
  const documentsN = useStore((s) => s.documents.length)
  const counts = { hostels: hostelsN, rooms: roomsN, hostelers: hostelersN, invoices: invoicesN, payments: paymentsN, documents: documentsN }
  const loadDemo = useStore((s) => s.loadDemo)
  const resetWorkspace = useStore((s) => s.resetWorkspace)
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const exportBackup = () => {
    const s = useStore.getState()
    const data: Record<string, unknown> = {}
    for (const k of DB_KEYS) data[k] = s[k]
    const payload = { app: 'hostelhub', version: 1, exportedAt: new Date().toISOString(), data }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hostelhub-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Backup downloaded')
  }

  const importBackup = async (file: File) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      toast.error('That file is not valid JSON.')
      return
    }
    const root = parsed as Record<string, unknown> | null
    const data = (root && typeof root === 'object' && root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown> | null
    if (!data || !Array.isArray(data.hostels) || !Array.isArray(data.hostelers)) {
      toast.error('Invalid backup: hostels and hostelers lists are missing.')
      return
    }
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `This replaces everything in the current workspace with the backup (${(data.hostels as unknown[]).length} hostels, ${(data.hostelers as unknown[]).length} hostelers). Export a backup of the current data first if you need it.`,
      confirmText: 'Restore backup',
      danger: true,
    })
    if (!ok) return
    const base = emptyDB()
    const next: Partial<DB> = {}
    for (const k of DB_KEYS) {
      const v = data[k]
      const def = base[k]
      if (v === undefined) continue
      if (Array.isArray(def) && !Array.isArray(v)) continue
      if (typeof def === 'number' && typeof v !== 'number') continue
      ;(next as Record<string, unknown>)[k] = v
    }
    const restoredOrg = (next.org ?? useStore.getState().org) as DB['org']
    useStore.setState({
      ...base,
      ...next,
      settings: { ...base.settings, ...((next.settings as object | undefined) ?? {}) },
      org: restoredOrg,
      currentHostelId: 'all',
      session: { kind: 'admin' },
    })
    toast.success('Backup restored')
    navigate('/app/dashboard')
  }

  const doLoadDemo = async () => {
    const ok = await confirm({
      title: 'Load demo data?',
      message: 'This replaces all current data with a demo hostel group (and the demo login demo@hostelhub.in / demo123).',
      confirmText: 'Load demo',
      danger: true,
    })
    if (!ok) return
    loadDemo()
    toast.success('Demo data loaded')
    navigate('/app/dashboard')
  }

  const doReset = async () => {
    const ok = await confirm({
      title: 'Reset workspace?',
      message: 'All hostels, rooms, hostelers, invoices, payments, documents and records will be permanently deleted. Your account login is kept. This cannot be undone.',
      confirmText: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    resetWorkspace()
    toast.success('Workspace reset')
    navigate('/app/dashboard')
  }

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader title="Your data" subtitle={`Stored in this browser for ${org?.name ?? 'your workspace'}.`} />
        <div className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-6">
          {Object.entries(counts).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-lg font-bold text-slate-900">{v}</p>
              <p className="text-xs text-slate-500">{titleCase(k)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Backup & restore" />
        <div className="divide-y divide-slate-100">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="font-medium text-slate-900">Export full backup</p>
              <p className="text-sm text-slate-500">Download everything (including documents and photos) as a JSON file.</p>
            </div>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportBackup}>
              Export JSON
            </Button>
          </div>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="font-medium text-slate-900">Import backup</p>
              <p className="text-sm text-slate-500">Restore a HostelHub JSON backup. The current workspace will be replaced.</p>
            </div>
            <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
              Import JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importBackup(f)
              }}
            />
          </div>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                <Database className="h-4 w-4 text-slate-400" /> Load demo data
              </p>
              <p className="text-sm text-slate-500">Replace the workspace with sample hostels, residents and payments to explore features.</p>
            </div>
            <Button variant="outline" icon={<Sparkles className="h-4 w-4" />} onClick={doLoadDemo}>
              Load demo
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border-red-200">
        <CardHeader title={<span className="flex items-center gap-2 text-red-700"><ShieldAlert className="h-4 w-4" /> Danger zone</span>} />
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-medium text-slate-900">Reset workspace</p>
            <p className="text-sm text-slate-500">Delete all hostels and records. Your account and login stay.</p>
          </div>
          <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={doReset}>
            Reset workspace
          </Button>
        </div>
      </Card>
    </div>
  )
}
