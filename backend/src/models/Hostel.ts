import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField } from './_base.js'

const hostelSchema = new Schema(
  {
    orgId: orgField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['boys', 'girls', 'coed'], required: true },
    address: { type: String, default: '', trim: true },
    city: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    /** Prefix for hosteler IDs, e.g. SBH -> SBH-0001 */
    code: { type: String, required: true, uppercase: true, match: /^[A-Z0-9]{2,8}$/ },
    /** Last issued hosteler number (incremented atomically at admission) */
    hostelerSeq: { type: Number, default: 0 },
  },
  baseOptions(),
)
// unique across ALL organizations: hosteler IDs (CODE-0001) must be globally unique
// because the hosteler login page has no organization field
hostelSchema.index({ code: 1 }, { unique: true })

export type HostelDoc = InferSchemaType<typeof hostelSchema>
export const Hostel = model('Hostel', hostelSchema)
