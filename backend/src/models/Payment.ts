import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank', 'online'] as const

const paymentSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    invoiceId: { ...optionalRef('Invoice'), index: true },
    /** rent = against an invoice, deposit = security deposit, advance = unallocated */
    kind: { type: String, enum: ['rent', 'deposit', 'advance'], required: true },
    receiptNo: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: { type: String, default: '' },
    date: { type: String, required: true },
    note: { type: String, default: '' },
    recordedBy: { type: String, enum: ['staff', 'hosteler'], default: 'staff' },
  },
  baseOptions(),
)
paymentSchema.index({ orgId: 1, receiptNo: 1 }, { unique: true })
paymentSchema.index({ orgId: 1, date: -1 })

export type PaymentDoc = InferSchemaType<typeof paymentSchema>
export const Payment = model('Payment', paymentSchema)
