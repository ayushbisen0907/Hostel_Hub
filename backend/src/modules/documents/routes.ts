/**
 * Hosteler documents (KYC / ID proofs), mounted at /api/documents
 *
 *   GET    /               list (?hostelerId, ?type, ?verified, ?expiring=30, ?hostelId) with hosteler name
 *   GET    /missing        active hostelers lacking aadhaar or police verification
 *   POST   /               multipart: file + hostelerId, type, expiryDate?
 *   GET    /:id/file       view inline
 *   GET    /:id/download   download
 *   PATCH  /:id            { verified?, expiryDate?, type? }
 *   DELETE /:id            removes the stored file too
 */
import path from 'node:path'
import { Router } from 'express'
import { z } from 'zod'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { ah, dateStr, idParam, objectId, paginate, paginationQuery, parse, todayStr } from '../../lib/http.js'
import { hostelScope, logActivity } from '../../lib/org.js'
import { requirePlan } from '../../lib/plans.js'
import { removeStoredFile, sendStoredFile, upload } from '../../lib/upload.js'
import { toApi } from '../../models/_base.js'
import { DOCUMENT_TYPES, HDocument } from '../../models/Document.js'
import { Hosteler } from '../../models/Hosteler.js'

export const router = Router()

const auth = [requireStaff('documents'), requirePlan('documents')]
const REQUIRED = ['aadhaar', 'police_verification'] as const

const listQuery = paginationQuery.extend({
  hostelerId: objectId.optional(),
  hostelId: z.string().optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
  verified: z.enum(['true', 'false']).optional(),
  /** expired or expiring within N days */
  expiring: z.coerce.number().int().min(0).max(3650).optional(),
})

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

router.get(
  '/',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const qy = parse(listQuery, req.query)
    const filter: Record<string, unknown> = { orgId, ...hostelScope(qy) }
    if (qy.hostelerId) filter.hostelerId = qy.hostelerId
    if (qy.type) filter.type = qy.type
    if (qy.verified) filter.verified = qy.verified === 'true'
    if (qy.expiring !== undefined) filter.expiryDate = { $ne: null, $lte: addDays(todayStr(), qy.expiring) }
    const [rows, total] = await Promise.all([
      HDocument.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((qy.page - 1) * qy.limit)
        .limit(qy.limit)
        .lean(),
      HDocument.countDocuments(filter),
    ])
    const hs = await Hosteler.find({ orgId, _id: { $in: rows.map((d) => d.hostelerId) } })
      .select('name loginId status')
      .lean()
    const hMap = new Map(hs.map((h) => [String(h._id), h]))
    const items = rows.map((d) => {
      const h = hMap.get(String(d.hostelerId))
      return {
        ...toApi(d, ['storageKey']),
        uploadedAt: d.createdAt,
        hostelerName: h?.name ?? null,
        hostelerLoginId: h?.loginId ?? null,
      }
    })
    res.json(paginate(items, total, qy.page, qy.limit))
  }),
)

router.get(
  '/missing',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const scope = hostelScope(req.query as Record<string, unknown>)
    const hs = await Hosteler.find({ orgId, status: 'active', ...scope })
      .select('name loginId phone hostelId roomId bedId')
      .lean()
    const docs = await HDocument.find({ orgId, hostelerId: { $in: hs.map((h) => h._id) }, type: { $in: REQUIRED } })
      .select('hostelerId type')
      .lean()
    const have = new Map<string, Set<string>>()
    for (const d of docs) {
      const s = have.get(String(d.hostelerId)) ?? new Set<string>()
      s.add(d.type)
      have.set(String(d.hostelerId), s)
    }
    const items = hs
      .map((h) => ({
        hosteler: { id: String(h._id), name: h.name, loginId: h.loginId, phone: h.phone, hostelId: String(h.hostelId) },
        lacks: REQUIRED.filter((t) => !have.get(String(h._id))?.has(t)),
      }))
      .filter((x) => x.lacks.length > 0)
      .sort((a, b) => b.lacks.length - a.lacks.length || a.hosteler.name.localeCompare(b.hosteler.name))
    res.json({ items })
  }),
)

const uploadSchema = z.object({
  hostelerId: objectId,
  type: z.enum(DOCUMENT_TYPES),
  expiryDate: z
    .union([z.literal(''), z.literal('null'), dateStr])
    .optional()
    .transform((v) => (v && v !== 'null' ? v : null)),
})

router.post(
  '/',
  ...auth, // authenticate before multer writes anything to disk
  upload.single('file'),
  ah(async (req, res) => {
    const file = req.file
    try {
      const { orgId } = staffOf(req)
      if (!file) throw badRequest('Choose a file to upload (field "file")')
      const body = parse(uploadSchema, req.body)
      const h = await Hosteler.findOne({ _id: body.hostelerId, orgId }).select('name hostelId').lean()
      if (!h) throw notFound('Hosteler')
      const doc = await HDocument.create({
        orgId,
        hostelId: h.hostelId,
        hostelerId: h._id,
        type: body.type,
        fileName: path.basename(file.originalname).slice(0, 200) || 'document',
        mimeType: file.mimetype,
        size: file.size,
        storageKey: file.filename,
        expiryDate: body.expiryDate,
        uploadedBy: 'staff',
      })
      await logActivity(orgId, `Document uploaded for ${h.name}`, 'document', h.hostelId)
      res.status(201).json({ ...doc.toJSON(), uploadedAt: doc.createdAt, hostelerName: h.name })
    } catch (e) {
      if (file) removeStoredFile(file.filename)
      throw e
    }
  }),
)

async function findDoc(orgId: string, id: string) {
  const d = await HDocument.findOne({ _id: id, orgId }).lean()
  if (!d) throw notFound('Document')
  return d
}

router.get(
  '/:id/file',
  ...auth,
  ah(async (req, res) => {
    const d = await findDoc(staffOf(req).orgId, idParam(req))
    sendStoredFile(res, d.storageKey, d.fileName, d.mimeType, false)
  }),
)

router.get(
  '/:id/download',
  ...auth,
  ah(async (req, res) => {
    const d = await findDoc(staffOf(req).orgId, idParam(req))
    sendStoredFile(res, d.storageKey, d.fileName, d.mimeType, true)
  }),
)

const patchSchema = z
  .object({ verified: z.boolean(), expiryDate: dateStr.nullable(), type: z.enum(DOCUMENT_TYPES) })
  .partial()
  .strict()

router.patch(
  '/:id',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const id = idParam(req)
    const body = parse(patchSchema, req.body)
    const d = await HDocument.findOneAndUpdate({ _id: id, orgId }, { $set: body }, { new: true, runValidators: true })
    if (!d) throw notFound('Document')
    res.json({ ...d.toJSON(), uploadedAt: d.createdAt })
  }),
)

router.delete(
  '/:id',
  ...auth,
  ah(async (req, res) => {
    const { orgId } = staffOf(req)
    const d = await HDocument.findOneAndDelete({ _id: idParam(req), orgId })
    if (!d) throw notFound('Document')
    removeStoredFile(d.storageKey)
    res.status(204).end()
  }),
)

