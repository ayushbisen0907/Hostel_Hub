/**
 * Day-to-day collections: gate log, mess, attendance, leave, complaints,
 * visitors, expenses, notices, staff directory, activity feed.
 */
import { Schema, model } from 'mongoose'
import { baseOptions, optionalRef, orgField, ref } from './_base.js'

export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner'] as const
export type Meal = (typeof MEALS)[number]

/* ---------------- gate log ---------------- */
const gateLogSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    time: { type: Date, required: true, default: () => new Date() },
    note: { type: String, default: '' },
  },
  baseOptions(),
)
gateLogSchema.index({ orgId: 1, time: -1 })
export const GateLog = model('GateLog', gateLogSchema)

/* ---------------- mess ---------------- */
const messMenuSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    meal: { type: String, enum: MEALS, required: true },
    items: { type: String, default: '' },
  },
  baseOptions(),
)
messMenuSchema.index({ hostelId: 1, day: 1, meal: 1 }, { unique: true })
export const MessMenu = model('MessMenu', messMenuSchema)

const mealOptOutSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: ref('Hosteler'),
    date: { type: String, required: true },
    meal: { type: String, enum: MEALS, required: true },
  },
  baseOptions(),
)
mealOptOutSchema.index({ hostelerId: 1, date: 1, meal: 1 }, { unique: true })
mealOptOutSchema.index({ orgId: 1, date: 1 })
export const MealOptOut = model('MealOptOut', mealOptOutSchema)

const messFeedbackSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: ref('Hosteler'),
    date: { type: String, required: true },
    meal: { type: String, enum: MEALS, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '', maxlength: 500 },
  },
  baseOptions(),
)
export const MessFeedback = model('MessFeedback', messFeedbackSchema)

/* ---------------- attendance & leave ---------------- */
const attendanceSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: ref('Hosteler'),
    date: { type: String, required: true },
    status: { type: String, enum: ['present', 'absent', 'leave', 'late'], required: true },
  },
  baseOptions(),
)
attendanceSchema.index({ hostelerId: 1, date: 1 }, { unique: true })
attendanceSchema.index({ orgId: 1, date: 1 })
export const Attendance = model('Attendance', attendanceSchema)

const leaveSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: { ...ref('Hosteler'), index: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    destination: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    decidedAt: { type: Date, default: null },
  },
  baseOptions(),
)
export const Leave = model('Leave', leaveSchema)

/* ---------------- complaints ---------------- */
const commentSchema = new Schema(
  {
    by: { type: String, required: true },
    byKind: { type: String, enum: ['staff', 'hosteler'], required: true },
    text: { type: String, required: true, maxlength: 1000 },
    at: { type: Date, default: () => new Date() },
  },
  { _id: true },
)
const complaintSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: optionalRef('Hosteler'),
    roomId: optionalRef('Room'),
    category: {
      type: String,
      enum: ['electrical', 'plumbing', 'internet', 'cleaning', 'furniture', 'food', 'security', 'other'],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
    assignedStaffId: optionalRef('Staff'),
    comments: { type: [commentSchema], default: [] },
    resolvedAt: { type: Date, default: null },
  },
  baseOptions(),
)
complaintSchema.index({ orgId: 1, status: 1 })
export const Complaint = model('Complaint', complaintSchema)

/* ---------------- visitors ---------------- */
const visitorSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    hostelerId: ref('Hosteler'),
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    relation: { type: String, default: '' },
    purpose: { type: String, default: '' },
    idProof: { type: String, default: '' },
    inTime: { type: Date, default: () => new Date() },
    outTime: { type: Date, default: null },
  },
  baseOptions(),
)
visitorSchema.index({ orgId: 1, inTime: -1 })
export const Visitor = model('Visitor', visitorSchema)

/* ---------------- expenses ---------------- */
export const EXPENSE_CATEGORIES = ['electricity', 'water', 'groceries', 'salary', 'maintenance', 'internet', 'rent', 'other'] as const
const expenseSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: { type: Number, required: true, min: 1 },
    date: { type: String, required: true },
    paidTo: { type: String, default: '' },
    mode: { type: String, enum: ['cash', 'upi', 'card', 'bank', 'online'], default: 'cash' },
    note: { type: String, default: '' },
  },
  baseOptions(),
)
expenseSchema.index({ orgId: 1, date: -1 })
export const Expense = model('Expense', expenseSchema)

/* ---------------- notices ---------------- */
const noticeSchema = new Schema(
  {
    orgId: orgField,
    hostelId: optionalRef('Hostel'), // null = all hostels
    title: { type: String, required: true, trim: true, maxlength: 150 },
    body: { type: String, default: '', maxlength: 5000 },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    pinned: { type: Boolean, default: false },
  },
  baseOptions(),
)
export const Notice = model('Notice', noticeSchema)

/* ---------------- staff directory ---------------- */
export const STAFF_ROLES = ['manager', 'warden', 'accountant', 'cook', 'security', 'cleaner'] as const
const staffSchema = new Schema(
  {
    orgId: orgField,
    hostelId: ref('Hostel'),
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    role: { type: String, enum: STAFF_ROLES, required: true },
    salary: { type: Number, default: 0, min: 0 },
    joinDate: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  baseOptions(),
)
export const Staff = model('Staff', staffSchema)

/* ---------------- activity feed ---------------- */
const activitySchema = new Schema(
  {
    orgId: orgField,
    hostelId: optionalRef('Hostel'),
    kind: {
      type: String,
      enum: ['checkin', 'checkout', 'payment', 'complaint', 'leave', 'document', 'room', 'general'],
      default: 'general',
    },
    message: { type: String, required: true },
  },
  baseOptions(),
)
activitySchema.index({ orgId: 1, createdAt: -1 })
export const Activity = model('Activity', activitySchema)
