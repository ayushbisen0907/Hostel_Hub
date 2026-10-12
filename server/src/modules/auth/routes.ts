/**
 * Authentication
 *
 * Staff (owner / manager / warden / accountant):
 *   POST /api/auth/signup            create organization + owner account
 *   POST /api/auth/login             email + password
 *   GET  /api/auth/me                current user + organization
 *   POST /api/auth/change-password   (signs out other sessions)
 *
 * Hosteler portal:
 *   POST /api/portal/auth/login         Hosteler ID + password
 *   POST /api/portal/auth/set-password  replace temporary password (first login) or change password
 *   GET  /api/portal/auth/me            works even while on the temporary password
 */
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { ah, parse } from '../../lib/http.js'
import { badRequest, conflict, unauthorized } from '../../lib/errors.js'
import {
  hashPassword,
  isStrongPassword,
  normalizeLoginId,
  PASSWORD_RULE,
  signToken,
  verifyPassword,
} from '../../lib/auth.js'
import { withTransaction } from '../../config/db.js'
import { Organization } from '../../models/Organization.js'
import { User } from '../../models/User.js'
import { Hosteler } from '../../models/Hosteler.js'
import { Hostel } from '../../models/Hostel.js'
import { hostelerOf, requireHosteler, requireStaff, staffOf } from '../../middleware/auth.js'
import { logActivity } from '../../lib/org.js'

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again in 15 minutes.' } },
})

const strongPassword = z.string().refine(isStrongPassword, { message: PASSWORD_RULE })

/* ================================================================== */
/* Staff                                                               */
/* ================================================================== */

export const staffAuthRouter = Router()

const signupSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).default(''),
  password: strongPassword,
})

function staffToken(user: { _id: unknown; orgId: unknown; role: 'owner' | 'manager' | 'warden' | 'accountant'; tokenVersion: number }) {
  return signToken({ kind: 'staff', sub: String(user._id), orgId: String(user.orgId), role: user.role, tv: user.tokenVersion })
}

staffAuthRouter.post(
  '/signup',
  loginLimiter,
  ah(async (req, res) => {
    const body = parse(signupSchema, req.body)
    if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists')
    const passwordHash = await hashPassword(body.password)
    const { org, user } = await withTransaction(async (session) => {
      const [org] = await Organization.create(
        [{ name: body.orgName, ownerName: body.ownerName, email: body.email, phone: body.phone }],
        { session },
      )
      const [user] = await User.create(
        [{ orgId: org!._id, name: body.ownerName, email: body.email, phone: body.phone, passwordHash, role: 'owner' }],
        { session },
      )
      return { org: org!, user: user! }
    })
    res.status(201).json({ token: staffToken(user), user: user.toJSON(), organization: org.toJSON() })
  }),
)

staffAuthRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body)
    const user = await User.findOne({ email: body.email })
    // same error for unknown email and wrong password (don't reveal which accounts exist)
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw unauthorized('Email or password is incorrect')
    if (!user.active) throw unauthorized('This account is disabled. Contact the owner.')
    user.lastLoginAt = new Date()
    await user.save()
    const org = await Organization.findById(user.orgId)
    res.json({ token: staffToken(user), user: user.toJSON(), organization: org?.toJSON() })
  }),
)

staffAuthRouter.get(
  '/me',
  requireStaff(),
  ah(async (req, res) => {
    const { userId, orgId } = staffOf(req)
    const [user, org] = await Promise.all([User.findById(userId), Organization.findById(orgId)])
    res.json({ user: user?.toJSON(), organization: org?.toJSON() })
  }),
)

staffAuthRouter.post(
  '/change-password',
  requireStaff(),
  ah(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: strongPassword }), req.body)
    const user = await User.findById(staffOf(req).userId)
    if (!user) throw unauthorized()
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect')
    user.passwordHash = await hashPassword(body.newPassword)
    user.tokenVersion += 1 // sign out every other session
    await user.save()
    res.json({ token: staffToken(user) })
  }),
)

/* ================================================================== */
/* Hosteler portal                                                     */
/* ================================================================== */

export const portalAuthRouter = Router()

function hostelerToken(h: { _id: unknown; orgId: unknown; hostelId: unknown; mustChangePassword: boolean; tokenVersion: number }) {
  return signToken({
    kind: 'hosteler',
    sub: String(h._id),
    orgId: String(h.orgId),
    hostelId: String(h.hostelId),
    mustChangePassword: h.mustChangePassword,
    tv: h.tokenVersion,
  })
}

async function portalProfile(h: InstanceType<typeof Hosteler>) {
  const hostel = await Hostel.findById(h.hostelId).select('name code city phone').lean()
  return {
    hosteler: h.toJSON(),
    hostel: hostel ? { id: String(hostel._id), name: hostel.name, code: hostel.code, city: hostel.city, phone: hostel.phone } : null,
  }
}

portalAuthRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ loginId: z.string().trim().min(1), password: z.string().min(1) }), req.body)
    const h = await Hosteler.findOne({ loginId: normalizeLoginId(body.loginId) })
    if (!h || !(await verifyPassword(body.password, h.passwordHash))) throw unauthorized('Hosteler ID or password is incorrect')
    if (h.status === 'checked_out') throw unauthorized('This account was closed at check-out. Contact the hostel office.')
    h.lastLoginAt = new Date()
    await h.save()
    res.json({ token: hostelerToken(h), mustChangePassword: h.mustChangePassword, ...(await portalProfile(h)) })
  }),
)

portalAuthRouter.get(
  '/me',
  requireHosteler({ allowTempPassword: true }),
  ah(async (req, res) => {
    const h = await Hosteler.findById(hostelerOf(req).hostelerId)
    if (!h) throw unauthorized()
    res.json({ mustChangePassword: h.mustChangePassword, ...(await portalProfile(h)) })
  }),
)

/**
 * First login: currentPassword = the temporary password from the hostel office.
 * Afterwards the temporary password no longer works and all old tokens are revoked.
 */
portalAuthRouter.post(
  '/set-password',
  requireHosteler({ allowTempPassword: true }),
  ah(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: strongPassword }), req.body)
    const h = await Hosteler.findById(hostelerOf(req).hostelerId)
    if (!h) throw unauthorized()
    if (!(await verifyPassword(body.currentPassword, h.passwordHash)))
      throw badRequest(h.mustChangePassword ? 'Temporary password is incorrect' : 'Current password is incorrect')
    if (body.currentPassword === body.newPassword) throw badRequest('New password must be different')
    const wasFirst = h.mustChangePassword
    h.passwordHash = await hashPassword(body.newPassword)
    h.mustChangePassword = false
    h.passwordChangedAt = new Date()
    h.tokenVersion += 1
    await h.save()
    if (wasFirst) await logActivity(h.orgId, `${h.name} activated their portal account`, 'general', h.hostelId)
    res.json({ token: hostelerToken(h), mustChangePassword: false })
  }),
)
