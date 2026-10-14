/**
 * Organization (mounted at /api/org)
 *
 *   GET    /api/org                            any staff: organization + settings, plan, usage, plan limits
 *   PATCH  /api/org                            owner: name, ownerName, email, phone
 *   PATCH  /api/org/settings                   owner: settings fields
 *   PATCH  /api/org/plan                       owner: { plan } (409 if beds exceed the target plan)
 *
 *   GET    /api/org/users                      owner: staff logins
 *   POST   /api/org/users                      owner: create manager / warden / accountant login
 *   PATCH  /api/org/users/:id                  owner: name, phone, role, active
 *   POST   /api/org/users/:id/reset-password   owner: new temporary password (signs the user out)
 *   DELETE /api/org/users/:id                  owner
 *
 *   GET    /api/org/export                     owner: JSON backup of every org collection
 */
import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { ah, idParam, parse } from '../../lib/http.js'
import { conflict, forbidden, notFound } from '../../lib/errors.js'
import { generateTempPassword, hashPassword, isStrongPassword, PASSWORD_RULE } from '../../lib/auth.js'
import { PLANS, type Plan } from '../../lib/plans.js'
import { logActivity } from '../../lib/org.js'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { toApi } from '../../models/_base.js'
import { Organization } from '../../models/Organization.js'
import { User } from '../../models/User.js'
import { Hostel } from '../../models/Hostel.js'
import { Bed } from '../../models/Bed.js'
import { Hosteler } from '../../models/Hosteler.js'

export const router = Router()

/* ------------------------------------------------------------------ */
/* Organization                                                        */
/* ------------------------------------------------------------------ */

async function orgUsage(orgId: string) {
  const [hostels, beds, activeHostelers] = await Promise.all([
    Hostel.countDocuments({ orgId }),
    Bed.countDocuments({ orgId }),
    Hosteler.countDocuments({ orgId, status: 'active' }),
  ])
  return { hostels, beds, activeHostelers }
}

async function orgResponse(orgId: string) {
  const org = await Organization.findById(orgId)
  if (!org) throw notFound('Organization')
  const plan = (org.plan ?? 'free') as Plan
  const p = PLANS[plan]
  return {
    ...org.toJSON(),
    usage: await orgUsage(orgId),
    limits: { plan, name: p.name, pricePerBed: p.pricePerBed, maxBeds: p.maxBeds, modules: p.modules },
  }
}

router.get(
  '/',
  requireStaff(),
  ah(async (req, res) => {
    res.json(await orgResponse(staffOf(req).orgId))
  }),
)

const orgPatch = z
  .object({
    name: z.string().trim().min(2).max(120),
    ownerName: z.string().trim().min(2).max(80),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(20),
  })
  .partial()
  .strict()

router.patch(
  '/',
  requireStaff('org'),
  ah(async (req, res) => {
    const body = parse(orgPatch, req.body)
    const { orgId } = staffOf(req)
    if (Object.keys(body).length) await Organization.updateOne({ _id: orgId }, { $set: body }, { runValidators: true })
    res.json(await orgResponse(orgId))
  }),
)

const settingsPatch = z
  .object({
    rentDueDay: z.coerce.number().int().min(0).max(28),
    lateFeePerDay: z.coerce.number().min(0).max(100_000),
    receiptPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,10}$/, 'Use 1-10 letters, digits or dashes'),
    defaultSecurityDeposit: z.coerce.number().min(0).max(10_000_000),
    messMonthlyCharge: z.coerce.number().min(0).max(1_000_000),
    nightCurfew: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'),
    currencySymbol: z.string().trim().min(1).max(5),
  })
  .partial()
  .strict()

router.patch(
  '/settings',
  requireStaff('org'),
  ah(async (req, res) => {
    const body = parse(settingsPatch, req.body)
    const { orgId } = staffOf(req)
    const set = Object.fromEntries(Object.entries(body).map(([k, v]) => [`settings.${k}`, v]))
    if (Object.keys(set).length) await Organization.updateOne({ _id: orgId }, { $set: set }, { runValidators: true })
    const org = await Organization.findById(orgId).select('settings').lean()
    if (!org) throw notFound('Organization')
    res.json(org.settings)
  }),
)

router.patch(
  '/plan',
  requireStaff('org'),
  ah(async (req, res) => {
    const { plan } = parse(z.object({ plan: z.enum(['free', 'basic', 'pro']) }), req.body)
    const { orgId } = staffOf(req)
    const max = PLANS[plan].maxBeds
    if (max !== null) {
      const beds = await Bed.countDocuments({ orgId })
      if (beds > max)
        throw conflict(`You have ${beds} beds but the ${PLANS[plan].name} plan allows up to ${max}. Remove beds before switching.`)
    }
    await Organization.updateOne({ _id: orgId }, { $set: { plan } })
    await logActivity(orgId, `Plan changed to ${PLANS[plan].name}`)
    res.json(await orgResponse(orgId))
  }),
)

/* ------------------------------------------------------------------ */
/* Staff logins                                                        */
/* ------------------------------------------------------------------ */

const staffRole = z.enum(['manager', 'warden', 'accountant'])

router.get(
  '/users',
  requireStaff('org'),
  ah(async (req, res) => {
    const users = await User.find({ orgId: staffOf(req).orgId }).sort({ createdAt: 1 })
    res.json({ items: users.map((u) => u.toJSON()) })
  }),
)

router.post(
  '/users',
  requireStaff('org'),
  ah(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().toLowerCase().email(),
        phone: z.string().trim().max(20).default(''),
        role: staffRole,
        password: z.string().refine(isStrongPassword, { message: PASSWORD_RULE }).optional(),
      }),
      req.body,
    )
    const { orgId } = staffOf(req)
    if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists')
    const tempPassword = body.password ? null : generateTempPassword()
    const user = await User.create({
      orgId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
      passwordHash: await hashPassword(body.password ?? tempPassword!),
    })
    await logActivity(orgId, `Login created for ${user.name} (${user.role})`)
    // the generated password is only ever returned here
    res.status(201).json({ user: user.toJSON(), tempPassword })
  }),
)

/** A staff login of this org the caller may manage (not the owner, not themselves). */
async function manageableUser(orgId: string, userId: string, selfId: string) {
  const user = await User.findOne({ _id: userId, orgId })
  if (!user) throw notFound('User')
  if (user.role === 'owner') throw forbidden("The owner's account can't be changed here")
  if (String(user._id) === selfId) throw forbidden("You can't change your own account here")
  return user
}

router.patch(
  '/users/:id',
  requireStaff('org'),
  ah(async (req, res) => {
    const body = parse(
      z
        .object({
          name: z.string().trim().min(2).max(80),
          phone: z.string().trim().max(20),
          role: staffRole,
          active: z.boolean(),
        })
        .partial()
        .strict(),
      req.body,
    )
    const { orgId, userId } = staffOf(req)
    const user = await manageableUser(orgId, idParam(req), userId)
    const deactivating = body.active === false && user.active
    Object.assign(user, body)
    if (deactivating) user.tokenVersion += 1 // sign them out everywhere
    await user.save()
    res.json(user.toJSON())
  }),
)

router.post(
  '/users/:id/reset-password',
  requireStaff('org'),
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const user = await manageableUser(orgId, idParam(req), userId)
    const tempPassword = generateTempPassword()
    user.passwordHash = await hashPassword(tempPassword)
    user.tokenVersion += 1
    await user.save()
    res.json({ user: user.toJSON(), tempPassword })
  }),
)

router.delete(
  '/users/:id',
  requireStaff('org'),
  ah(async (req, res) => {
    const { orgId, userId } = staffOf(req)
    const user = await manageableUser(orgId, idParam(req), userId)
    await user.deleteOne()
    await logActivity(orgId, `Login removed for ${user.name}`)
    res.json({ ok: true })
  }),
)

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

const SECRET_FIELDS = ['passwordHash', 'tokenVersion', 'storageKey']

router.get(
  '/export',
  requireStaff('org'),
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const org = await Organization.findById(orgId)
    if (!org) throw notFound('Organization')
    const collections: Record<string, unknown[]> = {}
    // every tenant-owned model carries orgId
    const models = Object.values(mongoose.models).filter((m) => m.schema.path('orgId'))
    await Promise.all(
      models.map(async (m) => {
        const docs = (await m.find({ orgId }).lean()) as { _id: unknown }[]
        collections[m.collection.collectionName] = docs.map((d) => toApi(d, SECRET_FIELDS))
      }),
    )
    res.setHeader('Content-Disposition', `attachment; filename="hostelhub-backup-${new Date().toISOString().slice(0, 10)}.json"`)
    res.json({ exportedAt: new Date().toISOString(), version: 1, organization: org.toJSON(), collections })
  }),
)
