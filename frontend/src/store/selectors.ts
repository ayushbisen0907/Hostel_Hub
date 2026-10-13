import { useMemo } from 'react'
import { useStore, type DB } from './index'
import type { Bed, Hosteler, ID, Invoice, InvoiceStatus, Room } from '@/types'
import { today } from '@/lib/utils'

/** Hostel filter chosen in the top bar ('all' or a hostel id). */
export function useScope(): ID | 'all' {
  return useStore((s) => s.currentHostelId)
}

export function inScope(hostelId: ID, scope: ID | 'all') {
  return scope === 'all' || hostelId === scope
}

/** Amount paid against an invoice */
export function invoicePaid(db: Pick<DB, 'payments'>, invoiceId: ID): number {
  return db.payments.filter((p) => p.invoiceId === invoiceId).reduce((a, p) => a + p.amount, 0)
}

export function invoiceStatus(db: Pick<DB, 'payments'>, inv: Invoice): InvoiceStatus {
  if (inv.cancelled) return 'cancelled'
  const paid = invoicePaid(db, inv.id)
  if (paid >= inv.total) return 'paid'
  if (inv.dueDate < today()) return 'overdue'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export function invoiceBalance(db: Pick<DB, 'payments'>, inv: Invoice): number {
  if (inv.cancelled) return 0
  return Math.max(inv.total - invoicePaid(db, inv.id), 0)
}

/** Total outstanding dues of a hosteler */
export function hostelerDues(db: Pick<DB, 'payments' | 'invoices'>, hostelerId: ID): number {
  return db.invoices
    .filter((i) => i.hostelerId === hostelerId && !i.cancelled)
    .reduce((a, i) => a + invoiceBalance(db, i), 0)
}

export interface BedInfo {
  bed: Bed
  room: Room
  hosteler: Hosteler | null
}

export function bedLabel(db: Pick<DB, 'rooms' | 'beds'>, bedId: ID | null): string {
  if (!bedId) return 'Not allotted'
  const bed = db.beds.find((b) => b.id === bedId)
  const room = bed && db.rooms.find((r) => r.id === bed.roomId)
  return bed && room ? `Room ${room.number} · Bed ${bed.label}` : 'Not allotted'
}

export function occupancy(db: Pick<DB, 'beds' | 'rooms'>, scope: ID | 'all') {
  const activeRoomIds = new Set(db.rooms.filter((r) => r.status === 'active' && inScope(r.hostelId, scope)).map((r) => r.id))
  const beds = db.beds.filter((b) => activeRoomIds.has(b.roomId))
  const occupied = beds.filter((b) => b.hostelerId).length
  return {
    total: beds.length,
    occupied,
    vacant: beds.length - occupied,
    rate: beds.length ? Math.round((occupied / beds.length) * 100) : 0,
  }
}

/** Vacant beds available for allotment, with their rooms. */
export function useVacantBeds(hostelId?: ID | 'all') {
  const beds = useStore((s) => s.beds)
  const rooms = useStore((s) => s.rooms)
  return useMemo(() => {
    const roomMap = new Map(rooms.map((r) => [r.id, r]))
    return beds
      .filter((b) => !b.hostelerId)
      .map((b) => ({ bed: b, room: roomMap.get(b.roomId)! }))
      .filter((x) => x.room && x.room.status === 'active' && (!hostelId || hostelId === 'all' || x.room.hostelId === hostelId))
      .sort((a, b) => a.room.number.localeCompare(b.room.number, undefined, { numeric: true }) || a.bed.label.localeCompare(b.bed.label))
  }, [beds, rooms, hostelId])
}

/** Hostelers in the current scope (default: active + reserved). */
export function useScopedHostelers(opts: { includeCheckedOut?: boolean } = {}) {
  const hostelers = useStore((s) => s.hostelers)
  const scope = useScope()
  return useMemo(
    () =>
      hostelers.filter(
        (h) => inScope(h.hostelId, scope) && (opts.includeCheckedOut || h.status !== 'checked_out'),
      ),
    [hostelers, scope, opts.includeCheckedOut],
  )
}

/** The hosteler logged into the portal */
export function useCurrentHosteler(): Hosteler | null {
  const session = useStore((s) => s.session)
  const hostelers = useStore((s) => s.hostelers)
  return useMemo(
    () => (session?.kind === 'hosteler' ? hostelers.find((h) => h.id === session.hostelerId) ?? null : null),
    [session, hostelers],
  )
}

export function useHostelName() {
  const hostels = useStore((s) => s.hostels)
  return useMemo(() => {
    const m = new Map(hostels.map((h) => [h.id, h.name]))
    return (id: ID) => m.get(id) ?? '—'
  }, [hostels])
}

export function useHostelerMap() {
  const hostelers = useStore((s) => s.hostelers)
  return useMemo(() => new Map(hostelers.map((h) => [h.id, h])), [hostelers])
}

export function useRoomMap() {
  const rooms = useStore((s) => s.rooms)
  return useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
}
