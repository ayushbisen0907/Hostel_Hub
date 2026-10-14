/** In-app notifications. */
import type { ClientSession, Types } from 'mongoose'
import { Notification, type NotificationType } from '../models/Notification.js'
import { User } from '../models/User.js'
import { shortDate } from './dates.js'

type Id = string | Types.ObjectId

export interface NotificationInput {
  type: NotificationType
  title: string
  body?: string
  link?: string
  hostelId?: Id | null
}

/** Roles that run admissions / check-outs (move-out requests). */
export const CHECKIN_ROLES = ['owner', 'manager', 'warden'] as const

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

/**
 * Tells a hosteler about a new bill, with its number, period and due date.
 * `period` is e.g. "13 Oct – 12 Nov 2026" (rent cycle) or "October 2026".
 */
export async function notifyNewBill(
  orgId: Id,
  inv: { hostelerId: Id; hostelId: Id; number: string; total: number; dueDate: string },
  period: string,
  session?: ClientSession,
) {
  await notifyHostelers(
    orgId,
    [inv.hostelerId],
    {
      type: 'bill_generated',
      hostelId: inv.hostelId,
      title: `New bill: ₹${inv.total.toLocaleString('en-IN')}`,
      body: `Your bill ${inv.number} for ${period} is ready. Due by ${shortDate(inv.dueDate, true)}. Pay to the hostel's UPI and report the transaction ID in the app.`,
      link: '/portal/fees',
    },
    session,
  )
}
