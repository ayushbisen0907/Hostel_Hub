import { Schema, model, type InferSchemaType } from 'mongoose'
import { baseOptions, orgField, ref } from './_base.js'

export const DOCUMENT_TYPES = ['aadhaar', 'pan', 'photo', 'college_id', 'office_id', 'police_verification', 'rent_agreement', 'medical', 'other'] as const

const documentSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    /** file name inside UPLOAD_DIR — never sent to clients */
    storageKey: { type: String, required: true },
    verified: { type: Boolean, default: false },
    expiryDate: { type: String, default: null },
    uploadedBy: { type: String, enum: ['staff', 'hosteler'], default: 'staff' },
  },
  baseOptions(['storageKey']),
)

export type DocumentDoc = InferSchemaType<typeof documentSchema>
export const HDocument = model('Document', documentSchema)
