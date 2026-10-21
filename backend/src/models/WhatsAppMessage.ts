import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField } from './_base.js'

/**
 * Outbox of WhatsApp messages to hostelers (sent through the hostel's Pabbly Chatflow
 * account, see lib/whatsapp.ts). A message is queued inside the transaction that
 * creates the bill and sent after it commits, so a rolled-back bill never sends one.
 */
export const WHATSAPP_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const

const whatsAppMessageSchema = new Schema(
  {
    orgId: orgField,
    hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true },
    hostelerId: { type: Schema.Types.ObjectId, ref: 'Hosteler', required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    kind: { type: String, enum: ['bill'], default: 'bill' },
    /** queued automatically when the bill was created (one per bill); false = sent again by staff */
    auto: { type: Boolean, default: true },
    /** recipient with country code, digits only, e.g. 919876543210 */
    to: { type: String, required: true },
    templateName: { type: String, required: true },
    /** template variables {{1}}, {{2}}… in order */
    params: { type: [String], default: [] },
    status: { type: String, enum: WHATSAPP_STATUSES, default: 'pending' },
    attempts: { type: Number, default: 0 },
    /** not retried before this time (back-off after a failure, or a send in progress) */
    nextAttemptAt: { type: Date, default: () => new Date() },
    error: { type: String, default: '' },
    providerMessageId: { type: String, default: '' },
    sentAt: { type: Date, default: null },
  },
  baseOptions(),
)
whatsAppMessageSchema.index({ status: 1, nextAttemptAt: 1 })
whatsAppMessageSchema.index({ orgId: 1, invoiceId: 1, createdAt: -1 })
// at most one automatic message per bill
whatsAppMessageSchema.index({ invoiceId: 1 }, { unique: true, partialFilterExpression: { auto: true, invoiceId: { $type: 'objectId' } } })

export type WhatsAppMessageDoc = InferSchemaType<typeof whatsAppMessageSchema>
export const WhatsAppMessage = model('WhatsAppMessage', whatsAppMessageSchema)
