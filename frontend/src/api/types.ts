/**
 * Shapes returned by the HostelHub API (backend/src/models + routes).
 * Ids are strings; dates are "YYYY-MM-DD" strings unless named *At / time (ISO).
 * Module-specific response types live next to their API functions in src/api/*.ts.
 */

export type ID = string

export type Plan = 'free' | 'basic' | 'pro'
export type StaffRole = 'owner' | 'manager' | 'warden' | 'accountant'
export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank' | 'online'
export type Meal = 'breakfast' | 'lunch' | 'snacks' | 'dinner'
export type Priority = 'low' | 'medium' | 'high'

/** List endpoints */
export interface ListResponse<T> {
  items: T[]
}
export interface Paginated<T> extends ListResponse<T> {
  page: number
  limit: number
  total: number
  pages: number
}

export interface Settings {
  rentDueDay: number
  lateFeePerDay: number
  receiptPrefix: string
  defaultSecurityDeposit: number
  messMonthlyCharge: number
  nightCurfew: string
  currencySymbol: string
}

export interface Organization {
  id: ID
  name: string
  ownerName: string
  email: string
  phone: string
  plan: Plan
  settings: Settings
  createdAt: string
  updatedAt: string
}

/** GET /org */
export interface OrgDetails extends Organization {
  usage: { hostels: number; beds: number; activeHostelers: number }
  limits: { plan: Plan; name: string; pricePerBed: number; maxBeds: number | null; modules: string[] }
}

export interface User {
  id: ID
  orgId: ID
  name: string
  email: string
  phone: string
  role: StaffRole
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type HostelType = 'boys' | 'girls' | 'coed'

export interface Hostel {
  id: ID
  orgId: ID
  name: string
  type: HostelType
  address: string
  city: string
  phone: string
  code: string
  hostelerSeq: number
  /** where hostelers pay rent */
  upiId: string
  payeeName: string
  /** an uploaded QR image exists (GET /hostels/:id/qr); otherwise draw one from upiId */
  hasQr?: boolean
  charges: HostelCharges
  createdAt: string
  counts?: { rooms: number; beds: number; occupied: number; vacant: number; activeHostelers: number }
}

/** Monthly charge heads of a hostel (0 = not charged). Mess only applies to hostelers who opted in. */
export interface HostelCharges {
  mess: number
  electricity: number
  water: number
  internet: number
  laundry: number
  maintenance: number
  others: { label: string; amount: number }[]
}

export interface Room {
  id: ID
  hostelId: ID
  number: string
  floor: number
  type: 'ac' | 'non-ac'
  sharing: number
  rentPerBed: number
  status: 'active' | 'maintenance'
  amenities: string[]
}

export interface Bed {
  id: ID
  hostelId: ID
  roomId: ID
  label: string
  hostelerId: ID | null
}

export type HostelerStatus = 'active' | 'reserved' | 'checked_out'

export interface Hosteler {
  id: ID
  orgId: ID
  hostelId: ID
  name: string
  phone: string
  email: string
  gender: 'male' | 'female' | 'other'
  dob: string
  photoUrl: string | null
  permanentAddress: string
  bloodGroup: string
  occupation: 'student' | 'working' | 'other'
  institution: string
  course: string
  guardianName: string
  guardianRelation: string
  guardianPhone: string
  idProofType: string
  idProofNumber: string
  roomId: ID | null
  bedId: ID | null
  status: HostelerStatus
  checkInDate: string
  expectedCheckOut: string | null
  checkOutDate: string | null
  monthlyRent: number
  securityDeposit: number
  depositRefunded: number | null
  messOpted: boolean
  notes: string
  loginId: string
  mustChangePassword: boolean
  passwordChangedAt: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export type ChargeKey = 'rent' | 'mess' | 'electricity' | 'water' | 'internet' | 'laundry' | 'maintenance' | 'late_fee' | 'other'

export interface InvoiceItem {
  key?: ChargeKey
  label: string
  amount: number
}

export type PaymentClaimStatus = 'pending' | 'verified' | 'rejected'

/** A hosteler's "I have paid" report, verified by staff (/payment-claims, /portal/payment-claims). */
export interface PaymentClaim {
  id: ID
  hostelId: ID
  hostelerId: ID
  amount: number
  utr: string
  paidOn: string
  note: string
  hasScreenshot: boolean
  status: PaymentClaimStatus
  receivedAmount: number | null
  rejectReason: string
  reviewedByName: string
  reviewedAt: string | null
  paymentIds: ID[]
  createdAt: string
  hosteler?: { id: ID; name: string; loginId: string; phone: string; status: HostelerStatus } | null
}

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'cancelled'

export interface Invoice {
  id: ID
  hostelId: ID
  hostelerId: ID
  number: string
  month: string
  items: InvoiceItem[]
  total: number
  paidAmount: number
  dueDate: string
  cancelled: boolean
  createdAt: string
  /** added by list/detail endpoints */
  balance?: number
  status?: InvoiceStatus
}

export interface Payment {
  id: ID
  hostelId: ID
  hostelerId: ID
  invoiceId: ID | null
  kind: 'rent' | 'deposit' | 'advance'
  receiptNo: string
  amount: number
  mode: PaymentMode
  reference: string
  date: string
  note: string
  recordedBy: 'staff' | 'hosteler'
  createdAt: string
}

export type DocumentType =
  | 'aadhaar'
  | 'pan'
  | 'photo'
  | 'college_id'
  | 'office_id'
  | 'police_verification'
  | 'rent_agreement'
  | 'medical'
  | 'other'

export interface HDocument {
  id: ID
  hostelId: ID
  hostelerId: ID
  type: DocumentType
  fileName: string
  mimeType: string
  size: number
  verified: boolean
  expiryDate: string | null
  uploadedBy: 'staff' | 'hosteler'
  createdAt: string
}

export interface Notice {
  id: ID
  hostelId: ID | null
  title: string
  body: string
  priority: Priority
  pinned: boolean
  createdAt: string
}

export interface ComplaintComment {
  id: ID
  by: string
  byKind: 'staff' | 'hosteler'
  text: string
  at: string
}

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved'
export type ComplaintCategory = 'electrical' | 'plumbing' | 'internet' | 'cleaning' | 'furniture' | 'food' | 'security' | 'other'

export interface Complaint {
  id: ID
  hostelId: ID
  hostelerId: ID | null
  roomId: ID | null
  category: ComplaintCategory
  title: string
  description: string
  priority: Priority
  status: ComplaintStatus
  assignedStaffId: ID | null
  comments: ComplaintComment[]
  resolvedAt: string | null
  createdAt: string
}

export interface LeaveRequest {
  id: ID
  hostelId: ID
  hostelerId: ID
  from: string
  to: string
  reason: string
  destination: string
  status: 'pending' | 'approved' | 'rejected'
  decidedAt: string | null
  createdAt: string
}

export interface Activity {
  id: ID
  hostelId: ID | null
  kind: 'checkin' | 'checkout' | 'payment' | 'complaint' | 'leave' | 'document' | 'room' | 'general'
  message: string
  createdAt: string
}
