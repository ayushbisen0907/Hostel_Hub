import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

const roomSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    number: { type: String, required: true, trim: true, maxlength: 20 },
    floor: { type: Number, default: 0 },
    type: { type: String, enum: ['ac', 'non-ac'], default: 'non-ac' },
    sharing: { type: Number, required: true, min: 1, max: 20 },
    rentPerBed: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'maintenance'], default: 'active' },
    amenities: { type: [String], default: [] },
  },
  baseOptions(),
)
roomSchema.index({ hostelId: 1, number: 1 }, { unique: true })

export type RoomDoc = InferSchemaType<typeof roomSchema>
export const Room = model('Room', roomSchema)
