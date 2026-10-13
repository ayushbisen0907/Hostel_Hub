import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

/**
 * A hosteler's "I have paid" report. The hosteler pays the hostel's UPI ID
 * outside the app, then submits the amount + UPI transaction ID (UTR).
 * Staff check their bank/UPI app and verify (full or partial amount) or
 * reject it. Only on verification is money recorded as Payment(s), allocated
 * to the hosteler's oldest unpaid bills first.
 */
const paymentClaimSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    amount: { type: Number, required: true, min: 1 }, // what the hosteler says they paid
    utr: { type: String, required: true, trim: true, uppercase: true },
    paidOn: { type: String, required: true }, // YYYY-MM-DD
    note: { type: String, default: '', maxlength: 500 },
    screenshotKey: { type: String, default: null },
    screenshotMime: { type: String, default: null },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    /** what staff confirmed actually arrived (may be less than `amount`) */
    receivedAmount: { type: Number, default: null },
    rejectReason: { type: String, default: '' },
    reviewedBy: optionalRef('User'),
    reviewedByName: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
    /** payments created on verification (one per bill the money was applied to) */
    paymentIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Payment' }], default: [] },
  },
  baseOptions(['screenshotKey', 'screenshotMime']),
)
paymentClaimSchema.index({ orgId: 1, status: 1, createdAt: -1 })
// the same UPI transaction can't be claimed twice (rejected claims don't block a retry)
paymentClaimSchema.index({ orgId: 1, utr: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'verified'] } } })

export type PaymentClaimDoc = InferSchemaType<typeof paymentClaimSchema>
export const PaymentClaim = model('PaymentClaim', paymentClaimSchema)
