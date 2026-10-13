import { useEffect, useState, type ReactNode } from 'react'
import { BadgeCheck, Banknote, Loader2, Pencil, Phone, Plus, Power, Trash2, UserCog, Users, Wallet } from 'lucide-react'
import { useHostelName, useScope } from '@/api/common'
import {
  DIRECTORY_ROLES,
  useCreateStaff,
  useDeleteStaff,
  usePaySalaries,
  useStaffList,
  useUpdateStaff,
  type DirectoryRole,
  type StaffMember,
} from '@/api/staff'
import type { PaymentMode } from '@/api/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  ErrorState,
  Modal,
  PageHeader,
  QueryView,
  SearchInput,
  Select,
  StatCard,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  confirm,
} from '@/components/ui'
import { cn, currentMonth, formatDate, formatMoney, formatMonth, titleCase, today } from '@/lib/utils'
import { HostelSelect, useHostelPicker } from './_ops'

const ROLE_TONE: Record<DirectoryRole, 'blue' | 'violet' | 'green' | 'amber' | 'red' | 'slate'> = {
  manager: 'violet',
  warden: 'blue',
  accountant: 'green',
  cook: 'amber',
  security: 'red',
  cleaner: 'slate',
}

export default function Staff() {
  const scope = useScope()
  const hostelName = useHostelName()
  const month = currentMonth()
  const query = useStaffList({ hostelId: scope, month })
  const update = useUpdateStaff()
  const del = useDeleteStaff()
  const [role, setRole] = useState<DirectoryRole | 'all'>('all')
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null)
  const [payOpen, setPayOpen] = useState(false)

  const scoped = query.data?.items ?? []
  const active = scoped.filter((s) => s.active)
  const payroll = active.reduce((a, s) => a + s.salary, 0)
  const paidThisMonth = active.filter((s) => s.paidThisMonth)
  const paidAmount = paidThisMonth.reduce((a, s) => a + s.salary, 0)

  const s = q.trim().toLowerCase()
  const rows = scoped
    .filter((x) => showInactive || x.active)
    .filter((x) => role === 'all' || x.role === role)
    .filter((x) => !s || x.name.toLowerCase().includes(s) || x.phone.includes(s))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || DIRECTORY_ROLES.indexOf(a.role) - DIRECTORY_ROLES.indexOf(b.role) || a.name.localeCompare(b.name),
    )

  const roleCounts = DIRECTORY_ROLES.map((r) => ({ r, n: active.filter((x) => x.role === r).length }))

  const toggleActive = async (m: StaffMember) => {
    if (m.active) {
      const ok = await confirm({
        title: `Deactivate ${m.name}?`,
        message: 'Inactive staff are excluded from payroll and complaint assignment. You can reactivate them later.',
        confirmText: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    update.mutate({ id: m.id, body: { active: !m.active }, success: `${m.name} ${m.active ? 'deactivated' : 'reactivated'}` })
  }

  const remove = async (m: StaffMember) => {
    const ok = await confirm({
      title: `Delete ${m.name}?`,
      message: 'This permanently removes the staff record. Past salary expenses are kept.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    del.mutate(m.id)
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Wardens, cooks, security and other team members"
        actions={
          <>
            <Button variant="outline" icon={<Banknote className="h-4 w-4" />} onClick={() => setPayOpen(true)} disabled={!active.length}>
              Pay salaries
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add staff
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active staff" value={active.length} icon={<Users className="h-5 w-5" />} hint={`${scoped.length - active.length} inactive`} />
        <StatCard label="Monthly salary total" value={formatMoney(payroll)} icon={<Wallet className="h-5 w-5" />} tone="violet" />
        <StatCard
          label={`Paid for ${formatMonth(month)}`}
          value={formatMoney(paidAmount)}
          icon={<BadgeCheck className="h-5 w-5" />}
          tone="green"
          hint={`${paidThisMonth.length} of ${active.length} staff`}
        />
        <StatCard
          label="Pending this month"
          value={formatMoney(payroll - paidAmount)}
          icon={<Banknote className="h-5 w-5" />}
          tone="amber"
          onClick={active.length ? () => setPayOpen(true) : undefined}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setRole('all')}
          className={cn(
            'rounded-full border px-3 py-1 text-sm font-medium transition',
            role === 'all' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          All · {active.length}
        </button>
        {roleCounts.map(({ r, n }) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition',
              role === r ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {titleCase(r)} · {n}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or phone…" className="sm:w-72" />
          <div className="sm:ml-auto">
            <Switch checked={showInactive} onChange={setShowInactive} label="Show inactive" />
          </div>
        </div>
        <QueryView query={query}>
          {() =>
            rows.length === 0 ? (
              <EmptyState
                icon={<UserCog className="h-6 w-6" />}
                title="No staff found"
                description="Add your wardens, cooks and security guards to manage payroll and assign complaints."
                action={
                  <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                    Add staff
                  </Button>
                }
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Role</TH>
                    {scope === 'all' && <TH>Hostel</TH>}
                    <TH>Joined</TH>
                    <TH className="text-right">Salary</TH>
                    <TH>{formatMonth(month)}</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((m) => {
                    const toggling = update.isPending && update.variables?.id === m.id
                    const deleting = del.isPending && del.variables === m.id
                    return (
                      <TR key={m.id} className={cn(!m.active && 'opacity-60', deleting && 'opacity-40')}>
                        <TD>
                          <div className="flex items-center gap-3">
                            <Avatar name={m.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">
                                {m.name}
                                {!m.active && (
                                  <Badge className="ml-2" tone="slate">
                                    Inactive
                                  </Badge>
                                )}
                              </p>
                              <a href={`tel:${m.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
                                <Phone className="h-3 w-3" />
                                {m.phone || '—'}
                              </a>
                            </div>
                          </div>
                        </TD>
                        <TD>
                          <Badge tone={ROLE_TONE[m.role]}>{titleCase(m.role)}</Badge>
                        </TD>
                        {scope === 'all' && <TD className="whitespace-nowrap">{hostelName(m.hostelId)}</TD>}
                        <TD className="whitespace-nowrap text-xs">{formatDate(m.joinDate)}</TD>
                        <TD className="whitespace-nowrap text-right font-medium text-slate-900">{formatMoney(m.salary)}</TD>
                        <TD>
                          {m.paidThisMonth ? (
                            <Badge tone="green">
                              <BadgeCheck className="h-3 w-3" /> Paid
                            </Badge>
                          ) : m.active ? (
                            <Badge tone="amber">Unpaid</Badge>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <ActionBtn label="Edit" onClick={() => setEditing(m)}>
                              <Pencil className="h-4 w-4" />
                            </ActionBtn>
                            <ActionBtn label={m.active ? 'Deactivate' : 'Reactivate'} onClick={() => toggleActive(m)} disabled={toggling}>
                              {toggling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Power className={cn('h-4 w-4', m.active ? '' : 'text-emerald-600')} />
                              )}
                            </ActionBtn>
                            <ActionBtn label="Delete" danger onClick={() => remove(m)} disabled={deleting}>
                              <Trash2 className="h-4 w-4" />
                            </ActionBtn>
                          </div>
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

      {editing && <StaffModal staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {payOpen && <PaySalariesModal onClose={() => setPayOpen(false)} />}
    </div>
  )
}

function ActionBtn({
  label,
  onClick,
  danger,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function StaffModal({ staff, onClose }: { staff: StaffMember | null; onClose: () => void }) {
  const { hostelId: defaultHostel } = useHostelPicker()
  const create = useCreateStaff()
  const update = useUpdateStaff()
  const [hostelId, setHostelId] = useState(staff?.hostelId ?? '')
  const [name, setName] = useState(staff?.name ?? '')
  const [phone, setPhone] = useState(staff?.phone ?? '')
  const [role, setRole] = useState<DirectoryRole>(staff?.role ?? 'warden')
  const [salary, setSalary] = useState(staff ? String(staff.salary) : '')
  const [joinDate, setJoinDate] = useState(staff?.joinDate ?? today())
  const [active, setActive] = useState(staff?.active ?? true)
  const [err, setErr] = useState<Record<string, string>>({})
  const hid = hostelId || defaultHostel || ''
  const saving = create.isPending || update.isPending

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hid) e.hostel = 'Select a hostel'
    if (name.trim().length < 2) e.name = 'Name is required'
    const digits = phone.replace(/\D/g, '')
    if (!digits) e.phone = 'Phone is required'
    else if (digits.length < 10) e.phone = 'Enter a valid phone number'
    const sal = Number(salary)
    if (salary === '' || Number.isNaN(sal) || sal < 0) e.salary = 'Enter a valid salary'
    if (!joinDate) e.joinDate = 'Required'
    setErr(e)
    if (Object.keys(e).length) return
    const data = { hostelId: hid, name: name.trim(), phone: phone.trim(), role, salary: Math.round(sal), joinDate, active }
    if (staff) update.mutate({ id: staff.id, body: data }, { onSuccess: onClose })
    else create.mutate(data, { onSuccess: onClose })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={staff ? 'Edit staff' : 'Add staff'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {staff ? 'Save changes' : 'Add staff'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={err.name} className="sm:col-span-2">
          <Input autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
        </Field>
        <Field label="Phone" required error={err.phone}>
          <Input value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" />
        </Field>
        <Field label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value as DirectoryRole)} options={DIRECTORY_ROLES.map((r) => ({ value: r, label: titleCase(r) }))} />
        </Field>
        <Field label="Hostel" required error={err.hostel}>
          <HostelSelect value={hid} onChange={setHostelId} />
        </Field>
        <Field label="Monthly salary (₹)" required error={err.salary}>
          <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="e.g. 15000" />
        </Field>
        <Field label="Joining date" required error={err.joinDate}>
          <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Switch checked={active} onChange={setActive} label="Active" />
        </div>
      </div>
    </Modal>
  )
}

function PaySalariesModal({ onClose }: { onClose: () => void }) {
  const scope = useScope()
  const hostelName = useHostelName()
  const [month, setMonth] = useState(currentMonth())
  const [mode, setMode] = useState<PaymentMode>('bank')
  const query = useStaffList({ hostelId: scope, month, active: 'true' })
  const pay = usePaySalaries()

  const active = [...(query.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const pending = active.filter((s) => !s.paidThisMonth)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  // select everyone the first time the list arrives
  useEffect(() => {
    if (selected === null && query.data) setSelected(new Set(query.data.items.map((s) => s.id)))
  }, [query.data, selected])
  const toPay = pending.filter((s) => selected?.has(s.id) && s.salary > 0)
  const total = toPay.reduce((a, s) => a + s.salary, 0)

  const doPay = async () => {
    if (!toPay.length) return
    const ok = await confirm({
      title: `Pay ${toPay.length} salar${toPay.length > 1 ? 'ies' : 'y'}?`,
      message: `${formatMoney(total)} will be recorded as salary expenses for ${formatMonth(month)}.`,
      confirmText: 'Record payments',
    })
    if (!ok) return
    pay.mutate({ month, mode, staffIds: toPay.map((s) => s.id) }, { onSuccess: onClose })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Pay salaries"
      description="Creates one salary expense per staff member. Staff already paid for the month are skipped."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pay.isPending}>
            Cancel
          </Button>
          <Button variant="success" icon={<Banknote className="h-4 w-4" />} onClick={doPay} loading={pay.isPending} disabled={!toPay.length || query.isFetching}>
            Pay {formatMoney(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Salary month">
            <Input type="month" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
          <Field label="Payment mode">
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as PaymentMode)}
              options={[
                { value: 'bank', label: 'Bank transfer' },
                { value: 'upi', label: 'UPI' },
                { value: 'cash', label: 'Cash' },
              ]}
            />
          </Field>
        </div>

        {query.isLoading ? (
          <LoadingState className="py-8" />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-8" />
        ) : active.length === 0 ? (
          <p className="text-sm text-slate-500">No active staff in this scope.</p>
        ) : (
          <ul className={cn('divide-y divide-slate-100 rounded-lg border border-slate-200', query.isFetching && 'opacity-70')}>
            {active.map((s) => {
              const paid = s.paidThisMonth
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <label className={cn('flex min-w-0 items-center gap-3', paid ? 'cursor-default' : 'cursor-pointer')}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      disabled={paid || s.salary <= 0}
                      checked={paid || (!!selected?.has(s.id) && s.salary > 0)}
                      onChange={(e) =>
                        setSelected((cur) => {
                          const next = new Set(cur ?? [])
                          if (e.target.checked) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {titleCase(s.role)}
                        {scope === 'all' ? ` · ${hostelName(s.hostelId)}` : ''}
                        {s.salary <= 0 ? ' · no salary set' : ''}
                      </p>
                    </div>
                  </label>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{formatMoney(s.salary)}</span>
                    {paid && (
                      <Badge tone="green">
                        <BadgeCheck className="h-3 w-3" /> Paid
                      </Badge>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-600">
            {toPay.length} to pay · {active.length - pending.length} already paid
          </span>
          <span className="font-semibold text-slate-900">{formatMoney(total)}</span>
        </div>
      </div>
    </Modal>
  )
}
