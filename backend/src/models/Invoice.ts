import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

/** Bill line categories. 'other' covers custom lines added by staff. */
export const CHARGE_KEYS = ['rent', 'mess', 'electricity', 'deposit', 'water', 'internet', 'laundry', 'maintenance', 'late_fee', 'other'] as const
export type ChargeKey = (typeof CHARGE_KEYS)[number]

const itemSchema = new Schema(
  {
    key: { type: String, enum: CHARGE_KEYS, default: 'other' },
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const invoiceSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    number: { type: String, required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    items: { type: [itemSchema], validate: (v: unknown[]) => v.length > 0 },
    total: { type: Number, required: true, min: 0 },
    /** Sum of payments recorded against this invoice (kept in sync in the same transaction) */
    paidAmount: { type: Number, default: 0, min: 0 },
    dueDate: { type: String, required: true },
    cancelled: { type: Boolean, default: false },
  },
  baseOptions(),
)
invoiceSchema.index({ orgId: 1, number: 1 }, { unique: true })
invoiceSchema.index({ orgId: 1, month: 1 })

export type InvoiceDoc = InferSchemaType<typeof invoiceSchema>
export const Invoice = model('Invoice', invoiceSchema)

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'cancelled'

/** Same status rules as the frontend. */
export function invoiceStatus(
  inv: { cancelled: boolean; total: number; paidAmount: number; dueDate: string },
  today: string,
): InvoiceStatus {
  if (inv.cancelled) return 'cancelled'
  if (inv.paidAmount >= inv.total) return 'paid'
  if (inv.dueDate < today) return 'overdue'
  if (inv.paidAmount > 0) return 'partial'
  return 'unpaid'
}
