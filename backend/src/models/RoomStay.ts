import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

/**
 * Who stayed in which room/bed and when (from/to inclusive, to = null while
 * still there). Written at check-in, bed transfer and check-out; used to
 * share a room's electricity by the days each person actually stayed.
 */
const roomStaySchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    roomId: ref('Room'),
    bedId: ref('Bed'),
    from: { type: String, required: true },
    to: { type: String, default: null },
  },
  baseOptions(),
)
roomStaySchema.index({ roomId: 1, from: 1 })
roomStaySchema.index({ bedId: 1, from: 1 })

export type RoomStayDoc = InferSchemaType<typeof roomStaySchema>
export const RoomStay = model('RoomStay', roomStaySchema)
