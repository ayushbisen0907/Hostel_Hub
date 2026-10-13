import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

/* ---------------- passwords ---------------- */

const ROUNDS = env.isTest ? 4 : 10

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, ROUNDS)
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash)
}

/** Password policy (same as the frontend). */
export function isStrongPassword(pw: string) {
  return pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /\d/.test(pw) && !/\s/.test(pw)
}
export const PASSWORD_RULE = 'Password must be at least 8 characters with a letter and a number, and no spaces'

// no 0/O, 1/l/I — easy to read out and type on a phone
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

/** 8-char temporary password with at least one upper, lower and digit. Cryptographically random. */
export function generateTempPassword(): string {
  const pick = (set: string) => set[crypto.randomInt(set.length)]!
  const all = LOWER + UPPER + DIGITS
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)]
  while (chars.length < 8) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

/* ---------------- hosteler IDs ---------------- */

/** "Sunrise Boys Hostel" -> "SBH"; unique against `taken`. */
export function makeHostelCode(name: string, taken: string[]): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  let base = words.map((w) => w[0]).join('').slice(0, 4)
  if (base.length < 2) base = (words[0] ?? 'HST').slice(0, 3)
  if (base.length < 2) base = 'HST'
  const used = new Set(taken.map((t) => t.toUpperCase()))
  if (!used.has(base)) return base
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
  return `${base}${crypto.randomInt(1000, 9999)}`
}

export function formatLoginId(code: string, seq: number) {
  return `${code}-${String(seq).padStart(4, '0')}`
}

export function normalizeLoginId(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}

/* ---------------- JWT ---------------- */

export type StaffRole = 'owner' | 'manager' | 'warden' | 'accountant'

/** `tv` = tokenVersion of the account; bumping it in the DB revokes all existing tokens. */
export type TokenPayload =
  | { kind: 'staff'; sub: string; orgId: string; role: StaffRole; tv: number }
  | { kind: 'hosteler'; sub: string; orgId: string; hostelId: string; mustChangePassword: boolean; tv: number }

export function signToken(payload: TokenPayload, expiresIn: string = env.JWT_EXPIRES_IN) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn } as jwt.SignOptions)
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload
}
