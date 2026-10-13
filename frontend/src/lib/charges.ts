/**
 * Monthly charge heads (mirror backend/src/lib/billing.ts) and invoice line
 * item categories.
 */
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
  other: 'Other',
}

export const CHARGE_KEY_OPTIONS: { value: ChargeKey; label: string }[] = (Object.keys(CHARGE_KEY_LABELS) as ChargeKey[]).map((k) => ({
  value: k,
  label: CHARGE_KEY_LABELS[k],
}))

/**
 * Separate monthly charges besides room rent and mess. Water, internet,
 * cleaning, maintenance etc. are included in the room rent, so electricity is
 * the only one (mirrors backend/src/lib/billing.ts).
 */
export const FIXED_CHARGES: { key: 'electricity'; label: string }[] = [{ key: 'electricity', label: 'Electricity' }]

/** What room rent covers (shown as a hint). */
export const INCLUDED_IN_RENT = 'water, Wi-Fi, cleaning and maintenance'

export const EMPTY_CHARGES: HostelCharges = { mess: 0, electricity: 0, water: 0, internet: 0, laundry: 0, maintenance: 0, others: [] }

/** Guess a category from a free-text label (for old items without a key). */
export function guessKey(label: string): ChargeKey {
  const l = label.toLowerCase()
  if (/late fee/.test(l)) return 'late_fee'
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
 * Lines of a hosteler's monthly bill: rent, mess (if opted; the hostel's mess
 * charge, else the organization default) and electricity.
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
  for (const f of FIXED_CHARGES) {
    const amount = Number(c[f.key] ?? 0)
    if (amount > 0) items.push({ key: f.key, label: f.label, amount })
  }
  return items
}

/** Configured charge heads of a hostel as label/amount pairs (amount > 0 only). */
export function configuredCharges(charges: Partial<HostelCharges> | null | undefined): { label: string; amount: number }[] {
  const c = charges ?? {}
  const out: { label: string; amount: number }[] = []
  if (c.mess && c.mess > 0) out.push({ label: 'Mess (members)', amount: c.mess })
  for (const f of FIXED_CHARGES) {
    const amount = Number(c[f.key] ?? 0)
    if (amount > 0) out.push({ label: f.label, amount })
  }
  return out
}
