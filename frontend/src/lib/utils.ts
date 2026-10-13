import { clsx, type ClassValue } from 'clsx'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'

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
