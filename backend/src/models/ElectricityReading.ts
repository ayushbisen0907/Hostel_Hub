import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

/**
 * Electricity meter reading for a period (fromDate–toDate, inclusive) on a
 * room meter (shared, split among the people who stayed in the room during
 * the period, by the number of days each stayed) or a bed meter.
 * The rate is copied from the hostel when the reading is saved.
 */
const splitSchema = new Schema(
  {
    hostelerId: ref('Hosteler'),
    name: { type: String, default: '' },
    days: { type: Number, default: 0 },
    amount: { type: Number, required: true, min: 0 },
    /** bill the share was added to (null = waiting for the hosteler's next bill) */
    invoiceId: optionalRef('Invoice'),
  },
  { _id: false },
)

const electricityReadingSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    roomId: ref('Room'),
    /** set only when the hostel meters each bed separately */
    bedId: optionalRef('Bed'),
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    month: { type: String, required: true }, // month of toDate (for filtering)
    units: { type: Number, required: true, min: 0 },
    rate: { type: Number, required: true, min: 0 }, // ₹ per unit at the time of reading
    amount: { type: Number, required: true, min: 0 }, // units × rate (rounded)
    totalDays: { type: Number, default: 0 }, // sum of everybody's days in the period
    splits: { type: [splitSchema], default: [] },
    enteredByName: { type: String, default: '' },
  },
  baseOptions(),
)
electricityReadingSchema.index({ roomId: 1, bedId: 1, fromDate: 1 }, { unique: true })
electricityReadingSchema.index({ orgId: 1, hostelId: 1, toDate: -1 })
electricityReadingSchema.index({ 'splits.hostelerId': 1 })

export type ElectricityReadingDoc = InferSchemaType<typeof electricityReadingSchema>
export const ElectricityReading = model('ElectricityReading', electricityReadingSchema)
