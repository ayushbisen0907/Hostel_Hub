import type { NextFunction, Request, Response } from 'express'
import { verifyToken, type StaffRole } from '../lib/auth.js'
import { AppError, forbidden, unauthorized } from '../lib/errors.js'
import { User } from '../models/User.js'
import { Hosteler } from '../models/Hosteler.js'

export interface StaffAuth {
  kind: 'staff'
  userId: string
  orgId: string
  role: StaffRole
}
export interface HostelerAuth {
  kind: 'hosteler'
  hostelerId: string
  orgId: string
  hostelId: string
  mustChangePassword: boolean
}

declare module 'express-serve-static-core' {
  interface Request {
    staff?: StaffAuth
    hosteler?: HostelerAuth
  }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7)
  return null
}

/* ------------------------------------------------------------------ */
/* Module permissions per staff role                                   */
/* ------------------------------------------------------------------ */

export type Module =
  | 'org' // organization profile, plan, settings, staff logins
  | 'hostels'
  | 'rooms'
  | 'hostelers'
  | 'checkin'
  | 'documents'
  | 'fees'
  | 'expenses'
  | 'mess'
  | 'attendance'
  | 'complaints'
  | 'visitors'
  | 'notices'
  | 'staff'
  | 'reports'

const ACCESS: Record<StaffRole, Module[] | 'all'> = {
  owner: 'all',
  manager: ['hostels', 'rooms', 'hostelers', 'checkin', 'documents', 'fees', 'expenses', 'mess', 'attendance', 'complaints', 'visitors', 'notices', 'staff', 'reports'],
  warden: ['rooms', 'hostelers', 'checkin', 'documents', 'mess', 'attendance', 'complaints', 'visitors', 'notices'],
  accountant: ['hostelers', 'fees', 'expenses', 'reports'],
}

export function canAccess(role: StaffRole, module: Module) {
  const a = ACCESS[role]
  return a === 'all' || a.includes(module)
}

/**
 * Staff (owner / manager / warden / accountant) authentication.
 * Pass a module to also check the role's permission.
 */
export function requireStaff(module?: Module) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearer(req)
      if (!token) throw unauthorized()
      let payload
      try {
        payload = verifyToken(token)
      } catch {
        throw unauthorized('Session expired. Please log in again.')
      }
      if (payload.kind !== 'staff') throw forbidden('Staff access only')
      const user = await User.findById(payload.sub).select('orgId role active tokenVersion').lean()
      if (!user || !user.active || String(user.orgId) !== payload.orgId) throw unauthorized('Account not found or disabled')
      if ((payload as { tv?: number }).tv !== user.tokenVersion) throw unauthorized('Session expired. Please log in again.')
      req.staff = { kind: 'staff', userId: String(user._id), orgId: String(user.orgId), role: user.role }
      if (module && !canAccess(user.role, module)) throw forbidden(`Your role (${user.role}) can't access ${module}`)
      next()
    } catch (e) {
      next(e)
    }
  }
}

/**
 * Hosteler (resident portal) authentication. Loads the hosteler on every
 * request so check-out / password resets take effect immediately.
 * By default it blocks hostelers who are still on their temporary password.
 */
export function requireHosteler(opts: { allowTempPassword?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearer(req)
      if (!token) throw unauthorized()
      let payload
      try {
        payload = verifyToken(token)
      } catch {
        throw unauthorized('Session expired. Please log in again.')
      }
      if (payload.kind !== 'hosteler') throw forbidden('Hosteler access only')
      const h = await Hosteler.findById(payload.sub).select('orgId hostelId status mustChangePassword tokenVersion').lean()
      if (!h || String(h.orgId) !== payload.orgId) throw unauthorized('Account not found')
      if (h.status === 'checked_out') throw unauthorized('This account was closed at check-out')
      if ((payload as { tv?: number }).tv !== h.tokenVersion) throw unauthorized('Session expired. Please log in again.')
      req.hosteler = {
        kind: 'hosteler',
        hostelerId: String(h._id),
        orgId: String(h.orgId),
        hostelId: String(h.hostelId),
        mustChangePassword: h.mustChangePassword,
      }
      if (h.mustChangePassword && !opts.allowTempPassword)
        throw new AppError(403, 'Please set your own password first', 'PASSWORD_CHANGE_REQUIRED')
      next()
    } catch (e) {
      next(e)
    }
  }
}

/** Helpers for handlers that already passed the middleware */
export function staffOf(req: Request): StaffAuth {
  if (!req.staff) throw unauthorized()
  return req.staff
}
export function hostelerOf(req: Request): HostelerAuth {
  if (!req.hosteler) throw unauthorized()
  return req.hosteler
}
