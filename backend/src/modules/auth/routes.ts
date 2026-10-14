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
 *   GET  /api/portal/auth/me            works even while on the temporary password / rules unsigned
 *                                       (+ consentRequired, rulesVersion)
 *   GET  /api/portal/auth/rules         { hostelName, rulesText, rulesVersion, signed, signedAt } (after the password step)
 *   POST /api/portal/auth/consent       { signedName, signature (PNG data URL ≤ 200 KB), accept: true }
 *
 * Gate order for every other portal endpoint: temporary password
 * (PASSWORD_CHANGE_REQUIRED) first, then unsigned rules (CONSENT_REQUIRED).
 */
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { ah, parse } from '../../lib/http.js'
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js'
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
import { consentPending, hostelerOf, requireHosteler, requireStaff, staffOf } from '../../middleware/auth.js'
import { RulesConsent } from '../../models/RulesConsent.js'
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
  const hostel = await Hostel.findById(h.hostelId).select('name code city phone rulesVersion rulesText').lean()
  return {
    consentRequired: !!hostel && !!hostel.rulesText && (hostel.rulesVersion ?? 0) > (h.consentVersion ?? 0),
    rulesVersion: hostel && hostel.rulesText ? (hostel.rulesVersion ?? 0) : 0,
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
  requireHosteler({ allowTempPassword: true, allowConsentPending: true }),
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
  requireHosteler({ allowTempPassword: true, allowConsentPending: true }),
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
    res.json({ token: hostelerToken(h), mustChangePassword: false, consentRequired: await consentPending(h) })
  }),
)

/* ---------------- consent to the hostel's rules ---------------- */

const SIGNATURE_MAX_BYTES = 200 * 1024
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** "  Aarav   SHARMA " ~ "aarav sharma" (case and spaces ignored) */
const looseName = (s: string) => s.toLowerCase().replace(/\s+/g, '')

const consentSchema = z.object({
  signedName: z.string().trim().min(2, 'Type your full name').max(80),
  // base64 is 4/3 of the bytes; the decoded size is checked below
  signature: z.string().max(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64, 'Signature image must be 200 KB or smaller'),
  accept: z.literal(true, { errorMap: () => ({ message: 'You must accept the rules' }) }),
})

async function rulesOf(hostelId: unknown) {
  const hostel = await Hostel.findById(hostelId).select('name rulesText rulesVersion').lean()
  if (!hostel) throw notFound('Hostel')
  return hostel
}

portalAuthRouter.get(
  '/rules',
  requireHosteler({ allowConsentPending: true }),
  ah(async (req, res) => {
    const me = hostelerOf(req)
    const h = await Hosteler.findById(me.hostelerId).select('hostelId consentVersion').lean()
    if (!h) throw unauthorized()
    const hostel = await rulesOf(h.hostelId)
    const rulesVersion = hostel.rulesText ? (hostel.rulesVersion ?? 0) : 0
    const signed = rulesVersion > 0 && (h.consentVersion ?? 0) >= rulesVersion
    const last = signed ? await RulesConsent.findOne({ hostelerId: h._id, rulesVersion: h.consentVersion }).select('acceptedAt').lean() : null
    res.json({ hostelName: hostel.name, rulesText: hostel.rulesText ?? '', rulesVersion, signed, signedAt: last?.acceptedAt ?? null })
  }),
)

portalAuthRouter.post(
  '/consent',
  requireHosteler({ allowConsentPending: true }),
  ah(async (req, res) => {
    const body = parse(consentSchema, req.body)
    const m = PNG_DATA_URL.exec(body.signature)
    if (!m) throw badRequest('Signature must be a PNG image (data:image/png;base64,…)')
    const bytes = Buffer.from(m[1]!, 'base64')
    if (bytes.length > SIGNATURE_MAX_BYTES) throw badRequest('Signature image must be 200 KB or smaller')
    if (bytes.length < PNG_MAGIC.length + 16 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) throw badRequest('Signature is not a valid PNG image')

    const me = hostelerOf(req)
    const result = await withTransaction(async (session) => {
      const h = await Hosteler.findById(me.hostelerId).session(session)
      if (!h) throw unauthorized()
      if (looseName(body.signedName) !== looseName(h.name)) throw badRequest(`Type your name exactly as registered: ${h.name}`)
      const hostel = await Hostel.findById(h.hostelId).select('name rulesText rulesVersion').session(session).lean()
      if (!hostel) throw notFound('Hostel')
      const version = hostel.rulesVersion ?? 0
      if (!hostel.rulesText || version < 1) throw conflict('Your hostel has no rules to sign')
      if ((h.consentVersion ?? 0) >= version) throw conflict('You have already signed the current rules')
      const [consent] = await RulesConsent.create(
        [
          {
            orgId: h.orgId,
            hostelId: h.hostelId,
            hostelerId: h._id,
            rulesVersion: version,
            rulesText: hostel.rulesText,
            signedName: body.signedName,
            signature: body.signature,
            acceptedAt: new Date(),
            ip: (req.ip ?? '').slice(0, 64),
            userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500),
          },
        ],
        { session },
      )
      h.consentVersion = version
      await h.save({ session })
      await logActivity(h.orgId, `${h.name} signed the hostel rules (version ${version})`, 'general', h.hostelId, session)
      return consent!
    })
    const { signature: _sig, rulesText: _text, ...rest } = result.toJSON() as Record<string, unknown>
    void _sig
    void _text
    res.status(201).json({ consent: rest, consentRequired: false, rulesVersion: result.rulesVersion })
  }),
)
