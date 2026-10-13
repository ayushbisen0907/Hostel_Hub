/**
 * Fills the database with a demo organization.
 *
 *   npm run seed            -> creates the demo org (refuses if it already exists)
 *   npm run seed -- --reset -> deletes the demo org's data first, then recreates it
 *
 * Logins created:
 *   Owner     demo@hostelhub.in / Demo@1234
 *   Hosteler  SBH-0001 / Hostel@123          (already activated)
 *   Hosteler  SBH-0002 / Welcome8            (temporary password -> first-login flow)
 */
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { connectDB, disconnectDB } from '../config/db.js'
import { formatLoginId, generateTempPassword, hashPassword } from '../lib/auth.js'
import { createInvoice, recordPayment } from '../lib/money.js'
import { Organization } from '../models/Organization.js'
import { User } from '../models/User.js'
import { Hostel } from '../models/Hostel.js'
import { Room } from '../models/Room.js'
import { Bed } from '../models/Bed.js'
import { Hosteler } from '../models/Hosteler.js'
import { Invoice } from '../models/Invoice.js'
import { Payment } from '../models/Payment.js'
import { HDocument } from '../models/Document.js'
import {
  Activity,
  Attendance,
  Complaint,
  Expense,
  GateLog,
  Leave,
  MealOptOut,
  MessFeedback,
  MessMenu,
  Notice,
  Staff,
  Visitor,
  MEALS,
} from '../models/Operations.js'

const DEMO_EMAIL = 'demo@hostelhub.in'

const BOYS = ['Aarav Sharma', 'Vivaan Patel', 'Aditya Verma', 'Arjun Singh', 'Rohan Gupta', 'Karan Mehta', 'Ishaan Joshi', 'Rahul Yadav', 'Siddharth Jain', 'Ayush Tiwari', 'Pranav Mishra', 'Harsh Chouhan']
const GIRLS = ['Ananya Sharma', 'Diya Patel', 'Priya Verma', 'Sneha Singh', 'Kavya Gupta', 'Riya Mehta', 'Aditi Joshi', 'Pooja Yadav']
const COLLEGES = ['IIT Indore', 'SGSITS', 'DAVV University', 'Medicaps University', 'Prestige Institute']
const MENU: Record<(typeof MEALS)[number], string[]> = {
  breakfast: ['Poha, Jalebi, Tea', 'Aloo Paratha, Curd', 'Idli Sambar', 'Upma, Banana', 'Bread Omelette', 'Chole Bhature', 'Sabudana Khichdi'],
  lunch: ['Dal, Rice, Aloo Gobhi, Roti', 'Rajma Chawal, Raita', 'Kadhi Pakoda, Rice', 'Dal Makhani, Jeera Rice', 'Chole, Rice, Roti', 'Sambar Rice, Papad', 'Veg Pulao, Dal Fry'],
  snacks: ['Samosa, Tea', 'Bhel Puri', 'Biscuits, Tea', 'Pakode, Tea', 'Sandwich', 'Maggi', 'Kachori, Tea'],
  dinner: ['Paneer Butter Masala, Roti', 'Aloo Matar, Kheer', 'Mix Veg, Dal Tadka', 'Egg Curry / Paneer Bhurji', 'Dal Baati Churma', 'Veg Biryani, Raita', 'Sev Tamatar, Roti'],
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
const monthOf = (d: Date) => ymd(d).slice(0, 7)
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]!

async function wipeDemo() {
  const org = await Organization.findOne({ email: DEMO_EMAIL })
  if (!org) return
  const orgId = org._id
  await Promise.all(
    [User, Hostel, Room, Bed, Hosteler, Invoice, Payment, HDocument, GateLog, MessMenu, MealOptOut, MessFeedback, Attendance, Leave, Complaint, Visitor, Expense, Notice, Staff, Activity].map(
      (M) => (M as unknown as mongoose.Model<unknown>).deleteMany({ orgId }),
    ),
  )
  await Organization.deleteOne({ _id: orgId })
  console.log('🧹 Removed existing demo organization')
}

async function main() {
  await connectDB(env.MONGODB_URI)
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))

  if (process.argv.includes('--reset')) await wipeDemo()
  if (await Organization.exists({ email: DEMO_EMAIL })) {
    console.log('ℹ️  Demo organization already exists. Run `npm run seed -- --reset` to recreate it.')
    return
  }

  const org = await Organization.create({ name: 'Sunrise Hostels Pvt Ltd', ownerName: 'Rajesh Malhotra', email: DEMO_EMAIL, phone: '9826000000', plan: 'pro' })
  const orgId = org._id
  await User.create({ orgId, name: 'Rajesh Malhotra', email: DEMO_EMAIL, phone: '9826000000', passwordHash: await hashPassword('Demo@1234'), role: 'owner' })

  // hostel codes are globally unique; fall back if SBH/LGH are taken by another org
  const code = async (want: string) => ((await Hostel.exists({ code: want })) ? `${want}${Math.floor(Math.random() * 90 + 10)}` : want)
  const sunrise = await Hostel.create({ orgId, name: 'Sunrise Boys Hostel', type: 'boys', address: '12, Vijay Nagar', city: 'Indore', phone: '9826012345', code: await code('SBH') })
  const lotus = await Hostel.create({ orgId, name: 'Lotus Girls Hostel', type: 'girls', address: '45, Palasia Square', city: 'Indore', phone: '9826054321', code: await code('LGH') })

  // rooms + beds
  for (const [hostel, floors] of [[sunrise, 2], [lotus, 1]] as const) {
    for (let f = 1; f <= floors; f++) {
      for (let n = 1; n <= 5; n++) {
        const sharing = n <= 2 ? 2 : 3
        const ac = n % 2 === 1
        const room = await Room.create({
          orgId, hostelId: hostel._id, number: `${f}0${n}`, floor: f, sharing, type: ac ? 'ac' : 'non-ac',
          rentPerBed: (ac ? 7500 : 5500) - (sharing - 1) * 700,
          amenities: ac ? ['AC', 'Attached Washroom', 'Wi-Fi'] : ['Fan', 'Wi-Fi'],
        })
        await Bed.insertMany(Array.from({ length: sharing }, (_, i) => ({ orgId, hostelId: hostel._id, roomId: room._id, label: String.fromCharCode(65 + i) })))
      }
    }
  }

  // hostelers
  const credentials: string[] = []
  const admit = async (hostel: typeof sunrise, name: string, i: number, gender: 'male' | 'female') => {
    const bed = await Bed.findOne({ hostelId: hostel._id, hostelerId: null }).sort({ label: 1 })
    if (!bed) return null
    const room = await Room.findById(bed.roomId)
    const h0 = await Hostel.findByIdAndUpdate(hostel._id, { $inc: { hostelerSeq: 1 } }, { new: true })
    const loginId = formatLoginId(h0!.code, h0!.hostelerSeq)
    let password = generateTempPassword()
    let mustChange = i % 3 === 0
    if (h0!.code === sunrise.code && h0!.hostelerSeq === 1) [password, mustChange] = ['Hostel@123', false]
    if (h0!.code === sunrise.code && h0!.hostelerSeq === 2) [password, mustChange] = ['Welcome8', true]
    const checkIn = daysAgo(40 + i * 9)
    const h = await Hosteler.create({
      orgId, hostelId: hostel._id, name, phone: `98${String(10000000 + i * 7919).slice(0, 8)}`, gender,
      email: `${name.split(' ')[0]!.toLowerCase()}@gmail.com`, occupation: 'student', institution: pick(COLLEGES, i), course: 'B.Tech',
      guardianName: `Mr. ${name.split(' ')[1]}`, guardianRelation: 'Father', guardianPhone: `97${String(20000000 + i * 104729).slice(0, 8)}`,
      idProofType: 'Aadhaar', roomId: bed.roomId, bedId: bed._id, status: 'active', checkInDate: ymd(checkIn),
      monthlyRent: room!.rentPerBed, securityDeposit: 5000, messOpted: i % 4 !== 0,
      loginId, passwordHash: await hashPassword(password), mustChangePassword: mustChange,
      passwordChangedAt: mustChange ? null : checkIn,
    })
    await Bed.updateOne({ _id: bed._id }, { hostelerId: h._id })
    if (mustChange || h0!.hostelerSeq <= 2) credentials.push(`${loginId.padEnd(10)} ${password.padEnd(12)} ${mustChange ? '(temporary — first login)' : ''}`)
    await recordPayment(orgId, { hostelerId: h._id, amount: 5000, mode: 'upi', date: ymd(checkIn), kind: 'deposit' })
    return h
  }
  const residents = []
  for (const [i, n] of BOYS.entries()) residents.push(await admit(sunrise, n, i, 'male'))
  for (const [i, n] of GIRLS.entries()) residents.push(await admit(lotus, n, i + 20, 'female'))
  const active = residents.filter(Boolean) as NonNullable<(typeof residents)[number]>[]

  // invoices for last month + this month, most paid
  const months = [monthOf(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)), monthOf(new Date())]
  for (const [mi, month] of months.entries()) {
    for (const [i, h] of active.entries()) {
      const items = [{ label: `Room rent – ${month}`, amount: h.monthlyRent }]
      if (h.messOpted) items.push({ label: 'Mess charges', amount: 3000 })
      const inv = await createInvoice(orgId, { hostelerId: h._id, month, items, dueDate: `${month}-05` })
      const paid = mi === 0 ? i % 7 !== 0 : i % 2 === 0
      if (paid) await recordPayment(orgId, { hostelerId: h._id, invoiceId: inv._id, amount: inv.total, mode: i % 3 ? 'upi' : 'cash', date: `${month}-0${(i % 5) + 1}` })
    }
  }

  // mess menu
  for (const hostel of [sunrise, lotus])
    for (let day = 0; day < 7; day++)
      for (const meal of MEALS) await MessMenu.create({ orgId, hostelId: hostel._id, day, meal, items: MENU[meal][day]! })

  // attendance last 5 days, a few leaves/complaints/visitors/notices/staff/expenses
  for (let k = 1; k <= 5; k++) {
    await Attendance.insertMany(active.map((h, i) => ({ orgId, hostelId: h.hostelId, hostelerId: h._id, date: ymd(daysAgo(k)), status: (i + k) % 11 === 0 ? 'absent' : 'present' })))
  }
  await Leave.create({ orgId, hostelId: active[3]!.hostelId, hostelerId: active[3]!._id, from: ymd(daysAgo(-2)), to: ymd(daysAgo(-5)), reason: 'Going home for festival', destination: 'Bhopal' })
  await Complaint.create([
    { orgId, hostelId: sunrise._id, hostelerId: active[0]!._id, roomId: active[0]!.roomId, category: 'electrical', title: 'Fan not working', description: 'Ceiling fan stopped working.', priority: 'high' },
    { orgId, hostelId: sunrise._id, hostelerId: active[4]!._id, roomId: active[4]!.roomId, category: 'internet', title: 'Wi-Fi slow on 2nd floor', priority: 'medium', status: 'in_progress' },
  ])
  await Visitor.create({ orgId, hostelId: active[1]!.hostelId, hostelerId: active[1]!._id, name: active[1]!.guardianName, phone: active[1]!.guardianPhone, relation: 'Father', purpose: 'Meeting' })
  await Notice.create([
    { orgId, hostelId: null, title: 'Rent due by 5th of every month', body: 'Pay from the hosteler portal to avoid late fees.', priority: 'high', pinned: true },
    { orgId, hostelId: sunrise._id, title: 'Water supply off on Sunday', body: 'Tank cleaning 10 AM – 2 PM.', priority: 'medium' },
  ])
  await Staff.create([
    { orgId, hostelId: sunrise._id, name: 'Ramesh Patel', phone: '9893011111', role: 'warden', salary: 18000, joinDate: ymd(daysAgo(380)) },
    { orgId, hostelId: sunrise._id, name: 'Shankar Lal', phone: '9893022222', role: 'cook', salary: 15000, joinDate: ymd(daysAgo(350)) },
    { orgId, hostelId: lotus._id, name: 'Sunita Verma', phone: '9893055555', role: 'warden', salary: 18000, joinDate: ymd(daysAgo(290)) },
  ])
  for (const month of months)
    for (const [hostel, base] of [[sunrise, 30000], [lotus, 20000]] as const)
      await Expense.insertMany([
        { orgId, hostelId: hostel._id, category: 'electricity', amount: base, date: `${month}-03`, paidTo: 'MPEB', mode: 'bank' },
        { orgId, hostelId: hostel._id, category: 'groceries', amount: base * 2.5, date: `${month}-04`, paidTo: 'Shree Kirana Store', mode: 'upi' },
      ])

  console.log('\n✅ Demo data created\n')
  console.log('Owner login     demo@hostelhub.in / Demo@1234')
  console.log('\nHosteler logins (Hosteler ID / password):')
  for (const c of credentials) console.log('  ' + c)
  console.log('')
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exitCode = 1
  })
  .finally(() => disconnectDB())
