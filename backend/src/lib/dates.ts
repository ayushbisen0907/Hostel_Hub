/**
 * Calendar-date helpers for "YYYY-MM-DD" strings (no time zones involved:
 * the math runs on UTC dates built from the string parts).
 */

const toUTC = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, day!))
}
const fromUTC = (dt: Date) => dt.toISOString().slice(0, 10)

export function addDays(d: string, n: number): string {
  const dt = toUTC(d)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUTC(dt)
}

/** Inclusive number of days from a to b (a <= b), e.g. 1 Oct–31 Oct = 31. */
export function daysInclusive(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000) + 1
}

function daysInMonth(y: number, m0: number) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/**
 * Same day-of-month `k` months after `anchor`, clamped to the month's last day
 * (31 Jan + 1 month = 28/29 Feb; the anchor day comes back in March).
 */
export function addMonthsAnchored(anchor: string, k: number): string {
  const [y, m, d] = anchor.split('-').map(Number)
  const total = m! - 1 + k
  const yy = y! + Math.floor(total / 12)
  const mm = ((total % 12) + 12) % 12
  const dd = Math.min(d!, daysInMonth(yy, mm))
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Overlap of two inclusive date ranges in days (0 if none). `null` end = open. */
export function overlapDays(aFrom: string, aTo: string | null, bFrom: string, bTo: string): number {
  const from = aFrom > bFrom ? aFrom : bFrom
  const to = aTo === null || aTo > bTo ? bTo : aTo
  return to >= from ? daysInclusive(from, to) : 0
}

/** "13 Oct" / "13 Oct 2026" */
export function shortDate(d: string, withYear = false): string {
  const dt = toUTC(d)
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

export function periodLabel(from: string, to: string): string {
  return from.slice(0, 4) === to.slice(0, 4) ? `${shortDate(from)} – ${shortDate(to, true)}` : `${shortDate(from, true)} – ${shortDate(to, true)}`
}

/** "2026-10" -> "October 2026" */
export function monthLabel(month: string): string {
  return toUTC(`${month}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
