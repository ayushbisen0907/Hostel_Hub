import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

/** A hosteler's signed acceptance of one version of their hostel's rules (kept as evidence). */
const rulesConsentSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    rulesVersion: { type: Number, required: true, min: 1 },
    /** the exact rules text that was accepted */
    rulesText: { type: String, required: true },
    signedName: { type: String, required: true, trim: true, maxlength: 80 },
    /** PNG data URL of the drawn signature */
    signature: { type: String, required: true },
    acceptedAt: { type: Date, required: true, default: () => new Date() },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  baseOptions(),
)
rulesConsentSchema.index({ hostelerId: 1, rulesVersion: 1 }, { unique: true })

export type RulesConsentDoc = InferSchemaType<typeof rulesConsentSchema>
export const RulesConsent = model('RulesConsent', rulesConsentSchema)
