/** In-app notifications. */
import type { ClientSession, Types } from 'mongoose'
import { Notification } from '../models/Notification.js'
import { User } from '../models/User.js'

type Id = string | Types.ObjectId
type NotificationType = 'payment_submitted' | 'payment_verified' | 'payment_rejected' | 'bill_generated' | 'general'

export interface NotificationInput {
  type: NotificationType
  title: string
  body?: string
  link?: string
  hostelId?: Id | null
}

/** Roles that handle money and get payment notifications. */
export const PAYMENT_ROLES = ['owner', 'manager', 'accountant'] as const

/** Notify every active staff user of the org with one of `roles`. */
export async function notifyStaff(
  orgId: Id,
  n: NotificationInput,
  roles: readonly string[] = PAYMENT_ROLES,
  session?: ClientSession,
) {
  const users = await User.find({ orgId, active: true, role: { $in: roles } }).select('_id').session(session ?? null).lean()
  if (!users.length) return
  await Notification.insertMany(
    users.map((u) => ({
      orgId,
      hostelId: n.hostelId ?? null,
      recipientKind: 'staff',
      recipientId: u._id,
      type: n.type,
      title: n.title,
      body: n.body ?? '',
      link: n.link ?? '',
    })),
    { session },
  )
}

export async function notifyHostelers(orgId: Id, hostelerIds: Id[], n: NotificationInput, session?: ClientSession) {
  if (!hostelerIds.length) return
  await Notification.insertMany(
    hostelerIds.map((id) => ({
      orgId,
      hostelId: n.hostelId ?? null,
      recipientKind: 'hosteler',
      recipientId: id,
      type: n.type,
      title: n.title,
      body: n.body ?? '',
      link: n.link ?? '',
    })),
    { session },
  )
}
