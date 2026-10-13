import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField } from './_base.js'

/** In-app notification for one staff user or one hosteler. */
const notificationSchema = new Schema(
  {
    orgId: orgField,
    hostelId: optionalRef('Hostel'),
    recipientKind: { type: String, enum: ['staff', 'hosteler'], required: true },
    /** User id (staff) or Hosteler id */
    recipientId: { type: Schema.Types.ObjectId, required: true },
    type: {
      type: String,
      enum: ['payment_submitted', 'payment_verified', 'payment_rejected', 'bill_generated', 'general'],
      default: 'general',
    },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, default: '', maxlength: 500 },
    /** in-app path to open, e.g. /app/fees?tab=verify or /portal/fees */
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  baseOptions(),
)
notificationSchema.index({ recipientKind: 1, recipientId: 1, createdAt: -1 })
notificationSchema.index({ recipientKind: 1, recipientId: 1, readAt: 1 })

export type NotificationDoc = InferSchemaType<typeof notificationSchema>
export const Notification = model('Notification', notificationSchema)
