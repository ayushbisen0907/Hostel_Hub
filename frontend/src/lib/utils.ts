import { clsx, type ClassValue } from 'clsx'
import { addDays, addMonths, format, parseISO, differenceInCalendarDays } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10)
  const t = Date.now().toString(36).slice(-4)
  return `${prefix}${t}${r}`
}

export function nowISO() {
  return new Date().toISOString()
}

/** Local date as YYYY-MM-DD */
export function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function currentMonth(): string {
  return format(new Date(), 'yyyy-MM')
}

export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function formatMoney(n: number, symbol = '₹'): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}${symbol}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`
}

export function formatDate(s: string | null | undefined, pattern = 'dd MMM yyyy'): string {
  if (!s) return '—'
  try {
    return format(parseISO(s), pattern)
  } catch {
    return s
  }
}

export function formatDateTime(s: string | null | undefined): string {
  return formatDate(s, 'dd MMM yyyy, hh:mm a')
}

export function formatMonth(month: string): string {
  // YYYY-MM -> "Oct 2026"
  return formatDate(`${month}-01`, 'MMM yyyy')
}

/** "13 Oct – 12 Nov 2026" (both years shown when they differ). */
export function formatPeriod(from: string, to: string): string {
  return from.slice(0, 4) === to.slice(0, 4) ? `${formatDate(from, 'd MMM')} – ${formatDate(to, 'd MMM yyyy')}` : `${formatDate(from, 'd MMM yyyy')} – ${formatDate(to, 'd MMM yyyy')}`
}

/** A bill's period ("13 Oct – 12 Nov 2026"), or its month ("Oct 2026") for older bills without one. */
export function billPeriod(inv: { month: string; periodStart?: string | null; periodEnd?: string | null }): string {
  return inv.periodStart && inv.periodEnd ? formatPeriod(inv.periodStart, inv.periodEnd) : formatMonth(inv.month)
}

/** 1 -> "1st", 13 -> "13th", 22 -> "22nd" */
export function ordinal(n: number): string {
  const m100 = n % 100
  const m10 = n % 10
  return `${n}${m100 >= 11 && m100 <= 13 ? 'th' : m10 === 1 ? 'st' : m10 === 2 ? 'nd' : m10 === 3 ? 'rd' : 'th'}`
}

/** Rent cycle from a check-in date: "every month on the 13th" (days 29–31 fall back to the month's last day). */
export function rentCycleText(checkInDate: string | null | undefined): string {
  const day = Number(checkInDate?.slice(8, 10))
  if (!day) return ''
  return `every month on the ${ordinal(day)}${day > 28 ? ' (or the month’s last day)' : ''}`
}

/** The first rent cycle starting on `checkInDate`: { from, to } (13 Oct – 12 Nov). */
export function firstRentCycle(checkInDate: string): { from: string; to: string } {
  return { from: checkInDate, to: format(addDays(addMonths(parseISO(checkInDate), 1), -1), 'yyyy-MM-dd') }
}

/** YYYY-MM-DD plus n days */
export function addDaysStr(d: string, n: number): string {
  return format(addDays(parseISO(d), n), 'yyyy-MM-dd')
}

export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from))
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function titleCase(s: string): string {
  return s
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Download rows as a CSV file */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function sum<T>(arr: T[], fn: (x: T) => number): number {
  return arr.reduce((acc, x) => acc + fn(x), 0)
}
