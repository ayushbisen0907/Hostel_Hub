import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField } from './_base.js'

/** Staff login accounts (owner, manager, warden, accountant). */
const userSchema = new Schema(
  {
    orgId: orgField,
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'manager', 'warden', 'accountant'] as const, required: true },
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  baseOptions(['passwordHash', 'tokenVersion']),
)

export type UserDoc = InferSchemaType<typeof userSchema>
export const User = model('User', userSchema)
