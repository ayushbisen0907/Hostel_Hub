import { useEffect, useState } from 'react'
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
import { useHostelName, useHostels, useScope, useSettings } from '@/api/common'
import {
  useAddOptOuts,
  useCopyMenu,
  useMessFeedback,
  useMessMembers,
  useMessMenu,
  useMessOptOuts,
  useMessStats,
  useMessToday,
  useRemoveOptOut,
  useSaveMenuEntry,
  useSetMessMember,
} from '@/api/mess'
import type { Meal } from '@/api/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
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
  Tabs,
  Textarea,
  confirm,
} from '@/components/ui'
import { cn, formatDate, formatMoney, today } from '@/lib/utils'
import {
  DAY_NAMES,
  HostelSelect,
  HostelerPicker,
  MEALS,
  MEAL_LABEL,
  MEAL_TIME,
  Pager,
  WEEK_ORDER,
  roomLabel,
  useHostelPicker,
  type HostelerHit,
} from './_ops'

type TabKey = 'today' | 'menu' | 'members' | 'optouts' | 'feedback'

export default function Mess() {
  const [tab, setTab] = useState<TabKey>('today')
  const scope = useScope()
  const upcoming = useMessOptOuts({ hostelId: scope, from: today() })
  const feedback = useMessFeedback({ hostelId: scope, page: 1, limit: 1 })

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
            { value: 'optouts', label: 'Opt-outs', count: upcoming.data?.length },
            { value: 'feedback', label: 'Feedback', count: feedback.data?.overall.count },
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

function NoHostel() {
  return (
    <Card>
      <EmptyState icon={<ChefHat className="h-6 w-6" />} title="No hostel yet" description="Add a hostel to start managing the mess." />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

function TodayTab() {
  const [date, setDate] = useState(today())
  const { hostelId, setHostelId, needsPicker, isLoading: hostelsLoading } = useHostelPicker()
  const hostelName = useHostelName()
  const query = useMessToday(hostelId, date)

  if (hostelsLoading) return <LoadingState />
  if (!hostelId) return <NoHostel />

  const day = parseISO(date).getDay()

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
        <Button className="sm:ml-auto" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!query.data}>
          Kitchen sheet
        </Button>
      </div>

      <QueryView query={query}>
        {(data) => (
          <>
            <div className="hidden print:block">
              <h1 className="text-xl font-bold">Kitchen sheet – {hostelName(hostelId)}</h1>
              <p className="text-sm text-slate-600">
                {DAY_NAMES[day]}, {formatDate(date)} · {data.members} mess members
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 print:grid-cols-4">
              {data.meals.map((m) => (
                <Card key={m.meal} className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{MEAL_LABEL[m.meal]}</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{m.headcount}</p>
                  <p className="text-xs text-slate-500">plates to prepare</p>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {data.meals.map((m) => {
                const notEating = m.optedOut.length + m.onLeave
                return (
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
                          {m.headcount} / {m.members}
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
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Not eating ({notEating})</p>
                        {notEating === 0 ? (
                          <p className="mt-1 text-sm text-slate-400">Everyone is eating</p>
                        ) : (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {m.optedOut.map((o) => (
                              <li key={o.id}>
                                <Badge tone="amber">
                                  {o.name || 'Unknown'}
                                  {o.roomNumber ? ` · ${o.roomNumber}` : ''}
                                </Badge>
                              </li>
                            ))}
                            {m.onLeave > 0 && (
                              <li>
                                <Badge tone="violet">
                                  {m.onLeave} on leave
                                </Badge>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </QueryView>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Weekly menu                                                         */
/* ------------------------------------------------------------------ */

function MenuTab() {
  const { hostelId, setHostelId, needsPicker, isLoading: hostelsLoading } = useHostelPicker()
  const { data: hostels } = useHostels()
  const hostelName = useHostelName()
  const menu = useMessMenu(hostelId)
  const saveEntry = useSaveMenuEntry()
  const copyMenu = useCopyMenu()
  const [editing, setEditing] = useState<{ day: number; meal: Meal } | null>(null)
  const [text, setText] = useState('')
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState('')
  const source = useMessMenu(copyOpen && copyFrom ? copyFrom : null)

  const todayDay = new Date().getDay()
  const getItems = (day: number, meal: Meal) => menu.data?.find((m) => m.day === day && m.meal === meal)?.items ?? ''

  const openEdit = (day: number, meal: Meal) => {
    setEditing({ day, meal })
    setText(getItems(day, meal))
  }
  const save = () => {
    if (!editing || !hostelId || saveEntry.isPending) return
    const { day, meal } = editing
    saveEntry.mutate(
      { hostelId, day, meal, items: text.trim() },
      {
        onSuccess: () => {
          setEditing(null)
        },
      },
    )
  }

  const others = (hostels ?? []).filter((h) => h.id !== hostelId)
  const srcCount = source.data?.length ?? 0
  const doCopy = async () => {
    if (!copyFrom || !hostelId || !srcCount) return
    const ok = await confirm({
      title: 'Replace weekly menu?',
      message: `The menu of ${hostelName(hostelId)} will be overwritten with ${hostelName(copyFrom)}'s menu (${srcCount} entries).`,
      confirmText: 'Copy menu',
      danger: true,
    })
    if (!ok) return
    copyMenu.mutate({ fromHostelId: copyFrom, toHostelId: hostelId }, { onSuccess: () => setCopyOpen(false) })
  }

  if (hostelsLoading) return <LoadingState />
  if (!hostelId) return <NoHostel />

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
        <QueryView query={menu}>
          {() => (
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
                        const v = getItems(day, meal)
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
          )}
        </QueryView>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${DAY_NAMES[editing.day]} · ${MEAL_LABEL[editing.meal]}` : ''}
        description={hostelName(hostelId)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saveEntry.isPending}>
              Cancel
            </Button>
            <Button onClick={save} loading={saveEntry.isPending}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Items" hint="Separate dishes with commas, e.g. Dal, Rice, Roti, Salad (Ctrl+Enter to save)">
          <Textarea
            autoFocus
            rows={3}
            maxLength={500}
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
            <Button variant="outline" onClick={() => setCopyOpen(false)} disabled={copyMenu.isPending}>
              Cancel
            </Button>
            <Button onClick={doCopy} icon={<Copy className="h-4 w-4" />} loading={copyMenu.isPending} disabled={!srcCount || source.isFetching}>
              Copy
            </Button>
          </>
        }
      >
        <Field
          label="Copy from"
          error={copyFrom && source.data && !srcCount ? `${hostelName(copyFrom)} has no menu to copy` : undefined}
          hint={srcCount ? `${srcCount} menu entries` : undefined}
        >
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
  const scope = useScope()
  const settings = useSettings()
  const hostelName = useHostelName()
  const query = useMessMembers(scope)
  const setMember = useSetMessMember()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const charge = settings.messMonthlyCharge

  const active = query.data?.items ?? []
  const on = query.data?.members ?? 0
  const s = q.trim().toLowerCase()
  const rows = active
    .filter((h) => (filter === 'all' ? true : filter === 'on' ? h.messOpted : !h.messOpted))
    .filter((h) => !s || h.name.toLowerCase().includes(s) || h.phone.includes(s) || (h.roomNumber ?? '').toLowerCase().includes(s))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Mess members" value={on} icon={<Users className="h-5 w-5" />} hint={`of ${active.length} active hostelers`} />
        <StatCard label="Not opted" value={active.length - on} icon={<UserMinus className="h-5 w-5" />} tone="slate" />
        <StatCard label="Monthly charge" value={formatMoney(charge)} icon={<Wallet className="h-5 w-5" />} tone="violet" hint="per member · change in Settings" />
        <StatCard label="Monthly mess billing" value={formatMoney(on * charge)} icon={<PiggyBank className="h-5 w-5" />} tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, phone or room…" className="sm:w-72" />
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
        <QueryView query={query}>
          {() =>
            rows.length === 0 ? (
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
                  {rows.map((h) => {
                    const busy = setMember.isPending && setMember.variables?.hostelerId === h.id
                    return (
                      <TR key={h.id}>
                        <TD>
                          <div className="flex items-center gap-3">
                            <Avatar name={h.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{h.name}</p>
                              <p className="text-xs text-slate-500">{h.phone || h.loginId}</p>
                            </div>
                          </div>
                        </TD>
                        <TD className="whitespace-nowrap">{roomLabel(h.roomNumber)}</TD>
                        {scope === 'all' && <TD>{hostelName(h.hostelId)}</TD>}
                        <TD>
                          <Switch
                            checked={busy ? !h.messOpted : h.messOpted}
                            disabled={busy}
                            label={(busy ? !h.messOpted : h.messOpted) ? 'On' : 'Off'}
                            onChange={(v) => setMember.mutate({ hostelerId: h.id, messOpted: v })}
                          />
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
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Opt-outs                                                            */
/* ------------------------------------------------------------------ */

function OptOutsTab() {
  const scope = useScope()
  const t = today()
  const stats = useMessStats({ hostelId: scope })
  const upcomingQ = useMessOptOuts({ hostelId: scope, from: t })
  const addOptOuts = useAddOptOuts()
  const removeOptOut = useRemoveOptOut()

  const days = Array.from({ length: 7 }, (_, i) => format(addDays(new Date(), i), 'yyyy-MM-dd'))
  const [hosteler, setHosteler] = useState<HostelerHit | null>(null)
  const [date, setDate] = useState(days[0]!)
  const [meals, setMeals] = useState<Meal[]>(['lunch'])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})

  const all = upcomingQ.data ?? []
  const s = q.trim().toLowerCase()
  const upcoming = all.filter((o) => !s || o.hostelerName.toLowerCase().includes(s) || (o.roomNumber ?? '').toLowerCase().includes(s))

  const add = () => {
    const e: Record<string, string> = {}
    if (!hosteler) e.hosteler = 'Select a mess member'
    if (!meals.length) e.meals = 'Select at least one meal'
    setErr(e)
    if (!hosteler || !meals.length) return
    addOptOuts.mutate({ hostelerId: hosteler.id, date, meals }, { onSuccess: () => setHosteler(null) })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Meals saved this month" value={stats.data?.optOuts ?? '—'} icon={<UtensilsCrossed className="h-5 w-5" />} tone="green" />
        <StatCard
          label="Estimated savings"
          value={stats.data ? formatMoney(stats.data.estimatedSavings) : '—'}
          icon={<PiggyBank className="h-5 w-5" />}
          tone="violet"
          hint={stats.data ? `@ ₹${stats.data.perMealCost.toFixed(2)} per meal` : undefined}
        />
        <StatCard label="Upcoming opt-outs" value={upcomingQ.data ? all.length : '—'} icon={<UserMinus className="h-5 w-5" />} tone="amber" />
        <StatCard
          label="Today's opt-outs"
          value={upcomingQ.data ? all.filter((o) => o.date === t).length : '—'}
          icon={<ChefHat className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Add opt-out" subtitle="For the next 7 days" />
          <div className="space-y-4 p-5">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                Mess member<span className="ml-0.5 text-red-500">*</span>
              </span>
              <HostelerPicker value={hosteler} onChange={setHosteler} hostelId={scope} messOpted error={err.hosteler} placeholder="Search mess member…" />
            </div>
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
              {err.meals && <span className="mt-1 block text-xs text-red-600">{err.meals}</span>}
            </div>
            <Button className="w-full" onClick={add} loading={addOptOuts.isPending}>
              Add opt-out
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming opt-outs" action={<SearchInput value={q} onChange={setQ} placeholder="Search…" className="w-40 sm:w-56" />} />
          <QueryView query={upcomingQ}>
            {() =>
              upcoming.length === 0 ? (
                <EmptyState
                  icon={<UserMinus className="h-6 w-6" />}
                  title="No upcoming opt-outs"
                  description="Opt-outs reduce the plate count for the kitchen."
                />
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
                    {upcoming.map((o) => (
                      <TR key={o.id}>
                        <TD className="whitespace-nowrap">
                          <span className="font-medium text-slate-800">{formatDate(o.date, 'EEE, dd MMM')}</span>
                          {o.date === t && (
                            <Badge tone="blue" className="ml-2">
                              Today
                            </Badge>
                          )}
                        </TD>
                        <TD>{MEAL_LABEL[o.meal]}</TD>
                        <TD>
                          <p className="font-medium text-slate-800">{o.hostelerName || 'Unknown'}</p>
                          <p className="text-xs text-slate-500">{roomLabel(o.roomNumber, '')}</p>
                        </TD>
                        <TD className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Remove opt-out"
                            loading={removeOptOut.isPending && removeOptOut.variables === o.id}
                            disabled={removeOptOut.isPending}
                            icon={<Trash2 className="h-4 w-4 text-red-500" />}
                            onClick={() => removeOptOut.mutate(o.id)}
                          />
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              )
            }
          </QueryView>
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

const FEEDBACK_PAGE = 20

function FeedbackTab() {
  const scope = useScope()
  const hostelName = useHostelName()
  const [meal, setMeal] = useState<Meal | 'all'>('all')
  const [rating, setRating] = useState<'all' | 'high' | 'low'>('all')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [scope, meal, rating])

  const query = useMessFeedback({
    hostelId: scope,
    meal: meal === 'all' ? undefined : meal,
    rating: rating === 'all' ? undefined : rating,
    page,
    limit: FEEDBACK_PAGE,
  })

  if (query.isLoading) return <LoadingState />
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  const data = query.data
  const overall = data.overall.average ?? 0
  const totalReviews = data.overall.count
  const chart = MEALS.map((m) => ({ meal: MEAL_LABEL[m], avg: data.averages[m]?.average ?? 0, count: data.averages[m]?.count ?? 0 }))

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
          <p className="mt-2 text-xs text-slate-500">{totalReviews} reviews</p>
          <div className="mt-4 space-y-2">
            {[5, 4, 3, 2, 1].map((r) => {
              const n = data.distribution[String(r)] ?? 0
              return (
                <div key={r} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="w-3">{r}</span>
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${totalReviews ? (n / totalReviews) * 100 : 0}%` }} />
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
            onChange={(e) => setRating(e.target.value as typeof rating)}
            options={[
              { value: 'all', label: 'All ratings' },
              { value: 'high', label: '4★ and above' },
              { value: 'low', label: '2★ and below' },
            ]}
          />
          <p className="text-sm text-slate-500 sm:ml-auto">{data.total} reviews</p>
        </div>
        {data.items.length === 0 ? (
          <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="No feedback yet" description="Hostelers can rate meals from their portal." />
        ) : (
          <>
            <ul className={cn('divide-y divide-slate-100', query.isFetching && 'opacity-70')}>
              {data.items.map((f) => (
                <li key={f.id} className="flex gap-3 px-5 py-4">
                  <Avatar name={f.hostelerName || '?'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{f.hostelerName || 'Former hosteler'}</p>
                      <Stars value={f.rating} />
                      <Badge>{MEAL_LABEL[f.meal]}</Badge>
                      {scope === 'all' && <span className="text-xs text-slate-400">{hostelName(f.hostelId)}</span>}
                    </div>
                    {f.comment && <p className="mt-1 text-sm text-slate-600">{f.comment}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDate(f.date, 'EEE, dd MMM yyyy')}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={data.page} pages={data.pages} onPage={setPage} busy={query.isFetching} />
          </>
        )}
      </Card>
    </div>
  )
}
