/**
 * Monthly charge heads (mirror backend/src/lib/billing.ts) and invoice line
 * item categories.
 */
import type { ElectricityBasis } from '@/api/electricity'
import type { ChargeKey, HostelCharges, InvoiceItem } from '@/api/types'

/** UPI ID format accepted by the backend (models/Hostel.ts UPI_ID_RE). */
export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/

export const CHARGE_KEY_LABELS: Record<ChargeKey, string> = {
  rent: 'Room rent',
  mess: 'Mess fees',
  electricity: 'Electricity',
  water: 'Water',
  internet: 'Internet / Wi-Fi',
  laundry: 'Laundry',
  maintenance: 'Maintenance',
  late_fee: 'Late fee',
  deposit: 'Security deposit',
  other: 'Other',
}

export const CHARGE_KEY_OPTIONS: { value: ChargeKey; label: string }[] = (Object.keys(CHARGE_KEY_LABELS) as ChargeKey[]).map((k) => ({
  value: k,
  label: CHARGE_KEY_LABELS[k],
}))

/** How a hostel's electricity meters are read: one per room (split equally among its hostelers) or one per bed. */
export type { ElectricityBasis }

export const ELECTRICITY_BASIS_LABELS: Record<ElectricityBasis, string> = {
  room: 'per room',
  bed: 'per bed',
}

/** "Electricity ₹10/unit · per room", or null when electricity isn't charged. */
export function electricityText(rate: number | null | undefined, basis: ElectricityBasis | null | undefined): string | null {
  if (!rate || rate <= 0) return null
  return `₹${rate.toLocaleString('en-IN')}/unit · ${ELECTRICITY_BASIS_LABELS[basis ?? 'room']}`
}

/** Split `amount` into `n` whole-rupee parts that add up exactly (first ones get the extra rupee) — mirrors the backend. */
export function splitEqually(amount: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(amount / n)
  const extra = amount - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/** What room rent covers (shown as a hint). */
export const INCLUDED_IN_RENT = 'water, Wi-Fi, cleaning and maintenance'

export const EMPTY_CHARGES: HostelCharges = {
  mess: 0,
  electricity: 0,
  water: 0,
  internet: 0,
  laundry: 0,
  maintenance: 0,
  others: [],
}

/** Guess a category from a free-text label (for old items without a key). */
export function guessKey(label: string): ChargeKey {
  const l = label.toLowerCase()
  if (/late fee/.test(l)) return 'late_fee'
  if (/deposit/.test(l)) return 'deposit'
  if (/rent/.test(l)) return 'rent'
  if (/mess|food|meal/.test(l)) return 'mess'
  if (/electric|power/.test(l)) return 'electricity'
  if (/water/.test(l)) return 'water'
  if (/internet|wi-?fi|broadband/.test(l)) return 'internet'
  if (/laundry|wash/.test(l)) return 'laundry'
  if (/maint/.test(l)) return 'maintenance'
  return 'other'
}

/**
 * Fixed lines of a hosteler's monthly bill: rent and mess (if opted; the
 * hostel's mess charge, else the organization default). Electricity is
 * metered and added from the month's readings (Rooms & Beds → Electricity).
 */
export function monthlyBillItems(
  hosteler: { monthlyRent: number; messOpted: boolean },
  charges: Partial<HostelCharges> | null | undefined,
  fallbackMess = 0,
): Required<InvoiceItem>[] {
  const c = charges ?? {}
  const items: Required<InvoiceItem>[] = [{ key: 'rent', label: 'Room rent', amount: hosteler.monthlyRent }]
  const mess = c.mess && c.mess > 0 ? c.mess : fallbackMess
  if (hosteler.messOpted && mess > 0) items.push({ key: 'mess', label: 'Mess fees', amount: mess })
  return items
}

/** A hostel's charges besides rent as label/value pairs: mess (if set) and metered electricity (if a rate is set). */
export function configuredCharges(
  hostel:
    | {
        charges?: Partial<HostelCharges> | null
        electricityRate?: number
        electricityBasis?: ElectricityBasis
      }
    | null
    | undefined,
): { label: string; value: string }[] {
  const c = hostel?.charges ?? {}
  const out: { label: string; value: string }[] = []
  if (c.mess && c.mess > 0)
    out.push({
      label: 'Mess (members)',
      value: `₹${c.mess.toLocaleString('en-IN')}/month`,
    })
  const elec = electricityText(hostel?.electricityRate, hostel?.electricityBasis)
  if (elec) out.push({ label: 'Electricity', value: elec })
  return out
}
