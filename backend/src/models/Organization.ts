import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions } from './_base.js'

const settingsSchema = new Schema(
  {
    rentDueDay: { type: Number, default: 5, min: 0, max: 28 },
    lateFeePerDay: { type: Number, default: 50, min: 0 },
    receiptPrefix: { type: String, default: 'RCPT', trim: true, maxlength: 10 },
    defaultSecurityDeposit: { type: Number, default: 5000, min: 0 },
    messMonthlyCharge: { type: Number, default: 3000, min: 0 },
    nightCurfew: { type: String, default: '22:00' },
    currencySymbol: { type: String, default: '₹' },
  },
  { _id: false },
)

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    ownerName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '' },
    plan: { type: String, enum: ['free', 'starter', 'pro', 'business'], default: 'free' },
    // how the paid plan was bought; null for Free
    billingCycle: { type: String, enum: ['monthly', 'yearly', 'onetime', null], default: null },
    // monthly/yearly plans run out here and work like Free until renewed; null = never
    planExpiresAt: { type: Date, default: null },
    settings: { type: settingsSchema, default: () => ({}) },
    // counters for human-readable numbers (incremented atomically)
    invoiceSeq: { type: Number, default: 1000 },
    receiptSeq: { type: Number, default: 5000 },
  },
  baseOptions(['invoiceSeq', 'receiptSeq']),
)

export type OrganizationDoc = InferSchemaType<typeof organizationSchema>
export const Organization = model('Organization', organizationSchema)
