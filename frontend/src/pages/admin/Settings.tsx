import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BedDouble,
  Building2,
  Check,
  Copy,
  Download,
  KeyRound,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { errorMessage } from '@/api/client'
import { useHostels, useOrg, useScopeStore } from '@/api/common'
import { useCan, useStaffSession } from '@/api/session'
import { useDeleteHostel } from '@/api/hostels'
import { HOSTEL_TYPES, HostelChargeChips, HostelModal, HostelStayChips } from './_hostelForm'
import {
  orgApi,
  useChangeOwnPassword,
  useChangePlan,
  useCreateUser,
  useDeleteUser,
  useResetUserPassword,
  useTeam,
  useUpdateOrgProfile,
  useUpdateOrgSettings,
  useUpdateUser,
  type TeamRole,
  type UserWithPassword,
} from '@/api/org'
import { toastError } from '@/api/query'
import type { Hostel, OrgDetails, Plan, Settings as SettingsT, StaffRole, User } from '@/api/types'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  PasswordInput,
  ProgressBar,
  QueryView,
  Select,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  confirm,
  toast,
  type BadgeTone,
} from '@/components/ui'
import { PLANS, planInfo, type PlanInfo } from '@/lib/plans'
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/utils'

type TabKey = 'profile' | 'hostels' | 'team' | 'billing' | 'preferences' | 'data'
const TABS: { value: TabKey; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'hostels', label: 'Hostels' },
  { value: 'team', label: 'Team' },
  { value: 'billing', label: 'Plan & billing' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'data', label: 'Data & backup' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Mirrors the server's password rule (backend/src/lib/auth.ts). */
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.'
  if (/\s/.test(pw)) return 'Spaces are not allowed.'
  return null
}

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const staff = useStaffSession()
  const can = useCan()
  const { data: hostels } = useHostels()
  const isOwner = staff?.user.role === 'owner'

  const allowed = (t: TabKey) => (t === 'profile' ? true : t === 'hostels' ? can('hostels') : isOwner)
  const tabs = TABS.filter((t) => allowed(t.value))
  const raw = params.get('tab') as TabKey | null
  const tab: TabKey = raw && tabs.some((t) => t.value === raw) ? raw : 'profile'

  return (
    <div>
      <PageHeader title="Settings" subtitle={isOwner ? 'Manage your account, hostels, team, plan and data.' : 'Your account and password.'} />
      {tabs.length > 1 && (
        <Tabs
          className="mb-6"
          tabs={tabs.map((t) => (t.value === 'hostels' && hostels ? { ...t, count: hostels.length } : t))}
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
        />
      )}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'hostels' && <HostelsTab />}
      {tab === 'team' && <TeamTab />}
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
  const staff = useStaffSession()
  const orgQ = useOrg()
  const isOwner = staff?.user.role === 'owner'
  if (!staff) return null
  const user = staff.user

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="Your account" subtitle="The login you're using right now." />
          <div className="p-5">
            <DescriptionList
              items={[
                { label: 'Name', value: user.name },
                { label: 'Role', value: <RoleBadge role={user.role} /> },
                { label: 'Login email', value: user.email },
                { label: 'Phone', value: user.phone },
                { label: 'Last login', value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—' },
                { label: 'Account created', value: formatDate(user.createdAt) },
              ]}
            />
            {!isOwner && <p className="mt-4 text-xs text-slate-500">To change your name, phone or role, ask the owner of {staff.organization.name}.</p>}
          </div>
        </Card>

        <QueryView query={orgQ}>{(org) => (isOwner ? <OrgProfileForm key={org.updatedAt} org={org} /> : <OrgProfileView org={org} />)}</QueryView>
      </div>

      <ChangePasswordCard />
    </div>
  )
}

function OrgProfileView({ org }: { org: OrgDetails }) {
  return (
    <Card>
      <CardHeader title="Organization" />
      <div className="p-5">
        <DescriptionList
          items={[
            { label: 'Business name', value: org.name },
            { label: 'Owner', value: org.ownerName },
            { label: 'Email', value: org.email },
            { label: 'Phone', value: org.phone },
          ]}
        />
      </div>
    </Card>
  )
}

function OrgProfileForm({ org }: { org: OrgDetails }) {
  const staff = useStaffSession()
  const initial = { name: org.name, ownerName: org.ownerName, email: org.email, phone: org.phone }
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({})
  const save = useUpdateOrgProfile()

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k])

  const submit = () => {
    const e: typeof errors = {}
    if (form.name.trim().length < 2) e.name = 'Enter a business name.'
    if (form.ownerName.trim().length < 2) e.ownerName = 'Enter your name.'
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email.'
    if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a valid mobile number.'
    setErrors(e)
    if (Object.keys(e).length) return
    save.mutate({ name: form.name.trim(), ownerName: form.ownerName.trim(), email: form.email.trim(), phone: form.phone.trim() })
  }

  return (
    <Card>
      <CardHeader title="Organization profile" subtitle="Shown on invoices, receipts and the hosteler portal." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Business / hostel group name" required error={errors.name} className="sm:col-span-2">
          <Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Owner name" required error={errors.ownerName}>
          <Input value={form.ownerName} maxLength={80} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
        </Field>
        <Field label="Mobile" error={errors.phone}>
          <Input value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </Field>
        <Field
          label="Business email"
          required
          error={errors.email}
          hint={`Shown to hostelers and on receipts. Your login email (${staff?.user.email ?? ''}) doesn't change.`}
          className="sm:col-span-2"
        >
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">Member since {formatDate(org.createdAt)}</p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setForm(initial)
                setErrors({})
              }}
              disabled={save.isPending}
            >
              Discard
            </Button>
          )}
          <Button onClick={submit} disabled={!dirty} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ChangePasswordCard() {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const change = useChangeOwnPassword(() => setPw({ current: '', next: '', confirm: '' }))

  const submit = () => {
    setError('')
    const problem = passwordProblem(pw.next)
    if (problem) return setError(problem)
    if (pw.next !== pw.confirm) return setError('New passwords do not match.')
    if (pw.next === pw.current) return setError('Choose a password different from the current one.')
    change.mutate({ current: pw.current, next: pw.next }, { onError: (e) => setError(errorMessage(e)) })
  }

  return (
    <Card className="h-fit">
      <CardHeader title="Change password" subtitle="Other devices will be signed out." />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Field label="Current password">
          <PasswordInput autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 8 characters with a letter and a number">
          <PasswordInput autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
        <Button type="submit" className="w-full" disabled={!pw.current || !pw.next} loading={change.isPending}>
          Update password
        </Button>
      </form>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Hostels                                                             */
/* ------------------------------------------------------------------ */

function HostelsTab() {
  const hostelsQ = useHostels()
  const can = useCan()
  const setScope = useScopeStore((s) => s.setHostelId)
  const navigate = useNavigate()
  const remove = useDeleteHostel()

  const [editing, setEditing] = useState<Hostel | null>(null)
  const [open, setOpen] = useState(false)

  const openNew = () => {
    setEditing(null)
    setOpen(true)
  }
  const openEdit = (h: Hostel) => {
    setEditing(h)
    setOpen(true)
  }

  const doDelete = async (h: Hostel) => {
    const ok = await confirm({
      title: `Delete ${h.name}?`,
      message: `This permanently removes the hostel along with its ${h.counts?.rooms ?? 0} rooms, beds, mess menu and staff records. Hostels with active or reserved hostelers can't be deleted. This cannot be undone.`,
      confirmText: 'Delete hostel',
      danger: true,
    })
    if (!ok) return
    remove.mutate(h.id, { onSuccess: () => toast.success(`${h.name} deleted`) })
  }

  return (
    <QueryView query={hostelsQ}>
      {(hostels) => {
        const totalBeds = hostels.reduce((a, h) => a + (h.counts?.beds ?? 0), 0)
        return (
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                {hostels.length} hostel{hostels.length === 1 ? '' : 's'} · {totalBeds} beds in total
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
                  action={
                    <Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>
                      Add hostel
                    </Button>
                  }
                />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {hostels.map((h) => {
                  const c = h.counts ?? { rooms: 0, beds: 0, occupied: 0, vacant: 0, activeHostelers: 0 }
                  const deleting = remove.isPending && remove.variables === h.id
                  return (
                    <Card key={h.id} className="flex flex-col">
                      <div className="flex-1 p-5">
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
                        <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                          <p className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <span>{[h.address, h.city].filter(Boolean).join(', ') || '—'}</span>
                          </p>
                          <p className="flex items-center gap-2">
                            <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                            {h.phone || '—'}
                          </p>
                          <p className="flex items-start gap-2">
                            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            {h.upiId ? (
                              <span className="min-w-0">
                                <span className="break-all font-mono text-slate-800">{h.upiId}</span>
                                <span className="block text-xs text-slate-500">
                                  {h.payeeName}
                                  {h.hasQr ? ' · QR uploaded' : ''}
                                </span>
                              </span>
                            ) : (
                              <span className="text-amber-700">No UPI ID set — edit to add one</span>
                            )}
                          </p>
                        </div>
                        <HostelChargeChips hostel={h} />
                        <HostelStayChips hostel={h} />
                        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
                          <div>
                            <p className="text-lg font-bold text-slate-900">{c.rooms}</p>
                            <p className="text-xs text-slate-500">Rooms</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-slate-900">{c.beds}</p>
                            <p className="text-xs text-slate-500">Beds</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-slate-900">{c.activeHostelers}</p>
                            <p className="text-xs text-slate-500">Residents</p>
                          </div>
                        </div>
                        {c.beds > 0 && (
                          <div className="mt-3">
                            <div className="mb-1 flex justify-between text-xs text-slate-500">
                              <span>Occupancy</span>
                              <span>{Math.round((c.occupied / c.beds) * 100)}%</span>
                            </div>
                            <ProgressBar value={(c.occupied / c.beds) * 100} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2">
                        {can('rooms') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<BedDouble className="h-3.5 w-3.5" />}
                            onClick={() => {
                              setScope(h.id)
                              navigate('/app/rooms')
                            }}
                          >
                            Rooms
                          </Button>
                        )}
                        <div className="flex-1" />
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(h)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          loading={deleting}
                          disabled={remove.isPending}
                          onClick={() => void doDelete(h)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}

            {open && <HostelModal key={editing?.id ?? 'new'} editing={editing} onClose={() => setOpen(false)} />}
          </div>
        )
      }}
    </QueryView>
  )
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

const ROLE_INFO: Record<StaffRole, { label: string; tone: BadgeTone; access: string }> = {
  owner: { label: 'Owner', tone: 'blue', access: 'Everything, including plan, team, settings and backups.' },
  manager: {
    label: 'Manager',
    tone: 'violet',
    access:
      'Runs the hostels: rooms, hostelers, check-in/out, fees, expenses, mess, attendance, complaints, visitors, notices, staff and reports. No plan, team or settings.',
  },
  warden: {
    label: 'Warden',
    tone: 'green',
    access: 'Day-to-day: rooms, hostelers, check-in/out, documents, mess, attendance, complaints, visitors and notices. No money screens.',
  },
  accountant: { label: 'Accountant', tone: 'amber', access: 'Money: hostelers (view), fees & payments, expenses and reports.' },
}
const TEAM_ROLES: TeamRole[] = ['manager', 'warden', 'accountant']

function RoleBadge({ role }: { role: StaffRole }) {
  return <Badge tone={ROLE_INFO[role].tone}>{ROLE_INFO[role].label}</Badge>
}

function TeamTab() {
  const teamQ = useTeam()
  const staff = useStaffSession()
  const del = useDeleteUser()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [creds, setCreds] = useState<{ result: UserWithPassword; reset: boolean } | null>(null)
  const reset = useResetUserPassword((r) => setCreds({ result: r, reset: true }))

  const doReset = async (u: User) => {
    const ok = await confirm({
      title: `Reset password for ${u.name}?`,
      message: 'A new temporary password is generated and they are signed out everywhere. Share the new password with them.',
      confirmText: 'Reset password',
    })
    if (ok) reset.mutate(u.id)
  }

  const doDelete = async (u: User) => {
    const ok = await confirm({
      title: `Remove ${u.name}'s login?`,
      message: 'They will no longer be able to sign in. Records they created are kept. To pause access instead, mark the login inactive.',
      confirmText: 'Remove login',
      danger: true,
    })
    if (ok) del.mutate(u.id)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Staff logins"
          subtitle="People who can sign in to manage your hostels."
          action={
            <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Add login
            </Button>
          }
        />
        <QueryView query={teamQ}>
          {(users) =>
            users.length <= 1 ? (
              <EmptyState
                icon={<UserPlus className="h-6 w-6" />}
                title="Only you so far"
                description="Create logins for your managers, wardens or accountant. Each person gets their own email and password."
                action={
                  <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
                    Add login
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Role</TH>
                    <TH>Status</TH>
                    <TH>Last login</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <tbody>
                  {users.map((u) => {
                    const manageable = u.role !== 'owner' && u.id !== staff?.user.id
                    return (
                      <TR key={u.id}>
                        <TD>
                          <p className="font-medium text-slate-900">
                            {u.name}
                            {u.id === staff?.user.id && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                          </p>
                          <p className="text-xs text-slate-500">
                            {u.email}
                            {u.phone && ` · ${u.phone}`}
                          </p>
                        </TD>
                        <TD>
                          <RoleBadge role={u.role} />
                        </TD>
                        <TD>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                        <TD className="text-xs text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</TD>
                        <TD className="text-right">
                          {manageable ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(u)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<KeyRound className="h-3.5 w-3.5" />}
                                loading={reset.isPending && reset.variables === u.id}
                                disabled={reset.isPending}
                                onClick={() => void doReset(u)}
                              >
                                Reset password
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:bg-red-50"
                                icon={<Trash2 className="h-3.5 w-3.5" />}
                                loading={del.isPending && del.variables === u.id}
                                disabled={del.isPending}
                                onClick={() => void doDelete(u)}
                              >
                                Remove
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Table>
            )
          }
        </QueryView>
      </Card>

      <Card className="h-fit">
        <CardHeader title="What each role can do" />
        <ul className="divide-y divide-slate-100">
          {(Object.keys(ROLE_INFO) as StaffRole[]).map((r) => (
            <li key={r} className="px-5 py-3.5">
              <RoleBadge role={r} />
              <p className="mt-1.5 text-sm text-slate-600">{ROLE_INFO[r].access}</p>
            </li>
          ))}
        </ul>
      </Card>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onCreated={(r) => {
            setInviteOpen(false)
            setCreds({ result: r, reset: false })
          }}
        />
      )}
      {editing && <EditUserModal key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      {creds && <CredentialsModal result={creds.result} reset={creds.reset} onClose={() => setCreds(null)} />}
    </div>
  )
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: UserWithPassword) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'warden' as TeamRole })
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({})
  const [apiError, setApiError] = useState('')
  const create = useCreateUser(onCreated)

  const submit = () => {
    const e: typeof errors = {}
    if (form.name.trim().length < 2) e.name = 'Enter their name.'
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email.'
    if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a valid mobile number.'
    setErrors(e)
    setApiError('')
    if (Object.keys(e).length) return
    create.mutate(
      { name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim(), role: form.role },
      { onError: (err) => setApiError(errorMessage(err)) },
    )
  }

  return (
    <Modal
      open
      onClose={() => !create.isPending && onClose()}
      title="Add staff login"
      description="A temporary password is generated. You'll see it once on the next screen."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Create login
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {apiError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{apiError}</p>}
        <Field label="Full name" required error={errors.name} className="sm:col-span-2">
          <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Email" required error={errors.email} hint="They sign in with this email.">
          <Input type="email" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Mobile" error={errors.phone} hint="Used to share the login on WhatsApp.">
          <Input value={form.phone} maxLength={20} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Role" required className="sm:col-span-2" hint={ROLE_INFO[form.role].access}>
          <Select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })}
            options={TEAM_ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label }))}
          />
        </Field>
      </div>
    </Modal>
  )
}

function EditUserModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [form, setForm] = useState({ name: user.name, phone: user.phone, role: user.role as TeamRole, active: user.active })
  const [error, setError] = useState('')
  const update = useUpdateUser(onClose)

  const submit = () => {
    if (form.name.trim().length < 2) return setError('Enter their name.')
    setError('')
    update.mutate({ id: user.id, name: form.name.trim(), phone: form.phone.trim(), role: form.role, active: form.active })
  }

  return (
    <Modal
      open
      onClose={() => !update.isPending && onClose()}
      title={`Edit ${user.name}`}
      description={user.email}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Mobile">
            <Input value={form.phone} maxLength={20} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Role" hint={ROLE_INFO[form.role].access}>
          <Select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })}
            options={TEAM_ROLES.map((r) => ({ value: r, label: ROLE_INFO[r].label }))}
          />
        </Field>
        <div>
          <Switch
            checked={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
            label={form.active ? 'Active — can sign in' : 'Inactive — sign-in blocked'}
          />
          {user.active && !form.active && <p className="mt-1.5 text-xs text-amber-700">They will be signed out on every device.</p>}
        </div>
      </div>
    </Modal>
  )
}

function CredentialsModal({ result, reset, onClose }: { result: UserWithPassword; reset: boolean; onClose: () => void }) {
  const { user, tempPassword } = result
  const [copied, setCopied] = useState(false)
  const loginUrl = `${window.location.origin}/login`
  const message = `Hi ${user.name}, ${reset ? 'your HostelHub password has been reset' : 'your HostelHub login is ready'}.\n\nLogin: ${loginUrl}\nEmail: ${user.email}\nTemporary password: ${tempPassword ?? ''}\n\nPlease change your password after signing in (Settings → Profile).`
  const digits = user.phone.replace(/\D/g, '')
  const waNumber = digits.length === 10 ? `91${digits}` : digits
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      toastError(e, 'Could not copy — select the text and copy it manually.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={reset ? 'New temporary password' : 'Login created'}
      description="This password is shown only once. Share it now."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm">
          <Row label="Name" value={user.name} />
          <Row label="Login URL" value={<span className="break-all">{loginUrl}</span>} />
          <Row label="Email" value={<span className="break-all">{user.email}</span>} />
          <Row label="Temporary password" value={<span className="select-all font-mono text-base font-semibold text-slate-900">{tempPassword}</span>} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" />
            Share on WhatsApp
          </a>
        </div>
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          Ask them to change it after their first sign-in. You can reset it again any time.
        </p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

function BillingTab() {
  const orgQ = useOrg()
  const changePlan = useChangePlan()

  return (
    <QueryView query={orgQ}>
      {(org) => {
        const current = planInfo(org.plan)
        const beds = org.usage.beds
        const maxBeds = org.limits.maxBeds
        const usagePct = maxBeds ? (beds / maxBeds) * 100 : 0
        const monthly = (p: PlanInfo) => p.pricePerBed * beds
        const order = (p: Plan) => PLANS.findIndex((x) => x.id === p)

        const choose = async (p: PlanInfo) => {
          const up = order(p.id) > order(current.id)
          const ok = await confirm({
            title: up ? `Upgrade to ${p.name}?` : `Switch to ${p.name}?`,
            message: `${p.name}: ${p.pricePerBed ? `${formatMoney(p.pricePerBed)} per bed per month (about ${formatMoney(monthly(p))}/month for your ${beds} beds)` : 'free'}.${
              up ? '' : ` Modules not included in ${p.name} will be locked; your data stays safe and unlocks again if you upgrade.`
            }`,
            confirmText: up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`,
            danger: !up,
          })
          if (ok) changePlan.mutate(p.id)
        }

        return (
          <div className="space-y-6">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-center">
                <div className="flex-1">
                  <p className="text-sm text-slate-500">Current plan</p>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-slate-900">{org.limits.name}</h2>
                    <Badge tone="blue">{org.limits.pricePerBed ? `${formatMoney(org.limits.pricePerBed)}/bed/mo` : 'Free'}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{current.tagline}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {org.usage.hostels} hostel{org.usage.hostels === 1 ? '' : 's'} · {org.usage.activeHostelers} active hostelers
                  </p>
                </div>
                <div className="w-full md:w-80">
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-slate-600">Beds used</span>
                    <span className="font-medium text-slate-900">
                      {beds} / {maxBeds ?? '∞'}
                    </span>
                  </div>
                  <ProgressBar value={maxBeds ? usagePct : 8} tone={usagePct > 100 ? 'red' : usagePct > 85 ? 'amber' : 'brand'} />
                  {maxBeds && beds > maxBeds ? (
                    <p className="mt-1.5 text-xs text-red-600">You're over your plan's bed limit. Upgrade to keep adding beds.</p>
                  ) : (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Estimated bill: <span className="font-semibold text-slate-800">{formatMoney(org.limits.pricePerBed * beds)}</span> / month
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-3">
              {PLANS.map((p) => {
                const isCurrent = p.id === org.plan
                const tooSmall = p.maxBeds !== null && beds > p.maxBeds
                const up = order(p.id) > order(current.id)
                const busy = changePlan.isPending && changePlan.variables === p.id
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
                      disabled={isCurrent || tooSmall || changePlan.isPending}
                      loading={busy}
                      icon={up && !isCurrent ? <Sparkles className="h-4 w-4" /> : undefined}
                      onClick={() => void choose(p)}
                    >
                      {isCurrent ? 'Current plan' : tooSmall ? `Too many beds (${beds})` : up ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                    </Button>
                  </Card>
                )
              })}
            </div>

            <Card className="p-5">
              <p className="font-medium text-slate-900">Payments for subscriptions coming soon</p>
              <p className="mt-1 text-sm text-slate-500">
                Plan changes apply immediately. Online billing and invoices for your HostelHub subscription will be added here later — you won't be charged
                until then.
              </p>
            </Card>
          </div>
        )
      }}
    </QueryView>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-slate-800">{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

function PreferencesTab() {
  const orgQ = useOrg()
  return <QueryView query={orgQ}>{(org) => <PreferencesForm key={org.updatedAt} settings={org.settings} />}</QueryView>
}

function PreferencesForm({ settings }: { settings: SettingsT }) {
  const save = useUpdateOrgSettings()
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

  const submit = () => {
    const e: typeof errors = {}
    const due = Number(form.rentDueDay)
    if (form.rentDueDay.trim() === '' || !Number.isInteger(due) || due < 0 || due > 28) e.rentDueDay = 'Enter a number of days from 0 to 28.'
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
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.nightCurfew)) e.nightCurfew = 'Enter a time.'
    setErrors(e)
    if (Object.keys(e).length) return
    save.mutate({
      rentDueDay: due,
      lateFeePerDay: late,
      receiptPrefix: prefix,
      defaultSecurityDeposit: dep,
      messMonthlyCharge: mess,
      nightCurfew: form.nightCurfew,
    })
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Hostel preferences" subtitle="Defaults used for rent, receipts, check-ins and the mess." />
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        <Field
          label="Days to pay after a bill is created"
          error={errors.rentDueDay}
          hint="Bills are created on each hosteler's check-in date every month; this many days later they are due (0 = due the same day, max 28)"
        >
          <Input type="number" min={0} max={28} value={form.rentDueDay} onChange={set('rentDueDay')} />
        </Field>
        <Field label="Late fee per day (₹)" error={errors.lateFeePerDay} hint="Shown on overdue invoices">
          <Input type="number" min={0} value={form.lateFeePerDay} onChange={set('lateFeePerDay')} />
        </Field>
        <Field label="Receipt number prefix" error={errors.receiptPrefix} hint={`Receipts look like ${form.receiptPrefix.trim().toUpperCase() || 'RCPT'}-5001`}>
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
        <Button
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            setForm(toForm(settings))
            setErrors({})
          }}
        >
          Reset
        </Button>
        <Button onClick={submit} loading={save.isPending}>
          Save preferences
        </Button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function DataTab() {
  const orgQ = useOrg()
  const [exporting, setExporting] = useState(false)

  const exportBackup = async () => {
    setExporting(true)
    try {
      await orgApi.exportBackup()
      toast.success('Backup downloaded')
    } catch (e) {
      toastError(e, 'Could not export the backup')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader title="Your data" subtitle="Stored securely on HostelHub's servers, separate from other accounts." />
        {orgQ.isLoading ? (
          <LoadingState />
        ) : orgQ.data ? (
          <div className="grid grid-cols-3 gap-3 p-5">
            {[
              { label: 'Hostels', value: orgQ.data.usage.hostels },
              { label: 'Beds', value: orgQ.data.usage.beds },
              { label: 'Active hostelers', value: orgQ.data.usage.activeHostelers },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-lg font-bold text-slate-900">{x.value}</p>
                <p className="text-xs text-slate-500">{x.label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Backup" />
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-medium text-slate-900">Export full backup</p>
            <p className="text-sm text-slate-500">
              Download every record of your organization (hostels, rooms, hostelers, invoices, payments, expenses and more) as a JSON file. Uploaded document
              files are not included. Passwords are never exported.
            </p>
          </div>
          <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => void exportBackup()}>
            Export backup
          </Button>
        </div>
      </Card>
    </div>
  )
}
