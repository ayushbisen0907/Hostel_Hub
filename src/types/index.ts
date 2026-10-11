export type ID = string

export type Plan = 'free' | 'basic' | 'pro'
export type StaffRole = 'manager' | 'warden' | 'accountant' | 'cook' | 'security' | 'cleaner'

export interface Organization {
  id: ID
  name: string
  ownerName: string
  email: string
  phone: string
  password: string
  plan: Plan
  createdAt: string
}

export interface Settings {
  rentDueDay: number // day of month rent is due
  lateFeePerDay: number
  receiptPrefix: string
  defaultSecurityDeposit: number
  messMonthlyCharge: number
  nightCurfew: string // "22:00"
  currencySymbol: string
}

export type HostelType = 'boys' | 'girls' | 'coed'

export interface Hostel {
  id: ID
  name: string
  type: HostelType
  address: string
  city: string
  phone: string
  createdAt: string
}

export type RoomType = 'ac' | 'non-ac'
export type RoomStatus = 'active' | 'maintenance'

export interface Room {
  id: ID
  hostelId: ID
  number: string
  floor: number
  type: RoomType
  sharing: number // number of beds
  rentPerBed: number
  status: RoomStatus
  amenities: string[]
}

export interface Bed {
  id: ID
  roomId: ID
  hostelId: ID
  label: string // A, B, C...
  hostelerId: ID | null
}

export type Gender = 'male' | 'female' | 'other'
export type HostelerStatus = 'active' | 'reserved' | 'checked_out'
export type Occupation = 'student' | 'working' | 'other'

export interface Hosteler {
  id: ID
  hostelId: ID
  name: string
  phone: string
  email: string
  gender: Gender
  dob: string
  photo: string | null // data URL
  permanentAddress: string
  occupation: Occupation
  institution: string // college / company
  course: string // course / designation
  guardianName: string
  guardianRelation: string
  guardianPhone: string
  bloodGroup: string
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
  portalPin: string // hosteler portal login
  notes: string
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
  hostelerId: ID
  type: DocumentType
  fileName: string
  mimeType: string
  size: number
  dataUrl: string
  verified: boolean
  expiryDate: string | null
  uploadedAt: string
}

export interface InvoiceItem {
  label: string
  amount: number
}

export interface Invoice {
  id: ID
  number: string
  hostelerId: ID
  hostelId: ID
  month: string // YYYY-MM
  items: InvoiceItem[]
  total: number
  dueDate: string // YYYY-MM-DD
  createdAt: string
  cancelled: boolean
}

export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank' | 'online'

export interface Payment {
  id: ID
  receiptNo: string
  invoiceId: ID | null
  hostelerId: ID
  hostelId: ID
  amount: number
  mode: PaymentMode
  reference: string
  date: string // YYYY-MM-DD
  note: string
  createdAt: string
}

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'cancelled'

export interface GateLog {
  id: ID
  hostelerId: ID
  hostelId: ID
  direction: 'in' | 'out'
  time: string // ISO
  note: string
}

export type Meal = 'breakfast' | 'lunch' | 'snacks' | 'dinner'

export interface MessMenuEntry {
  hostelId: ID
  day: number // 0 = Sunday
  meal: Meal
  items: string
}

export interface MealOptOut {
  id: ID
  hostelerId: ID
  hostelId: ID
  date: string // YYYY-MM-DD
  meal: Meal
  createdAt: string
}

export interface MessFeedback {
  id: ID
  hostelerId: ID
  hostelId: ID
  date: string
  meal: Meal
  rating: number // 1..5
  comment: string
  createdAt: string
}

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'late'

export interface AttendanceRecord {
  id: ID
  hostelerId: ID
  hostelId: ID
  date: string // YYYY-MM-DD
  status: AttendanceStatus
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: ID
  hostelerId: ID
  hostelId: ID
  from: string
  to: string
  reason: string
  destination: string
  status: LeaveStatus
  createdAt: string
  decidedAt: string | null
}

export type ComplaintCategory = 'electrical' | 'plumbing' | 'internet' | 'cleaning' | 'furniture' | 'food' | 'security' | 'other'
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved'
export type Priority = 'low' | 'medium' | 'high'

export interface ComplaintComment {
  id: ID
  by: string
  text: string
  at: string
}

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
  createdAt: string
  resolvedAt: string | null
}

export interface Visitor {
  id: ID
  hostelId: ID
  hostelerId: ID
  name: string
  phone: string
  relation: string
  purpose: string
  idProof: string
  inTime: string
  outTime: string | null
}

export type ExpenseCategory = 'electricity' | 'water' | 'groceries' | 'salary' | 'maintenance' | 'internet' | 'rent' | 'other'

export interface Expense {
  id: ID
  hostelId: ID
  category: ExpenseCategory
  amount: number
  date: string
  paidTo: string
  mode: PaymentMode
  note: string
  createdAt: string
}

export interface Notice {
  id: ID
  hostelId: ID | null // null = all hostels
  title: string
  body: string
  priority: Priority
  pinned: boolean
  createdAt: string
}

export interface Staff {
  id: ID
  hostelId: ID
  name: string
  phone: string
  role: StaffRole
  salary: number
  joinDate: string
  active: boolean
}

export interface Activity {
  id: ID
  message: string
  kind: 'checkin' | 'checkout' | 'payment' | 'complaint' | 'leave' | 'document' | 'room' | 'general'
  at: string
}

export interface Session {
  kind: 'admin' | 'hosteler'
  hostelerId?: ID
}
