import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField } from './_base.js'

/** Monthly charge heads billed to every hosteler of the hostel (0 = not charged). */
const chargesSchema = new Schema(
  {
    mess: { type: Number, default: 0, min: 0 }, // only for hostelers who opted for mess
    electricity: { type: Number, default: 0, min: 0 },
    water: { type: Number, default: 0, min: 0 },
    internet: { type: Number, default: 0, min: 0 },
    laundry: { type: Number, default: 0, min: 0 },
    maintenance: { type: Number, default: 0, min: 0 },
    /** any other fixed monthly charge, e.g. "Housekeeping" */
    others: {
      type: [new Schema({ label: { type: String, required: true, trim: true, maxlength: 60 }, amount: { type: Number, required: true, min: 0 } }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
)

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

    // ---- where hostelers pay rent (UPI) ----
    upiId: { type: String, default: '', trim: true },
    payeeName: { type: String, default: '', trim: true },
    /** owner-uploaded QR image (file in UPLOAD_DIR); if absent the app draws a QR from upiId */
    qrStorageKey: { type: String, default: null },
    qrMimeType: { type: String, default: null },

    charges: { type: chargesSchema, default: () => ({}) },
  },
  baseOptions(['qrStorageKey', 'qrMimeType']),
)
// unique across ALL organizations: hosteler IDs (CODE-0001) must be globally unique
// because the hosteler login page has no organization field
hostelSchema.index({ code: 1 }, { unique: true })

export type HostelDoc = InferSchemaType<typeof hostelSchema>
export const Hostel = model('Hostel', hostelSchema)

export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/
