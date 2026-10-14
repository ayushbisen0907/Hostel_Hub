import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

export const MOVE_OUT_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'completed'] as const
export type MoveOutStatus = (typeof MOVE_OUT_STATUSES)[number]
/** statuses that still count as the hosteler's current request (only one at a time) */
export const ACTIVE_MOVE_OUT: MoveOutStatus[] = ['pending', 'approved']

/** A hosteler's notice to move out, raised from the portal and decided by staff. */
const moveOutRequestSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    moveOutDate: { type: String, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: MOVE_OUT_STATUSES, default: 'pending', index: true },
    /** true while pending / approved — a partial unique index allows one active request per hosteler */
    active: { type: Boolean, default: true },
    /** owner / staff note on approval or rejection */
    response: { type: String, default: '', maxlength: 500 },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
  },
  baseOptions(['active']),
)
moveOutRequestSchema.index({ hostelerId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_move_out' })
moveOutRequestSchema.index({ orgId: 1, status: 1, createdAt: -1 })

export type MoveOutRequestDoc = InferSchemaType<typeof moveOutRequestSchema>
export const MoveOutRequest = model('MoveOutRequest', moveOutRequestSchema)
