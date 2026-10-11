import { useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ChefHat,
  Copy,
  MessageSquareText,
  Pencil,
  PiggyBank,
  Printer,
  Star,
  Trash2,
  UserMinus,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { useStore } from '@/store'
import { inScope, useHostelName, useHostelerMap, useScope, useScopedHostelers } from '@/store/selectors'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
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
  Tabs,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatDate, formatMoney, today } from '@/lib/utils'
import type { ID, Meal } from '@/types'
import { DAY_NAMES, HostelSelect, MEALS, MEAL_LABEL, MEAL_TIME, WEEK_ORDER, useBedLabeler, useHostelPicker } from './_ops'

type TabKey = 'today' | 'menu' | 'members' | 'optouts' | 'feedback'

export default function Mess() {
  const [tab, setTab] = useState<TabKey>('today')
  const optOuts = useStore((s) => s.mealOptOuts)
  const feedback = useStore((s) => s.messFeedback)
  const scope = useScope()
  const upcomingOpt = optOuts.filter((o) => o.date >= today() && inScope(o.hostelId, scope)).length
  const fbCount = feedback.filter((f) => inScope(f.hostelId, scope)).length

  return (
    <div>
      <div className="no-print">
        <PageHeader title="Mess" subtitle="Daily menu, headcount, members, opt-outs and food feedback" />
        <Tabs<TabKey>
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'today', label: 'Today' },
            { value: 'menu', label: 'Weekly menu' },
            { value: 'members', label: 'Members' },
            { value: 'optouts', label: 'Opt-outs', count: upcomingOpt },
            { value: 'feedback', label: 'Feedback', count: fbCount },
          ]}
        />
      </div>
      {tab === 'today' && <TodayTab />}
      {tab === 'menu' && <MenuTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'optouts' && <OptOutsTab />}
      {tab === 'feedback' && <FeedbackTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

function TodayTab() {
  const [date, setDate] = useState(today())
  const { hostelId, setHostelId, needsPicker } = useHostelPicker()
  const hostelName = useHostelName()
  const messMenu = useStore((s) => s.messMenu)
  const optOuts = useStore((s) => s.mealOptOuts)
  const hostelers = useStore((s) => s.hostelers)
  const leaves = useStore((s) => s.leaves)
  const beds = useBedLabeler()

  const day = parseISO(date).getDay()
  const members = useMemo(
    () => hostelers.filter((h) => h.status === 'active' && h.messOpted && h.hostelId === hostelId),
    [hostelers, hostelId],
  )
  const onLeave = useMemo(
    () =>
      new Set(
        leaves
          .filter((l) => l.status === 'approved' && l.hostelId === hostelId && l.from <= date && l.to >= date)
          .map((l) => l.hostelerId),
      ),
    [leaves, hostelId, date],
  )
  const memberIds = new Set(members.map((m) => m.id))
  const hMap = new Map(hostelers.map((h) => [h.id, h]))

  const perMeal = MEALS.map((meal) => {
    const outs = optOuts.filter((o) => o.date === date && o.meal === meal && memberIds.has(o.hostelerId))
    const outIds = new Set(outs.map((o) => o.hostelerId))
    const leaveOnly = [...onLeave].filter((id) => memberIds.has(id) && !outIds.has(id))
    const items = messMenu.find((m) => m.hostelId === hostelId && m.day === day && m.meal === meal)?.items ?? ''
    return {
      meal,
      items,
      outs,
      leaveOnly,
      headcount: Math.max(members.length - outs.length - leaveOnly.length, 0),
    }
  })

  if (!hostelId)
    return (
      <Card>
        <EmptyState icon={<ChefHat className="h-6 w-6" />} title="No hostel yet" description="Add a hostel to start managing the mess." />
      </Card>
    )

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end gap-3">
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </Field>
        {needsPicker && (
          <Field label="Hostel">
            <HostelSelect value={hostelId} onChange={setHostelId} className="min-w-[200px]" />
          </Field>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDate(format(addDays(parseISO(date), -1), 'yyyy-MM-dd'))}>
            Prev
          </Button>
          <Button variant="outline" onClick={() => setDate(today())}>
            Today
          </Button>
          <Button variant="outline" onClick={() => setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))}>
            Next
          </Button>
        </div>
        <Button className="sm:ml-auto" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
          Kitchen sheet
        </Button>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Kitchen sheet – {hostelName(hostelId)}</h1>
        <p className="text-sm text-slate-600">
          {DAY_NAMES[day]}, {formatDate(date)} · {members.length} mess members
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 print:grid-cols-4">
        {perMeal.map((m) => (
          <Card key={m.meal} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{MEAL_LABEL[m.meal]}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{m.headcount}</p>
            <p className="text-xs text-slate-500">plates to prepare</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {perMeal.map((m) => (
          <Card key={m.meal} className="break-inside-avoid">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <UtensilsCrossed className="h-4 w-4 text-brand-600" />
                  {MEAL_LABEL[m.meal]}
                </span>
              }
              subtitle={MEAL_TIME[m.meal]}
              action={
                <Badge tone="blue">
                  {m.headcount} / {members.length}
                </Badge>
              }
            />
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Menu</p>
                <p className={cn('mt-1 text-sm', m.items ? 'text-slate-800' : 'italic text-slate-400')}>
                  {m.items || 'No menu set for this day'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Not eating ({m.outs.length + m.leaveOnly.length})
                </p>
                {m.outs.length + m.leaveOnly.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-400">Everyone is eating</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {m.outs.map((o) => {
                      const h = hMap.get(o.hostelerId)
                      return (
                        <li key={o.id}>
                          <Badge tone="amber">
                            {h?.name ?? 'Unknown'}
                            {h?.roomId ? ` · ${beds.room(h.roomId)}` : ''}
                          </Badge>
                        </li>
                      )
                    })}
                    {m.leaveOnly.map((id) => (
                      <li key={id}>
                        <Badge tone="violet">{hMap.get(id)?.name ?? 'Unknown'} · on leave</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Weekly menu                                                         */
/* ------------------------------------------------------------------ */

function MenuTab() {
  const { hostelId, setHostelId, needsPicker } = useHostelPicker()
  const hostels = useStore((s) => s.hostels)
  const messMenu = useStore((s) => s.messMenu)
  const setMenuEntry = useStore((s) => s.setMenuEntry)
  const hostelName = useHostelName()
  const [editing, setEditing] = useState<{ day: number; meal: Meal } | null>(null)
  const [text, setText] = useState('')
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState('')

  const todayDay = new Date().getDay()
  const get = (day: number, meal: Meal) =>
    messMenu.find((m) => m.hostelId === hostelId && m.day === day && m.meal === meal)?.items ?? ''

  const openEdit = (day: number, meal: Meal) => {
    setEditing({ day, meal })
    setText(get(day, meal))
  }
  const save = () => {
    if (!editing) return
    setMenuEntry(hostelId, editing.day, editing.meal, text.trim())
    toast.success(`${DAY_NAMES[editing.day]} ${MEAL_LABEL[editing.meal].toLowerCase()} updated`)
    setEditing(null)
  }

  const others = hostels.filter((h) => h.id !== hostelId)
  const doCopy = async () => {
    if (!copyFrom) return
    const src = messMenu.filter((m) => m.hostelId === copyFrom)
    if (!src.length) {
      toast.error(`${hostelName(copyFrom)} has no menu to copy`)
      return
    }
    const ok = await confirm({
      title: 'Replace weekly menu?',
      message: `The menu of ${hostelName(hostelId)} will be overwritten with ${hostelName(copyFrom)}'s menu (${src.length} entries).`,
      confirmText: 'Copy menu',
      danger: true,
    })
    if (!ok) return
    src.forEach((m) => setMenuEntry(hostelId, m.day, m.meal, m.items))
    toast.success('Menu copied')
    setCopyOpen(false)
  }

  if (!hostelId)
    return (
      <Card>
        <EmptyState icon={<ChefHat className="h-6 w-6" />} title="No hostel yet" />
      </Card>
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {needsPicker && (
          <Field label="Hostel">
            <HostelSelect value={hostelId} onChange={setHostelId} className="min-w-[200px]" />
          </Field>
        )}
        <p className="pb-2 text-sm text-slate-500">Click any cell to edit that meal.</p>
        {others.length > 0 && (
          <Button
            variant="outline"
            className="sm:ml-auto"
            icon={<Copy className="h-4 w-4" />}
            onClick={() => {
              setCopyFrom(others[0]!.id)
              setCopyOpen(true)
            }}
          >
            Copy menu from other hostel
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-28 px-4 py-3 text-left">Day</th>
                {MEALS.map((m) => (
                  <th key={m} className="px-3 py-3 text-left">
                    {MEAL_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEK_ORDER.map((day) => (
                <tr key={day} className={cn('border-b border-slate-100 last:border-0', day === todayDay && 'bg-brand-50/40')}>
                  <td className="px-4 py-3 align-top font-medium text-slate-800">
                    {DAY_NAMES[day]}
                    {day === todayDay && <span className="block text-xs font-normal text-brand-600">Today</span>}
                  </td>
                  {MEALS.map((meal) => {
                    const v = get(day, meal)
                    return (
                      <td key={meal} className="p-1.5 align-top">
                        <button
                          type="button"
                          onClick={() => openEdit(day, meal)}
                          className="group flex min-h-[64px] w-full items-start justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-brand-200 hover:bg-white"
                        >
                          <span className={cn(v ? 'text-slate-700' : 'italic text-slate-400')}>{v || 'Not set'}</span>
                          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-brand-600" />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${DAY_NAMES[editing.day]} · ${MEAL_LABEL[editing.meal]}` : ''}
        description={hostelName(hostelId)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        <Field label="Items" hint="Separate dishes with commas, e.g. Dal, Rice, Roti, Salad (Ctrl+Enter to save)">
          <Textarea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
            }}
          />
        </Field>
      </Modal>

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        size="sm"
        title="Copy menu"
        description={`Copy the full weekly menu into ${hostelName(hostelId)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doCopy} icon={<Copy className="h-4 w-4" />}>
              Copy
            </Button>
          </>
        }
      >
        <Field label="Copy from">
          <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} options={others.map((h) => ({ value: h.id, label: h.name }))} />
        </Field>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

function MembersTab() {
  const scoped = useScopedHostelers()
  const updateHosteler = useStore((s) => s.updateHosteler)
  const charge = useStore((s) => s.settings.messMonthlyCharge)
  const hostelName = useHostelName()
  const scope = useScope()
  const beds = useBedLabeler()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')

  const active = scoped.filter((h) => h.status === 'active')
  const on = active.filter((h) => h.messOpted).length
  const rows = active
    .filter((h) => (filter === 'all' ? true : filter === 'on' ? h.messOpted : !h.messOpted))
    .filter((h) => !q || h.name.toLowerCase().includes(q.toLowerCase()) || h.phone.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Mess members" value={on} icon={<Users className="h-5 w-5" />} hint={`of ${active.length} active hostelers`} />
        <StatCard label="Not opted" value={active.length - on} icon={<UserMinus className="h-5 w-5" />} tone="slate" />
        <StatCard label="Monthly charge" value={formatMoney(charge)} icon={<Wallet className="h-5 w-5" />} tone="violet" hint="per member · change in Settings" />
        <StatCard label="Monthly mess billing" value={formatMoney(on * charge)} icon={<PiggyBank className="h-5 w-5" />} tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or phone…" className="sm:w-72" />
          <Select
            className="sm:w-44"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            options={[
              { value: 'all', label: 'All hostelers' },
              { value: 'on', label: 'Mess on' },
              { value: 'off', label: 'Mess off' },
            ]}
          />
          <p className="text-sm text-slate-500 sm:ml-auto">{rows.length} shown</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No hostelers found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Hosteler</TH>
                <TH>Room</TH>
                {scope === 'all' && <TH>Hostel</TH>}
                <TH>Mess</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((h) => (
                <TR key={h.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={h.name} src={h.photo} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{h.name}</p>
                        <p className="text-xs text-slate-500">{h.phone}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">{beds.label(h.roomId, h.bedId)}</TD>
                  {scope === 'all' && <TD>{hostelName(h.hostelId)}</TD>}
                  <TD>
                    <Switch
                      checked={h.messOpted}
                      label={h.messOpted ? 'On' : 'Off'}
                      onChange={(v) => {
                        updateHosteler(h.id, { messOpted: v })
                        toast.success(`Mess ${v ? 'enabled' : 'disabled'} for ${h.name}`)
                      }}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Opt-outs                                                            */
/* ------------------------------------------------------------------ */

function OptOutsTab() {
  const scope = useScope()
  const scoped = useScopedHostelers()
  const optOuts = useStore((s) => s.mealOptOuts)
  const toggleOptOut = useStore((s) => s.toggleOptOut)
  const charge = useStore((s) => s.settings.messMonthlyCharge)
  const hMap = useHostelerMap()
  const beds = useBedLabeler()

  const members = scoped.filter((h) => h.status === 'active' && h.messOpted).sort((a, b) => a.name.localeCompare(b.name))
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(new Date(), i), 'yyyy-MM-dd'))
  const [hostelerId, setHostelerId] = useState<ID>('')
  const [date, setDate] = useState(days[0]!)
  const [meals, setMeals] = useState<Meal[]>(['lunch'])
  const [q, setQ] = useState('')

  const month = today().slice(0, 7)
  const inScopeOuts = optOuts.filter((o) => inScope(o.hostelId, scope))
  const monthCount = inScopeOuts.filter((o) => o.date.startsWith(month)).length
  const perMeal = charge / 30 / 4
  const upcoming = inScopeOuts
    .filter((o) => o.date >= today())
    .filter((o) => !q || (hMap.get(o.hostelerId)?.name ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))

  const add = () => {
    if (!hostelerId) return toast.error('Select a hosteler')
    if (!meals.length) return toast.error('Select at least one meal')
    let added = 0
    for (const meal of meals) {
      const exists = optOuts.some((o) => o.hostelerId === hostelerId && o.date === date && o.meal === meal)
      if (!exists) {
        toggleOptOut(hostelerId, date, meal)
        added++
      }
    }
    if (added) toast.success(`${added} meal${added > 1 ? 's' : ''} opted out for ${hMap.get(hostelerId)?.name}`)
    else toast.info('Already opted out for the selected meals')
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Meals saved this month" value={monthCount} icon={<UtensilsCrossed className="h-5 w-5" />} tone="green" />
        <StatCard
          label="Estimated savings"
          value={formatMoney(monthCount * perMeal)}
          icon={<PiggyBank className="h-5 w-5" />}
          tone="violet"
          hint={`@ ₹${perMeal.toFixed(2)} per meal`}
        />
        <StatCard label="Upcoming opt-outs" value={inScopeOuts.filter((o) => o.date >= today()).length} icon={<UserMinus className="h-5 w-5" />} tone="amber" />
        <StatCard label="Today's opt-outs" value={inScopeOuts.filter((o) => o.date === today()).length} icon={<ChefHat className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Add opt-out" subtitle="For the next 7 days" />
          <div className="space-y-4 p-5">
            <Field label="Hosteler" required>
              <Select
                value={hostelerId}
                onChange={(e) => setHostelerId(e.target.value)}
                placeholder="Select mess member…"
                options={members.map((h) => ({ value: h.id, label: `${h.name}${h.roomId ? ` (Room ${beds.room(h.roomId)})` : ''}` }))}
              />
            </Field>
            <Field label="Date" required>
              <Select
                value={date}
                onChange={(e) => setDate(e.target.value)}
                options={days.map((d, i) => ({
                  value: d,
                  label: `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[parseISO(d).getDay()]} · ${formatDate(d, 'dd MMM')}`,
                }))}
              />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Meals</span>
              <div className="grid grid-cols-2 gap-2">
                {MEALS.map((m) => {
                  const on = meals.includes(m)
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMeals((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm font-medium transition',
                        on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {MEAL_LABEL[m]}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button className="w-full" onClick={add} disabled={!members.length}>
              Add opt-out
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming opt-outs" action={<SearchInput value={q} onChange={setQ} placeholder="Search…" className="w-40 sm:w-56" />} />
          {upcoming.length === 0 ? (
            <EmptyState icon={<UserMinus className="h-6 w-6" />} title="No upcoming opt-outs" description="Opt-outs reduce the plate count for the kitchen." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Meal</TH>
                  <TH>Hosteler</TH>
                  <TH className="text-right">Remove</TH>
                </tr>
              </THead>
              <tbody>
                {upcoming.map((o) => {
                  const h = hMap.get(o.hostelerId)
                  return (
                    <TR key={o.id}>
                      <TD className="whitespace-nowrap">
                        <span className="font-medium text-slate-800">{formatDate(o.date, 'EEE, dd MMM')}</span>
                        {o.date === today() && (
                          <Badge tone="blue" className="ml-2">
                            Today
                          </Badge>
                        )}
                      </TD>
                      <TD>{MEAL_LABEL[o.meal]}</TD>
                      <TD>
                        <p className="font-medium text-slate-800">{h?.name ?? 'Unknown'}</p>
                        <p className="text-xs text-slate-500">{h ? beds.label(h.roomId, h.bedId) : ''}</p>
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove opt-out"
                          icon={<Trash2 className="h-4 w-4 text-red-500" />}
                          onClick={() => {
                            toggleOptOut(o.hostelerId, o.date, o.meal)
                            toast.success('Opt-out removed')
                          }}
                        />
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn('h-4 w-4', i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
      ))}
    </span>
  )
}

function FeedbackTab() {
  const scope = useScope()
  const feedback = useStore((s) => s.messFeedback)
  const hMap = useHostelerMap()
  const hostelName = useHostelName()
  const [meal, setMeal] = useState<Meal | 'all'>('all')
  const [rating, setRating] = useState<string>('all')

  const scoped = feedback.filter((f) => inScope(f.hostelId, scope))
  const chart = MEALS.map((m) => {
    const list = scoped.filter((f) => f.meal === m)
    return {
      meal: MEAL_LABEL[m],
      avg: list.length ? Number((list.reduce((a, f) => a + f.rating, 0) / list.length).toFixed(2)) : 0,
      count: list.length,
    }
  })
  const overall = scoped.length ? scoped.reduce((a, f) => a + f.rating, 0) / scoped.length : 0
  const rows = scoped
    .filter((f) => meal === 'all' || f.meal === meal)
    .filter((f) => rating === 'all' || (rating === 'low' ? f.rating <= 2 : f.rating >= 4))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Overall rating</p>
          <div className="mt-2 flex items-end gap-2">
            <p className="text-4xl font-bold text-slate-900">{overall ? overall.toFixed(1) : '—'}</p>
            <p className="pb-1 text-sm text-slate-500">/ 5</p>
          </div>
          <div className="mt-2">
            <Stars value={Math.round(overall)} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{scoped.length} reviews</p>
          <div className="mt-4 space-y-2">
            {[5, 4, 3, 2, 1].map((r) => {
              const n = scoped.filter((f) => f.rating === r).length
              return (
                <div key={r} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="w-3">{r}</span>
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${scoped.length ? (n / scoped.length) * 100 : 0}%` }} />
                  </div>
                  <span className="w-6 text-right">{n}</span>
                </div>
              )
            })}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Average rating by meal" />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="meal" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(v, _n, p) => [`${v} ★ (${(p.payload as { count: number }).count} reviews)`, 'Average']}
                />
                <Bar dataKey="avg" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <Select
            className="sm:w-44"
            value={meal}
            onChange={(e) => setMeal(e.target.value as Meal | 'all')}
            options={[{ value: 'all', label: 'All meals' }, ...MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))]}
          />
          <Select
            className="sm:w-44"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            options={[
              { value: 'all', label: 'All ratings' },
              { value: 'high', label: '4★ and above' },
              { value: 'low', label: '2★ and below' },
            ]}
          />
          <p className="text-sm text-slate-500 sm:ml-auto">{rows.length} reviews</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="No feedback yet" description="Hostelers can rate meals from their portal." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((f) => {
              const h = hMap.get(f.hostelerId)
              return (
                <li key={f.id} className="flex gap-3 px-5 py-4">
                  <Avatar name={h?.name ?? '?'} src={h?.photo} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{h?.name ?? 'Former hosteler'}</p>
                      <Stars value={f.rating} />
                      <Badge>{MEAL_LABEL[f.meal]}</Badge>
                      {scope === 'all' && <span className="text-xs text-slate-400">{hostelName(f.hostelId)}</span>}
                    </div>
                    {f.comment && <p className="mt-1 text-sm text-slate-600">{f.comment}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDate(f.date, 'EEE, dd MMM yyyy')}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
