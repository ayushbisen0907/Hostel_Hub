/**
 * Credential helpers for the hosteler portal.
 *
 * NOTE: this frontend-only build hashes passwords in the browser just so they
 * are never stored as plain text. The real backend (Node/Express) must hash
 * with bcrypt on the server — never trust a client-side hash.
 */

// Characters that can't be confused with each other on a phone keyboard (no 0/O, 1/l/I)
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

function pick(chars: string, rand: () => number) {
  return chars[Math.floor(rand() * chars.length)]!
}

/** 8-char temporary password with at least one upper, lower and digit, e.g. "Km7pXq4a". */
export function generateTempPassword(rand: () => number = Math.random): string {
  const all = LOWER + UPPER + DIGITS
  const chars = [pick(UPPER, rand), pick(LOWER, rand), pick(DIGITS, rand)]
  while (chars.length < 8) chars.push(pick(all, rand))
  // shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

/** cyrb53 — fast non-cryptographic 53-bit hash. Demo only (see note above). */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Salted hash; salt is the hosteler's record id. */
export function hashPassword(password: string, salt: string): string {
  return `h1$${cyrb53(`${salt}:${password}`, 7)}${cyrb53(`${password}:${salt}`, 13)}`
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  return hashPassword(password, salt) === hash
}

export interface PasswordCheck {
  ok: boolean
  rules: { label: string; ok: boolean }[]
}

/** Password policy for a hosteler's own password. */
export function checkPasswordStrength(pw: string): PasswordCheck {
  const rules = [
    { label: 'At least 8 characters', ok: pw.length >= 8 },
    { label: 'One letter', ok: /[A-Za-z]/.test(pw) },
    { label: 'One number', ok: /\d/.test(pw) },
    { label: 'No spaces', ok: pw.length > 0 && !/\s/.test(pw) },
  ]
  return { ok: rules.every((r) => r.ok), rules }
}

/** "Sunrise Boys Hostel" -> "SBH"; ensures uniqueness against `taken`. */
export function makeHostelCode(name: string, taken: string[]): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  let base = words.map((w) => w[0]).join('').slice(0, 4)
  if (base.length < 2) base = (words[0] ?? 'HST').slice(0, 3)
  if (base.length < 2) base = 'HST'
  const used = new Set(taken.map((t) => t.toUpperCase()))
  if (!used.has(base)) return base
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
  return `${base}${Date.now() % 1000}`
}

/** Hosteler login id, e.g. "SBH-0007" */
export function formatLoginId(code: string, seq: number): string {
  return `${code}-${String(seq).padStart(4, '0')}`
}

export function normalizeLoginId(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}
