/**
 * Client-side helpers for credentials. Passwords are hashed and checked by the
 * API (bcrypt) — the browser only validates the rules for instant feedback.
 */

export interface PasswordCheck {
  ok: boolean
  rules: { label: string; ok: boolean }[]
}

/** Same policy as the API (backend/src/lib/auth.ts isStrongPassword). */
export function checkPasswordStrength(pw: string): PasswordCheck {
  const rules = [
    { label: 'At least 8 characters', ok: pw.length >= 8 },
    { label: 'One letter', ok: /[A-Za-z]/.test(pw) },
    { label: 'One number', ok: /\d/.test(pw) },
    { label: 'No spaces', ok: pw.length > 0 && !/\s/.test(pw) },
  ]
  return { ok: rules.every((r) => r.ok), rules }
}

/** "sbh-0007 " -> "SBH-0007" */
export function normalizeLoginId(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}
