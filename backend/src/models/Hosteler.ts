import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

const hostelerSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    // personal
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'male' },
    dob: { type: String, default: '' },
    photoUrl: { type: String, default: null },
    permanentAddress: { type: String, default: '' },
    bloodGroup: { type: String, default: '' },
    // academic / work
    occupation: { type: String, enum: ['student', 'working', 'other'], default: 'student' },
    institution: { type: String, default: '' },
    course: { type: String, default: '' },
    // guardian
    guardianName: { type: String, default: '' },
    guardianRelation: { type: String, default: '' },
    guardianPhone: { type: String, default: '' },
    // id proof
    idProofType: { type: String, default: '' },
    idProofNumber: { type: String, default: '' },
    // stay
    roomId: optionalRef('Room'),
    bedId: optionalRef('Bed'),
    status: { type: String, enum: ['active', 'reserved', 'checked_out'], default: 'active', index: true },
    checkInDate: { type: String, required: true },
    expectedCheckOut: { type: String, default: null },
    checkOutDate: { type: String, default: null },
    monthlyRent: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },
    depositRefunded: { type: Number, default: null },
    /** security deposit to add to the next monthly bill (chosen at check-in or later) */
    depositToBill: { type: Number, default: 0, min: 0 },
    /** first rent cycle to bill (1 = the first month was settled outside the app, e.g. no first bill at check-in) */
    billFromCycle: { type: Number, default: 0, min: 0 },
    messOpted: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    // portal credentials
    loginId: { type: String, required: true, uppercase: true },
    passwordHash: { type: String, required: true },
    mustChangePassword: { type: Boolean, default: true },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
    /** hostel rulesVersion this hosteler last signed (see RulesConsent) */
    consentVersion: { type: Number, default: 0, min: 0 },
  },
  baseOptions(['passwordHash', 'tokenVersion']),
)
hostelerSchema.index({ loginId: 1 }, { unique: true }) // globally unique (see Hostel.code)
hostelerSchema.index({ orgId: 1, hostelId: 1, status: 1 })

export type HostelerDoc = InferSchemaType<typeof hostelerSchema>
export const Hosteler = model('Hosteler', hostelerSchema)
