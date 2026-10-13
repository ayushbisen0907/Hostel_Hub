import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BedDouble,
  Building2,
  DoorOpen,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Rows3,
  Snowflake,
  Trash2,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { ApiError, errorMessage } from '@/api/client'
import { useHostelName, useHostels, useScope } from '@/api/common'
import { useApiMutation } from '@/api/query'
import { useCan, useStaffSession } from '@/api/session'
import { ROOM_INVALIDATE, roomsApi, useRooms, type RoomBed, type RoomInput, type RoomWithBeds } from '@/api/rooms'
import type { ID, Room } from '@/api/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
  confirm,
  toast,
} from '@/components/ui'
import { cn, formatMoney } from '@/lib/utils'
import { AMENITIES, Chip, FilterBar, firstName } from './_residents'

type View = 'grid' | 'table'
type RoomType = Room['type']
type RoomStatus = Room['status']

function floorName(f: number) {
  if (f === 0) return 'Ground floor'
  const mod100 = f % 100
  const mod10 = f % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${f}${suffix} floor`
}

/* ------------------------------------------------------------------ */
/* Errors (plan limits get an upgrade link)                            */
/* ------------------------------------------------------------------ */

interface FormErr {
  message: string
  planLimit: boolean
}

function toFormErr(e: unknown): FormErr {
  return { message: errorMessage(e), planLimit: e instanceof ApiError && (e.code === 'PLAN_LIMIT' || e.status === 402) }
}

function reportError(e: unknown, setError: (e: FormErr) => void) {
  const fe = toFormErr(e)
  setError(fe)
  toast.error(fe.planLimit ? 'Plan bed limit reached — upgrade to add more beds' : fe.message)
}

function FormError({ error }: { error: FormErr | null }) {
  const isOwner = useStaffSession()?.user.role === 'owner'
  if (!error) return null
  if (error.planLimit)
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {error.message}{' '}
        {isOwner ? (
          <Link to="/app/settings?tab=billing" className="font-semibold underline">
            Upgrade plan
          </Link>
        ) : (
          <span className="font-medium">Ask the owner to upgrade the plan.</span>
        )}
      </div>
    )
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>
}

/* ------------------------------------------------------------------ */
/* Room forms                                                          */
/* ------------------------------------------------------------------ */

type RoomForm = Omit<RoomInput, 'floor' | 'sharing' | 'rentPerBed'> & { floor: string; sharing: string; rentPerBed: string }

function AmenityPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">Amenities</p>
      <div className="flex flex-wrap gap-2">
        {AMENITIES.map((a) => (
          <Chip key={a} active={value.includes(a)} onClick={() => onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a])}>
            {a}
          </Chip>
        ))}
      </div>
    </div>
  )
}

const TYPE_OPTIONS = [
  { value: 'non-ac', label: 'Non-AC' },
  { value: 'ac', label: 'AC' },
]
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Under maintenance' },
]
const SHARING_OPTIONS = [1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: n === 1 ? 'Single' : `${n} sharing` }))

function blankRoom(hostelId: ID): RoomForm {
  return { hostelId, number: '', floor: '1', type: 'non-ac', sharing: '2', rentPerBed: '6000', status: 'active', amenities: ['WiFi'] }
}

function RoomModal({
  open,
  onClose,
  room,
  defaultHostelId,
}: {
  open: boolean
  onClose: () => void
  room: RoomWithBeds | null
  defaultHostelId: ID
}) {
  const { data: hostels = [] } = useHostels()
  const [f, setF] = useState<RoomForm>(() => blankRoom(defaultHostelId))
  const [error, setError] = useState<FormErr | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setF(
      room
        ? {
            hostelId: room.hostelId,
            number: room.number,
            type: room.type,
            status: room.status,
            floor: String(room.floor),
            sharing: String(room.sharing),
            rentPerBed: String(room.rentPerBed),
            amenities: [...room.amenities],
          }
        : blankRoom(defaultHostelId),
    )
  }, [open, room, defaultHostelId])

  const set = <K extends keyof RoomForm>(k: K, v: RoomForm[K]) => setF((p) => ({ ...p, [k]: v }))

  const create = useApiMutation(roomsApi.create, {
    invalidate: ROOM_INVALIDATE,
    toastErrors: false,
    success: (r) => `Room ${r.number} added with ${r.sharing} bed${r.sharing > 1 ? 's' : ''}`,
    onSuccess: () => onClose(),
  })
  const update = useApiMutation(roomsApi.update, {
    invalidate: ROOM_INVALIDATE,
    toastErrors: false,
    success: (r) => `Room ${r.number} updated`,
    onSuccess: () => onClose(),
  })
  const busy = create.isPending || update.isPending

  const save = () => {
    setError(null)
    const number = f.number.trim()
    const sharing = Number(f.sharing)
    const rent = Number(f.rentPerBed)
    const floor = Number(f.floor)
    const fail = (message: string) => setError({ message, planLimit: false })
    if (!f.hostelId) return fail('Choose a hostel')
    if (!number) return fail('Room number is required')
    if (number.length > 20) return fail('Room number can be at most 20 characters')
    if (!Number.isInteger(floor) || floor < 0 || floor > 200) return fail('Enter a valid floor (0 for ground)')
    if (!(Number.isInteger(sharing) && sharing >= 1 && sharing <= 20)) return fail('Sharing must be between 1 and 20')
    if (f.rentPerBed.trim() === '' || !(rent >= 0)) return fail('Enter a valid rent')
    const data = { number, floor, type: f.type, sharing, rentPerBed: rent, status: f.status, amenities: f.amenities }
    const onError = (e: unknown) => reportError(e, setError)
    if (room) update.mutate({ id: room.id, ...data }, { onError })
    else create.mutate({ hostelId: f.hostelId, ...data }, { onError })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={room ? `Edit room ${room.number}` : 'Add room'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {room ? 'Save changes' : 'Add room'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={error} />
        {!room && (
          <Field label="Hostel" required>
            <Select value={f.hostelId} options={hostels.map((h) => ({ value: h.id, label: h.name }))} onChange={(e) => set('hostelId', e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Room number" required>
            <Input value={f.number} maxLength={20} onChange={(e) => set('number', e.target.value)} placeholder="e.g. 101" />
          </Field>
          <Field label="Floor" hint="0 = ground floor">
            <Input type="number" min={0} max={200} value={f.floor} onChange={(e) => set('floor', e.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={f.type} options={TYPE_OPTIONS} onChange={(e) => set('type', e.target.value as RoomType)} />
          </Field>
          <Field label="Sharing (beds)" hint={room ? 'Reducing removes empty beds only' : undefined}>
            <Input type="number" min={1} max={20} value={f.sharing} onChange={(e) => set('sharing', e.target.value)} />
          </Field>
          <Field label="Rent per bed / month">
            <Input type="number" min={0} value={f.rentPerBed} onChange={(e) => set('rentPerBed', e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={f.status} options={STATUS_OPTIONS} onChange={(e) => set('status', e.target.value as RoomStatus)} />
          </Field>
        </div>
        <AmenityPicker value={f.amenities} onChange={(v) => set('amenities', v)} />
      </div>
    </Modal>
  )
}

function BulkModal({ open, onClose, defaultHostelId, rooms }: { open: boolean; onClose: () => void; defaultHostelId: ID; rooms: RoomWithBeds[] }) {
  const { data: hostels = [] } = useHostels()
  const [hostelId, setHostelId] = useState(defaultHostelId)
  const [floor, setFloor] = useState('1')
  const [from, setFrom] = useState('101')
  const [to, setTo] = useState('110')
  const [type, setType] = useState<RoomType>('non-ac')
  const [sharing, setSharing] = useState('2')
  const [rent, setRent] = useState('6000')
  const [amenities, setAmenities] = useState<string[]>(['WiFi'])
  const [error, setError] = useState<FormErr | null>(null)

  useEffect(() => {
    if (open) {
      setHostelId(defaultHostelId)
      setError(null)
    }
  }, [open, defaultHostelId])

  const a = parseInt(from, 10)
  const b = parseInt(to, 10)
  const valid = Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a < 200
  // rooms already loaded for this hostel (the server skips duplicates too)
  const existing = new Set(rooms.filter((r) => r.hostelId === hostelId).map((r) => r.number))
  const numbers = valid ? Array.from({ length: b - a + 1 }, (_, i) => String(a + i)) : []
  const newNumbers = numbers.filter((n) => !existing.has(n))
  const skipped = numbers.length - newNumbers.length
  const bedCount = newNumbers.length * (Number(sharing) || 0)

  const bulk = useApiMutation(roomsApi.bulk, {
    invalidate: ROOM_INVALIDATE,
    toastErrors: false,
    success: (r) =>
      r.created ? `${r.created} rooms added${r.skipped.length ? ` · ${r.skipped.length} existing skipped` : ''}` : 'All these room numbers already exist',
    onSuccess: () => onClose(),
  })

  const save = () => {
    setError(null)
    const fail = (message: string) => setError({ message, planLimit: false })
    if (!hostelId) return fail('Choose a hostel')
    if (!valid) return fail('Enter a valid range (max 200 rooms), e.g. 101 to 110')
    if (!newNumbers.length) return fail('All these room numbers already exist')
    bulk.mutate(
      {
        hostelId,
        numbers: newNumbers,
        floor: Math.min(Math.max(0, parseInt(floor, 10) || 0), 200),
        type,
        sharing: Number(sharing),
        rentPerBed: Math.max(0, Number(rent) || 0),
        status: 'active',
        amenities,
      },
      { onError: (e) => reportError(e, setError) },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add rooms in bulk"
      description="Create a run of rooms on one floor with the same configuration."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={bulk.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!newNumbers.length} loading={bulk.isPending}>
            Add {newNumbers.length || ''} rooms
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={error} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Hostel" className="col-span-2">
            <Select value={hostelId} options={hostels.map((h) => ({ value: h.id, label: h.name }))} onChange={(e) => setHostelId(e.target.value)} />
          </Field>
          <Field label="Floor" className="col-span-2" hint="0 = ground floor">
            <Input type="number" min={0} max={200} value={floor} onChange={(e) => setFloor(e.target.value)} />
          </Field>
          <Field label="From room no.">
            <Input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="To room no.">
            <Input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Type">
            <Select value={type} options={TYPE_OPTIONS} onChange={(e) => setType(e.target.value as RoomType)} />
          </Field>
          <Field label="Sharing">
            <Select value={sharing} options={SHARING_OPTIONS} onChange={(e) => setSharing(e.target.value)} />
          </Field>
          <Field label="Rent per bed / month" className="col-span-2">
            <Input type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} />
          </Field>
        </div>
        <AmenityPicker value={amenities} onChange={setAmenities} />
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {valid ? (
            <>
              Will create <b>{newNumbers.length}</b> rooms
              {newNumbers.length > 0 && ` (${newNumbers[0]}–${newNumbers[newNumbers.length - 1]})`} with <b>{bedCount}</b> beds.
              {skipped > 0 && <span className="text-amber-700"> {skipped} existing room number(s) will be skipped.</span>}
            </>
          ) : (
            'Enter a numeric range like 101 to 110.'
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Bed chip                                                            */
/* ------------------------------------------------------------------ */

function bedTone(h: RoomBed['hosteler']) {
  if (!h) return 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
  if (h.status === 'reserved') return 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
  return 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
}

function occupantName(b: RoomBed) {
  return b.hosteler ? firstName(b.hosteler.name) : b.hostelerId ? 'Occupied' : 'Vacant'
}

function BedChip({ bed, onClick, disabled }: { bed: RoomBed; onClick: () => void; disabled?: boolean }) {
  const h = bed.hosteler
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={h ? `${h.name}${h.status === 'reserved' ? ' (reserved)' : ''}` : disabled ? 'Room under maintenance' : 'Vacant — click to check in'}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
        bedTone(h),
      )}
    >
      <BedDouble className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">{bed.label}</span>
      <span className="truncate">{occupantName(bed)}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Rooms() {
  const navigate = useNavigate()
  const can = useCan()
  const scope = useScope()
  const hostelsQ = useHostels()
  const hostels = useMemo(() => hostelsQ.data ?? [], [hostelsQ.data])
  const hostelName = useHostelName()

  const [view, setView] = useState<View>('grid')
  const [hostelFilter, setHostelFilter] = useState<string>('')
  const [floorFilter, setFloorFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sharingFilter, setSharingFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [onlyVacant, setOnlyVacant] = useState(false)

  const [editing, setEditing] = useState<RoomWithBeds | null>(null)
  const [roomModal, setRoomModal] = useState(false)
  const [bulkModal, setBulkModal] = useState(false)
  const [vacantBed, setVacantBed] = useState<{ bed: RoomBed; room: RoomWithBeds } | null>(null)

  useEffect(() => {
    setHostelFilter('')
    setFloorFilter('')
  }, [scope])

  const effectiveHostel: ID | 'all' = scope !== 'all' ? scope : hostelFilter || 'all'
  const defaultHostelId = effectiveHostel !== 'all' ? effectiveHostel : (hostels[0]?.id ?? '')

  const roomsQ = useRooms({ hostelId: effectiveHostel })
  const hostelRooms = useMemo(() => roomsQ.data ?? [], [roomsQ.data])

  const del = useApiMutation(roomsApi.remove, { invalidate: ROOM_INVALIDATE })

  const stats = useMemo(() => {
    let total = 0
    let occupied = 0
    let vacant = 0
    for (const r of hostelRooms) {
      total += r.beds.length
      const o = r.beds.filter((b) => b.hostelerId).length
      occupied += o
      if (r.status === 'active') vacant += r.beds.length - o
    }
    return { rooms: hostelRooms.length, beds: total, occupied, vacant, maintenance: hostelRooms.filter((r) => r.status === 'maintenance').length }
  }, [hostelRooms])

  const floors = useMemo(() => [...new Set(hostelRooms.map((r) => r.floor))].sort((a, b) => a - b), [hostelRooms])
  const sharings = useMemo(() => [...new Set(hostelRooms.map((r) => r.sharing))].sort((a, b) => a - b), [hostelRooms])

  const filtered = useMemo(
    () =>
      hostelRooms
        .filter((r) => {
          if (floorFilter !== '' && String(r.floor) !== floorFilter) return false
          if (typeFilter && r.type !== typeFilter) return false
          if (sharingFilter && String(r.sharing) !== sharingFilter) return false
          if (statusFilter && r.status !== statusFilter) return false
          if (onlyVacant && (r.status !== 'active' || !r.beds.some((b) => !b.hostelerId))) return false
          return true
        })
        .sort(
          (a, b) =>
            hostelName(a.hostelId).localeCompare(hostelName(b.hostelId)) ||
            a.floor - b.floor ||
            a.number.localeCompare(b.number, undefined, { numeric: true }),
        ),
    [hostelRooms, floorFilter, typeFilter, sharingFilter, statusFilter, onlyVacant, hostelName],
  )

  const groups = useMemo(() => {
    const g: { key: string; hostelId: ID; floor: number; rooms: RoomWithBeds[] }[] = []
    for (const r of filtered) {
      const key = `${r.hostelId}|${r.floor}`
      const last = g[g.length - 1]
      if (last && last.key === key) last.rooms.push(r)
      else g.push({ key, hostelId: r.hostelId, floor: r.floor, rooms: [r] })
    }
    return g
  }, [filtered])

  const showHostelName = effectiveHostel === 'all' && hostels.length > 1

  if (hostelsQ.isLoading) return <LoadingState />
  if (hostelsQ.error) return <ErrorState error={hostelsQ.error} onRetry={() => void hostelsQ.refetch()} />

  if (!hostels.length) {
    return (
      <>
        <PageHeader title="Rooms & beds" subtitle="Set up the rooms and beds of your hostels." />
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Add a hostel first"
            description="Rooms belong to a hostel. Create your first hostel in settings, then come back to add rooms and beds."
            action={
              <Link to="/app/settings?tab=hostels">
                <Button icon={<Plus className="h-4 w-4" />}>Add hostel</Button>
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const openBed = (bed: RoomBed, room: RoomWithBeds) => {
    if (bed.hostelerId) navigate(`/app/hostelers/${bed.hostelerId}`)
    else setVacantBed({ bed, room })
  }

  const edit = (r: RoomWithBeds) => {
    setEditing(r)
    setRoomModal(true)
  }

  const remove = async (room: RoomWithBeds) => {
    if (room.beds.some((b) => b.hostelerId))
      return toast.error(`Room ${room.number} has occupied beds. Move or check out hostelers first.`)
    const ok = await confirm({
      title: `Delete room ${room.number}?`,
      message: `This removes the room and its ${room.beds.length} bed(s). This can't be undone.`,
      danger: true,
      confirmText: 'Delete room',
    })
    if (!ok) return
    del.mutate(room.id, { onSuccess: () => toast.success(`Room ${room.number} deleted`) })
  }

  const anyFilter = floorFilter !== '' || !!typeFilter || !!sharingFilter || !!statusFilter || onlyVacant
  const clearFilters = () => {
    setFloorFilter('')
    setTypeFilter('')
    setSharingFilter('')
    setStatusFilter('')
    setOnlyVacant(false)
  }

  const roomActions = (r: RoomWithBeds) => (
    <div className="flex shrink-0 items-center">
      <IconButton label="Edit room" onClick={() => edit(r)}>
        <Pencil className="h-4 w-4" />
      </IconButton>
      <IconButton label="Delete room" onClick={() => remove(r)} disabled={del.isPending && del.variables === r.id} className="hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </IconButton>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Rooms & beds"
        subtitle="Floor-wise view of every room and who is in each bed."
        actions={
          <>
            <Button variant="outline" icon={<Rows3 className="h-4 w-4" />} onClick={() => setBulkModal(true)}>
              Add rooms in bulk
            </Button>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditing(null)
                setRoomModal(true)
              }}
            >
              Add room
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Rooms" value={roomsQ.isLoading ? '…' : stats.rooms} icon={<DoorOpen className="h-5 w-5" />} />
        <StatCard label="Beds" value={roomsQ.isLoading ? '…' : stats.beds} icon={<BedDouble className="h-5 w-5" />} tone="violet" />
        <StatCard
          label="Occupied"
          value={roomsQ.isLoading ? '…' : stats.occupied}
          icon={<UserCheck className="h-5 w-5" />}
          tone="brand"
          hint={stats.beds ? `${Math.round((stats.occupied / stats.beds) * 100)}% occupancy` : undefined}
        />
        <StatCard
          label="Vacant"
          value={roomsQ.isLoading ? '…' : stats.vacant}
          icon={<BedDouble className="h-5 w-5" />}
          tone="green"
          onClick={() => setOnlyVacant(true)}
          hint="Click to filter"
        />
        <StatCard label="Under maintenance" value={roomsQ.isLoading ? '…' : stats.maintenance} icon={<Wrench className="h-5 w-5" />} tone="amber" />
      </div>

      <Card className="mb-6 p-4">
        <FilterBar>
          {scope === 'all' && hostels.length > 1 && (
            <Select
              className="sm:w-48"
              value={hostelFilter}
              placeholder="All hostels"
              options={hostels.map((h) => ({ value: h.id, label: h.name }))}
              onChange={(e) => {
                setHostelFilter(e.target.value)
                setFloorFilter('')
              }}
            />
          )}
          <Select
            className="sm:w-36"
            value={floorFilter}
            placeholder="All floors"
            options={floors.map((f) => ({ value: String(f), label: floorName(f) }))}
            onChange={(e) => setFloorFilter(e.target.value)}
          />
          <Select className="sm:w-36" value={typeFilter} placeholder="AC & non-AC" options={TYPE_OPTIONS} onChange={(e) => setTypeFilter(e.target.value)} />
          <Select
            className="sm:w-36"
            value={sharingFilter}
            placeholder="Any sharing"
            options={sharings.map((n) => ({ value: String(n), label: n === 1 ? 'Single' : `${n} sharing` }))}
            onChange={(e) => setSharingFilter(e.target.value)}
          />
          <Select className="sm:w-44" value={statusFilter} placeholder="Any status" options={STATUS_OPTIONS} onChange={(e) => setStatusFilter(e.target.value)} />
          <div className="flex items-center">
            <Switch checked={onlyVacant} onChange={setOnlyVacant} label="Only vacant" />
          </div>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          <div className="col-span-2 flex justify-end sm:ml-auto">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(['grid', 'table'] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
                    view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {v === 'grid' ? <LayoutGrid className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
                  {v === 'grid' ? 'Grid' : 'Table'}
                </button>
              ))}
            </div>
          </div>
        </FilterBar>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Vacant
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> Occupied
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Reserved
          </span>
        </div>
      </Card>

      {roomsQ.isLoading ? (
        <Card>
          <LoadingState label="Loading rooms…" />
        </Card>
      ) : roomsQ.error ? (
        <Card>
          <ErrorState error={roomsQ.error} onRetry={() => void roomsQ.refetch()} />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={<DoorOpen className="h-6 w-6" />}
            title={hostelRooms.length ? 'No rooms match these filters' : 'No rooms yet'}
            description={hostelRooms.length ? 'Try clearing a filter.' : 'Add rooms one at a time or create a whole floor at once.'}
            action={
              hostelRooms.length ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button icon={<Rows3 className="h-4 w-4" />} onClick={() => setBulkModal(true)}>
                  Add rooms in bulk
                </Button>
              )
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {showHostelName && <span className="text-slate-800">{hostelName(g.hostelId)} · </span>}
                  {floorName(g.floor)}
                </h2>
                <span className="text-xs text-slate-400">{g.rooms.length} rooms</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {g.rooms.map((r) => {
                  const occ = r.beds.filter((b) => b.hostelerId).length
                  return (
                    <Card key={r.id} className={cn('flex flex-col p-4', r.status === 'maintenance' && 'border-amber-200 bg-amber-50/40')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-slate-900">Room {r.number}</h3>
                            {r.type === 'ac' && <Snowflake className="h-4 w-4 text-cyan-500" aria-label="AC" />}
                          </div>
                          <p className="text-xs text-slate-500">
                            {r.type === 'ac' ? 'AC' : 'Non-AC'} · {r.sharing === 1 ? 'Single' : `${r.sharing} sharing`} · {formatMoney(r.rentPerBed)}/bed
                          </p>
                        </div>
                        {roomActions(r)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {r.status === 'maintenance' ? (
                          <StatusBadge status="maintenance" label="Under maintenance" />
                        ) : (
                          <Badge tone={occ === r.beds.length ? 'blue' : 'green'}>
                            {occ}/{r.beds.length} occupied
                          </Badge>
                        )}
                        {r.amenities.slice(0, 3).map((a) => (
                          <Badge key={a}>{a}</Badge>
                        ))}
                        {r.amenities.length > 3 && <Badge>+{r.amenities.length - 3}</Badge>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {r.beds.map((b) => (
                          <BedChip key={b.id} bed={b} disabled={!b.hostelerId && r.status === 'maintenance'} onClick={() => openBed(b, r)} />
                        ))}
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Room</TH>
                {showHostelName && <TH>Hostel</TH>}
                <TH>Floor</TH>
                <TH>Type</TH>
                <TH>Sharing</TH>
                <TH>Rent / bed</TH>
                <TH>Beds</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {filtered.map((r) => (
                <TR key={r.id}>
                  <TD className="font-semibold text-slate-900">{r.number}</TD>
                  {showHostelName && <TD>{hostelName(r.hostelId)}</TD>}
                  <TD className="whitespace-nowrap">{floorName(r.floor)}</TD>
                  <TD>{r.type === 'ac' ? 'AC' : 'Non-AC'}</TD>
                  <TD>{r.sharing}</TD>
                  <TD>{formatMoney(r.rentPerBed)}</TD>
                  <TD>
                    <div className="flex min-w-[12rem] max-w-sm flex-wrap gap-1">
                      {r.beds.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          disabled={!b.hostelerId && r.status === 'maintenance'}
                          onClick={() => openBed(b, r)}
                          className={cn('rounded-md border px-1.5 py-0.5 text-xs font-medium disabled:opacity-60', bedTone(b.hosteler))}
                        >
                          {b.label}: {occupantName(b)}
                        </button>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-right">
                    <div className="inline-flex">{roomActions(r)}</div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <RoomModal open={roomModal} onClose={() => setRoomModal(false)} room={editing} defaultHostelId={defaultHostelId} />
      <BulkModal open={bulkModal} onClose={() => setBulkModal(false)} defaultHostelId={defaultHostelId} rooms={hostelRooms} />

      <Modal
        open={!!vacantBed}
        onClose={() => setVacantBed(null)}
        size="sm"
        title={vacantBed ? `Room ${vacantBed.room.number} · Bed ${vacantBed.bed.label}` : ''}
        description={vacantBed ? hostelName(vacantBed.room.hostelId) : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setVacantBed(null)}>
              Close
            </Button>
            {can('checkin') && (
              <Button icon={<UserCheck className="h-4 w-4" />} onClick={() => vacantBed && navigate(`/app/check-in?bed=${vacantBed.bed.id}`)}>
                Check in here
              </Button>
            )}
          </>
        }
      >
        {vacantBed && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>This bed is vacant and ready for a new resident.</p>
            <p>
              {vacantBed.room.type === 'ac' ? 'AC' : 'Non-AC'} · {vacantBed.room.sharing === 1 ? 'Single' : `${vacantBed.room.sharing} sharing`} ·{' '}
              <b className="text-slate-900">{formatMoney(vacantBed.room.rentPerBed)}</b> per month
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}
