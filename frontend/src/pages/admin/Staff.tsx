import { useMemo, useState, type ReactNode } from 'react'
import { endOfMonth, format, parseISO } from 'date-fns'
import { BadgeCheck, Banknote, Pencil, Phone, Plus, Power, Trash2, UserCog, Users, Wallet } from 'lucide-react'
import { useStore } from '@/store'
import { inScope, useHostelName, useScope } from '@/store/selectors'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
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
  toast,
} from '@/components/ui'
import { cn, currentMonth, formatDate, formatMoney, formatMonth, titleCase, today } from '@/lib/utils'
import type { Expense, PaymentMode, Staff as StaffMember, StaffRole } from '@/types'
import { HostelSelect, STAFF_ROLES, useHostelPicker } from './_ops'

const ROLE_TONE: Record<StaffRole, 'blue' | 'violet' | 'green' | 'amber' | 'red' | 'slate'> = {
  manager: 'violet',
  warden: 'blue',
  accountant: 'green',
  cook: 'amber',
  security: 'red',
  cleaner: 'slate',
}

const salaryNote = (month: string) => `Salary ${formatMonth(month)}`

function isPaid(expenses: Expense[], s: StaffMember, month: string) {
  const note = salaryNote(month)
  return expenses.some((e) => e.category === 'salary' && e.note === note && e.paidTo === s.name && e.hostelId === s.hostelId)
}

export default function Staff() {
  const scope = useScope()
  const staff = useStore((s) => s.staff)
  const expenses = useStore((s) => s.expenses)
  const updateStaff = useStore((s) => s.updateStaff)
  const deleteStaff = useStore((s) => s.deleteStaff)
  const hostelName = useHostelName()
  const [role, setRole] = useState<StaffRole | 'all'>('all')
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null)
  const [payOpen, setPayOpen] = useState(false)

  const month = currentMonth()
  const scoped = useMemo(() => staff.filter((s) => inScope(s.hostelId, scope)), [staff, scope])
  const active = scoped.filter((s) => s.active)
  const payroll = active.reduce((a, s) => a + s.salary, 0)
  const paidThisMonth = active.filter((s) => isPaid(expenses, s, month))
  const paidAmount = paidThisMonth.reduce((a, s) => a + s.salary, 0)

  const rows = scoped
    .filter((s) => showInactive || s.active)
    .filter((s) => role === 'all' || s.role === role)
    .filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.phone.includes(q))
    .sort((a, b) => Number(b.active) - Number(a.active) || STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.name.localeCompare(b.name))

  const roleCounts = STAFF_ROLES.map((r) => ({ r, n: active.filter((s) => s.role === r).length }))

  const toggleActive = async (s: StaffMember) => {
    if (s.active) {
      const ok = await confirm({
        title: `Deactivate ${s.name}?`,
        message: 'Inactive staff are excluded from payroll and complaint assignment. You can reactivate them later.',
        confirmText: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    updateStaff(s.id, { active: !s.active })
    toast.success(`${s.name} ${s.active ? 'deactivated' : 'reactivated'}`)
  }

  const remove = async (s: StaffMember) => {
    const ok = await confirm({
      title: `Delete ${s.name}?`,
      message: 'This permanently removes the staff record. Past salary expenses are kept.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    deleteStaff(s.id)
    toast.success('Staff member deleted')
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
        {rows.length === 0 ? (
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
              {rows.map((s) => {
                const paid = isPaid(expenses, s, month)
                return (
                  <TR key={s.id} className={cn(!s.active && 'opacity-60')}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={s.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {s.name}
                            {!s.active && (
                              <Badge className="ml-2" tone="slate">
                                Inactive
                              </Badge>
                            )}
                          </p>
                          <a href={`tel:${s.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
                            <Phone className="h-3 w-3" />
                            {s.phone || '—'}
                          </a>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={ROLE_TONE[s.role]}>{titleCase(s.role)}</Badge>
                    </TD>
                    {scope === 'all' && <TD className="whitespace-nowrap">{hostelName(s.hostelId)}</TD>}
                    <TD className="whitespace-nowrap text-xs">{formatDate(s.joinDate)}</TD>
                    <TD className="whitespace-nowrap text-right font-medium text-slate-900">{formatMoney(s.salary)}</TD>
                    <TD>
                      {paid ? (
                        <Badge tone="green">
                          <BadgeCheck className="h-3 w-3" /> Paid
                        </Badge>
                      ) : s.active ? (
                        <Badge tone="amber">Unpaid</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <ActionBtn label="Edit" onClick={() => setEditing(s)}>
                          <Pencil className="h-4 w-4" />
                        </ActionBtn>
                        <ActionBtn label={s.active ? 'Deactivate' : 'Reactivate'} onClick={() => toggleActive(s)}>
                          <Power className={cn('h-4 w-4', s.active ? '' : 'text-emerald-600')} />
                        </ActionBtn>
                        <ActionBtn label="Delete" danger onClick={() => remove(s)}>
                          <Trash2 className="h-4 w-4" />
                        </ActionBtn>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <StaffModal staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {payOpen && <PaySalariesModal onClose={() => setPayOpen(false)} />}
    </div>
  )
}

function ActionBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function StaffModal({ staff, onClose }: { staff: StaffMember | null; onClose: () => void }) {
  const { hostelId: defaultHostel } = useHostelPicker()
  const addStaff = useStore((s) => s.addStaff)
  const updateStaff = useStore((s) => s.updateStaff)
  const [hostelId, setHostelId] = useState(staff?.hostelId ?? '')
  const [name, setName] = useState(staff?.name ?? '')
  const [phone, setPhone] = useState(staff?.phone ?? '')
  const [role, setRole] = useState<StaffRole>(staff?.role ?? 'warden')
  const [salary, setSalary] = useState(staff ? String(staff.salary) : '')
  const [joinDate, setJoinDate] = useState(staff?.joinDate ?? today())
  const [active, setActive] = useState(staff?.active ?? true)
  const [err, setErr] = useState<Record<string, string>>({})
  const hid = hostelId || defaultHostel

  const submit = () => {
    const e: Record<string, string> = {}
    if (!hid) e.hostel = 'Select a hostel'
    if (!name.trim()) e.name = 'Name is required'
    const digits = phone.replace(/\D/g, '')
    if (!digits) e.phone = 'Phone is required'
    else if (digits.length < 10) e.phone = 'Enter a valid phone number'
    const sal = Number(salary)
    if (salary === '' || Number.isNaN(sal) || sal < 0) e.salary = 'Enter a valid salary'
    if (!joinDate) e.joinDate = 'Required'
    setErr(e)
    if (Object.keys(e).length) return
    const data = { hostelId: hid, name: name.trim(), phone: phone.trim(), role, salary: Math.round(sal), joinDate, active }
    if (staff) {
      updateStaff(staff.id, data)
      toast.success('Staff details updated')
    } else {
      addStaff(data)
      toast.success(`${data.name} added`)
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={staff ? 'Edit staff' : 'Add staff'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{staff ? 'Save changes' : 'Add staff'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={err.name} className="sm:col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
        </Field>
        <Field label="Phone" required error={err.phone}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" />
        </Field>
        <Field label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} options={STAFF_ROLES.map((r) => ({ value: r, label: titleCase(r) }))} />
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
  const staff = useStore((s) => s.staff)
  const expenses = useStore((s) => s.expenses)
  const addExpense = useStore((s) => s.addExpense)
  const hostelName = useHostelName()
  const [month, setMonth] = useState(currentMonth())
  const [mode, setMode] = useState<PaymentMode>('bank')

  const active = staff.filter((s) => s.active && inScope(s.hostelId, scope)).sort((a, b) => a.name.localeCompare(b.name))
  const pending = active.filter((s) => !isPaid(expenses, s, month))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(active.map((s) => s.id)))
  const toPay = pending.filter((s) => selected.has(s.id))
  const total = toPay.reduce((a, s) => a + s.salary, 0)

  const pay = async () => {
    if (!toPay.length) return
    const ok = await confirm({
      title: `Pay ${toPay.length} salar${toPay.length > 1 ? 'ies' : 'y'}?`,
      message: `${formatMoney(total)} will be recorded as salary expenses for ${formatMonth(month)}.`,
      confirmText: 'Record payments',
    })
    if (!ok) return
    const date = month === currentMonth() ? today() : format(endOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd')
    // re-check against fresh state to avoid duplicates
    const fresh = useStore.getState().expenses
    let n = 0
    for (const s of toPay) {
      if (isPaid(fresh, s, month)) continue
      addExpense({ hostelId: s.hostelId, category: 'salary', amount: s.salary, date, paidTo: s.name, mode, note: salaryNote(month) })
      n++
    }
    toast.success(`${n} salary payment${n === 1 ? '' : 's'} recorded for ${formatMonth(month)}`)
    onClose()
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon={<Banknote className="h-4 w-4" />} onClick={pay} disabled={!toPay.length}>
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

        {active.length === 0 ? (
          <p className="text-sm text-slate-500">No active staff in this scope.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {active.map((s) => {
              const paid = isPaid(expenses, s, month)
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <label className={cn('flex min-w-0 items-center gap-3', paid ? 'cursor-default' : 'cursor-pointer')}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      disabled={paid}
                      checked={paid || selected.has(s.id)}
                      onChange={(e) =>
                        setSelected((cur) => {
                          const next = new Set(cur)
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
