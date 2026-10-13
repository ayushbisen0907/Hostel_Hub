import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

/**
 * Monthly electricity meter reading for a room (shared meter, split equally
 * among the hostelers in that room) or for a single bed (own meter).
 * The rate is copied from the hostel when the reading is saved.
 */
const splitSchema = new Schema(
  {
    hostelerId: ref('Hosteler'),
    name: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const electricityReadingSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    roomId: ref('Room'),
    /** set only when the hostel meters each bed separately */
    bedId: optionalRef('Bed'),
    units: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 }, // ₹ per unit at the time of reading
    amount: { type: Number, required: true, min: 0 }, // units × rate (rounded)
    splits: { type: [splitSchema], default: [] },
    enteredByName: { type: String, default: '' },
  },
  baseOptions(),
)
electricityReadingSchema.index({ roomId: 1, bedId: 1, month: 1 }, { unique: true })
electricityReadingSchema.index({ orgId: 1, hostelId: 1, month: 1 })
electricityReadingSchema.index({ 'splits.hostelerId': 1, month: 1 })

export type ElectricityReadingDoc = InferSchemaType<typeof electricityReadingSchema>
export const ElectricityReading = model('ElectricityReading', electricityReadingSchema)
