/**
 * In-app notifications for staff (mounted at /api/notifications).
 * Hosteler notifications live under /api/portal/notifications.
 *
 *   GET  /api/notifications?unread=true&limit=   newest first, + unreadCount
 *   POST /api/notifications/:id/read
 *   POST /api/notifications/read-all
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireStaff, staffOf } from '../../middleware/auth.js'
import { ah, idParam, parse } from '../../lib/http.js'
import { notFound } from '../../lib/errors.js'
import { Notification } from '../../models/Notification.js'

export const router = Router()
router.use(requireStaff())

/** Shared list/read logic for staff and hostelers. */
export function notificationHandlers(who: (req: Parameters<Parameters<typeof ah>[0]>[0]) => { kind: 'staff' | 'hosteler'; id: string }) {
  return {
    list: ah(async (req, res) => {
      const { kind, id } = who(req)
      const q = parse(z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query)
      const filter = { recipientKind: kind, recipientId: id, ...(q.unread === 'true' ? { readAt: null } : {}) }
      const [items, unreadCount] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).limit(q.limit),
        Notification.countDocuments({ recipientKind: kind, recipientId: id, readAt: null }),
      ])
      res.json({ items: items.map((n) => n.toJSON()), unreadCount })
    }),
    read: ah(async (req, res) => {
      const { kind, id } = who(req)
      const n = await Notification.findOneAndUpdate(
        { _id: idParam(req), recipientKind: kind, recipientId: id },
        { $set: { readAt: new Date() } },
        { new: true },
      )
      if (!n) throw notFound('Notification')
      res.json(n.toJSON())
    }),
    readAll: ah(async (req, res) => {
      const { kind, id } = who(req)
      const r = await Notification.updateMany({ recipientKind: kind, recipientId: id, readAt: null }, { $set: { readAt: new Date() } })
      res.json({ updated: r.modifiedCount })
    }),
  }
}

const h = notificationHandlers((req) => ({ kind: 'staff', id: staffOf(req).userId }))
router.get('/', h.list)
router.post('/read-all', h.readAll)
router.post('/:id/read', h.read)
