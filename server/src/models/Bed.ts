import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

const bedSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    roomId: ref('Room'),
    label: { type: String, required: true }, // A, B, C...
    hostelerId: optionalRef('Hosteler'),
  },
  baseOptions(),
)
bedSchema.index({ roomId: 1, label: 1 }, { unique: true })
// a hosteler can hold at most one bed
bedSchema.index({ hostelerId: 1 }, { unique: true, partialFilterExpression: { hostelerId: { $type: 'objectId' } } })

export type BedDoc = InferSchemaType<typeof bedSchema>
export const Bed = model('Bed', bedSchema)
