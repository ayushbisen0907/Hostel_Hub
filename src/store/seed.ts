import { addDays, addMonths, format, subDays } from 'date-fns'
import type {
  AttendanceRecord,
  Bed,
  Complaint,
  Expense,
  GateLog,
  Hostel,
  Hosteler,
  Invoice,
  LeaveRequest,
  Meal,
  MessMenuEntry,
  Notice,
  Payment,
  Room,
  Staff,
  Visitor,
  MessFeedback,
  MealOptOut,
  HDocument,
  Activity,
} from '@/types'
import type { DB } from './index'
import { defaultSettings } from './index'

// Small deterministic PRNG so the demo looks the same each time
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const BOY_NAMES = [
  'Aarav Sharma', 'Vivaan Patel', 'Aditya Verma', 'Arjun Singh', 'Rohan Gupta', 'Karan Mehta', 'Ishaan Joshi',
  'Rahul Yadav', 'Siddharth Jain', 'Ayush Tiwari', 'Pranav Mishra', 'Harsh Chouhan', 'Dev Malviya', 'Yash Agrawal',
  'Kunal Rathore', 'Nikhil Dubey', 'Saurabh Pandey', 'Ankit Soni', 'Varun Thakur', 'Manish Kushwaha', 'Abhishek Raj',
  'Tushar Bansal', 'Shubham Patidar', 'Gaurav Saxena', 'Mohit Choudhary', 'Akash Rawat', 'Deepak Meena', 'Ritik Goyal',
  'Aman Parmar', 'Lakshya Dixit', 'Om Prakash', 'Sahil Khan', 'Vikas Bhati', 'Prateek Vyas', 'Rajat Sen',
]
const GIRL_NAMES = [
  'Ananya Sharma', 'Diya Patel', 'Priya Verma', 'Sneha Singh', 'Kavya Gupta', 'Riya Mehta', 'Aditi Joshi',
  'Pooja Yadav', 'Neha Jain', 'Shreya Tiwari', 'Isha Mishra', 'Tanvi Chouhan', 'Muskan Malviya', 'Nidhi Agrawal',
  'Sakshi Rathore', 'Khushi Dubey', 'Anjali Pandey', 'Megha Soni', 'Simran Kaur', 'Ritu Thakur', 'Palak Bansal',
  'Vaishnavi Patidar', 'Shruti Saxena', 'Nandini Choudhary', 'Aishwarya Rawat',
]
const COLLEGES = ['IIT Indore', 'IIM Indore', 'SGSITS', 'DAVV University', 'Medicaps University', 'Acropolis Institute', 'Prestige Institute', 'IPS Academy']
const COMPANIES = ['TCS', 'Infosys', 'Impetus', 'Yash Technologies', 'Clarion', 'Deloitte']
const COURSES = ['B.Tech CSE', 'B.Tech ECE', 'MBA', 'BBA', 'B.Com', 'MCA', 'B.Sc', 'M.Tech']
const CITIES = ['Bhopal', 'Ujjain', 'Jabalpur', 'Gwalior', 'Ratlam', 'Sagar', 'Dewas', 'Khandwa', 'Satna', 'Rewa']

const MENU: Record<Meal, string[]> = {
  breakfast: ['Poha, Jalebi, Tea', 'Aloo Paratha, Curd, Tea', 'Idli Sambar, Coffee', 'Upma, Banana, Tea', 'Bread Omelette / Butter Toast, Tea', 'Chole Bhature, Tea', 'Sabudana Khichdi, Tea'],
  lunch: ['Dal, Rice, Aloo Gobhi, Roti, Salad', 'Rajma Chawal, Roti, Raita', 'Kadhi Pakoda, Rice, Bhindi, Roti', 'Dal Makhani, Jeera Rice, Mix Veg, Roti', 'Chole, Rice, Roti, Salad', 'Sambar Rice, Cabbage, Roti, Papad', 'Veg Pulao, Dal Fry, Roti, Raita'],
  snacks: ['Samosa, Tea', 'Bhel Puri, Tea', 'Biscuits, Tea', 'Pakode, Tea', 'Sandwich, Tea', 'Maggi, Tea', 'Kachori, Tea'],
  dinner: ['Paneer Butter Masala, Roti, Rice, Dal', 'Aloo Matar, Roti, Rice, Kheer', 'Mix Veg, Dal Tadka, Rice, Roti', 'Egg Curry / Paneer Bhurji, Roti, Rice', 'Dal Baati, Churma', 'Veg Biryani, Raita, Salad', 'Sev Tamatar, Roti, Rice, Dal'],
}

export function buildDemoData(): DB {
  const r = rng(42)
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)]!
  const int = (min: number, max: number) => Math.floor(r() * (max - min + 1)) + min
  const id = (p: string) => `${p}${Math.floor(r() * 1e12).toString(36)}`
  const now = new Date()
  const d = (date: Date) => format(date, 'yyyy-MM-dd')
  const iso = (date: Date) => date.toISOString()

  const hostels: Hostel[] = [
    { id: 'hst_sunrise', name: 'Sunrise Boys Hostel', type: 'boys', address: '12, Vijay Nagar, Scheme 54', city: 'Indore', phone: '9826012345', createdAt: iso(subDays(now, 400)) },
    { id: 'hst_lotus', name: 'Lotus Girls Hostel', type: 'girls', address: '45, Palasia Square', city: 'Indore', phone: '9826054321', createdAt: iso(subDays(now, 300)) },
  ]

  const rooms: Room[] = []
  const beds: Bed[] = []
  const addRoom = (hostelId: string, number: string, floor: number, sharing: number, ac: boolean) => {
    const room: Room = {
      id: id('rm_'),
      hostelId,
      number,
      floor,
      type: ac ? 'ac' : 'non-ac',
      sharing,
      rentPerBed: (ac ? 7500 : 5500) - (sharing - 1) * 700,
      status: 'active',
      amenities: ac ? ['AC', 'Attached Washroom', 'Wi-Fi', 'Study Table', 'Cupboard'] : ['Fan', 'Wi-Fi', 'Study Table', 'Cupboard'],
    }
    rooms.push(room)
    for (let i = 0; i < sharing; i++) beds.push({ id: id('bed_'), roomId: room.id, hostelId, label: String.fromCharCode(65 + i), hostelerId: null })
  }
  for (let f = 1; f <= 3; f++) for (let n = 1; n <= 6; n++) addRoom('hst_sunrise', `${f}0${n}`, f, n <= 2 ? 2 : n <= 4 ? 3 : 4, n % 2 === 1)
  for (let f = 1; f <= 2; f++) for (let n = 1; n <= 6; n++) addRoom('hst_lotus', `${f}0${n}`, f, n <= 3 ? 2 : 3, n % 3 !== 0)
  // one room under maintenance
  rooms[5]!.status = 'maintenance'

  const hostelers: Hosteler[] = []
  const fill = (hostelId: string, names: string[], gender: 'male' | 'female', fillRate: number) => {
    const hostelBeds = beds.filter((b) => b.hostelId === hostelId)
    let ni = 0
    for (const bed of hostelBeds) {
      const room = rooms.find((x) => x.id === bed.roomId)!
      if (room.status !== 'active' || r() > fillRate || ni >= names.length) continue
      const name = names[ni++]!
      const student = r() > 0.2
      const checkIn = subDays(now, int(15, 330))
      const h: Hosteler = {
        id: id('hos_'),
        hostelId,
        name,
        phone: `9${int(100000000, 999999999)}`,
        email: `${name.split(' ')[0]!.toLowerCase()}.${name.split(' ')[1]!.toLowerCase()}@gmail.com`,
        gender,
        dob: d(subDays(now, int(18 * 365, 26 * 365))),
        photo: null,
        permanentAddress: `${int(1, 200)}, Main Road, ${pick(CITIES)}, MP`,
        occupation: student ? 'student' : 'working',
        institution: student ? pick(COLLEGES) : pick(COMPANIES),
        course: student ? pick(COURSES) : 'Software Engineer',
        guardianName: `${pick(['Ramesh', 'Suresh', 'Mahesh', 'Rajesh', 'Dinesh', 'Mukesh'])} ${name.split(' ')[1]}`,
        guardianRelation: 'Father',
        guardianPhone: `9${int(100000000, 999999999)}`,
        bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'B-']),
        idProofType: 'Aadhaar',
        idProofNumber: `${int(1000, 9999)} ${int(1000, 9999)} ${int(1000, 9999)}`,
        roomId: room.id,
        bedId: bed.id,
        status: 'active',
        checkInDate: d(checkIn),
        expectedCheckOut: student ? d(addMonths(checkIn, 11)) : null,
        checkOutDate: null,
        monthlyRent: room.rentPerBed,
        securityDeposit: defaultSettings.defaultSecurityDeposit,
        depositRefunded: null,
        messOpted: r() > 0.25,
        portalPin: '1234',
        notes: '',
        createdAt: iso(checkIn),
      }
      bed.hostelerId = h.id
      hostelers.push(h)
    }
  }
  fill('hst_sunrise', BOY_NAMES, 'male', 0.85)
  fill('hst_lotus', GIRL_NAMES, 'female', 0.8)

  // A known demo hosteler for portal login
  if (hostelers[0]) hostelers[0].phone = '9876543210'

  // reserved hosteler (bed held)
  const freeBed = beds.find((b) => !b.hostelerId && b.hostelId === 'hst_sunrise' && rooms.find((x) => x.id === b.roomId)?.status === 'active')
  if (freeBed) {
    const room = rooms.find((x) => x.id === freeBed.roomId)!
    const h: Hosteler = {
      ...hostelers[1]!,
      id: id('hos_'),
      name: 'Parth Khandelwal',
      phone: '9111222333',
      email: 'parth.k@gmail.com',
      roomId: room.id,
      bedId: freeBed.id,
      status: 'reserved',
      checkInDate: d(addDays(now, 3)),
      monthlyRent: room.rentPerBed,
      createdAt: iso(subDays(now, 2)),
    }
    freeBed.hostelerId = h.id
    hostelers.push(h)
  }

  // two checked-out hostelers
  for (const name of ['Ravi Kishan', 'Sumit Arora']) {
    hostelers.push({
      ...hostelers[2]!,
      id: id('hos_'),
      name,
      phone: `9${int(100000000, 999999999)}`,
      roomId: null,
      bedId: null,
      status: 'checked_out',
      checkInDate: d(subDays(now, 300)),
      checkOutDate: d(subDays(now, int(10, 40))),
      depositRefunded: 4000,
      notes: 'Checkout: ₹1000 deducted for broken cupboard lock',
    })
  }

  // Invoices + payments for last 3 months (incl. current)
  const invoices: Invoice[] = []
  const payments: Payment[] = []
  let invoiceSeq = 1000
  let receiptSeq = 5000
  const months = [2, 1, 0].map((k) => format(addMonths(now, -k), 'yyyy-MM'))
  const active = hostelers.filter((h) => h.status === 'active')

  for (const h of active) {
    payments.push({
      id: id('pay_'), receiptNo: `RCPT-${++receiptSeq}`, invoiceId: null, hostelerId: h.id, hostelId: h.hostelId,
      amount: h.securityDeposit, mode: pick(['upi', 'cash', 'bank']), reference: '', date: h.checkInDate, note: 'Security deposit', createdAt: `${h.checkInDate}T10:00:00.000Z`,
    })
  }

  for (const month of months) {
    const isCurrent = month === months[2]
    for (const h of active) {
      if (h.checkInDate.slice(0, 7) > month) continue
      const items = [{ label: `Room rent – ${month}`, amount: h.monthlyRent }]
      if (h.messOpted) items.push({ label: 'Mess charges', amount: defaultSettings.messMonthlyCharge })
      const inv: Invoice = {
        id: id('inv_'), number: `INV-${++invoiceSeq}`, hostelerId: h.id, hostelId: h.hostelId, month, items,
        total: items.reduce((a, i) => a + i.amount, 0), dueDate: `${month}-05`, createdAt: `${month}-01T09:00:00.000Z`, cancelled: false,
      }
      invoices.push(inv)
      const roll = r()
      const paidAll = isCurrent ? roll < 0.55 : roll < 0.9
      const partial = !paidAll && roll < (isCurrent ? 0.7 : 0.97)
      if (paidAll || partial) {
        const day = Math.min(int(1, 12), 28)
        const date = `${month}-${String(day).padStart(2, '0')}`
        if (date <= d(now))
          payments.push({
            id: id('pay_'), receiptNo: `RCPT-${++receiptSeq}`, invoiceId: inv.id, hostelerId: h.id, hostelId: h.hostelId,
            amount: paidAll ? inv.total : Math.round(inv.total / 2), mode: pick(['upi', 'upi', 'cash', 'bank', 'online']),
            reference: r() > 0.5 ? `UPI${int(100000, 999999)}` : '', date, note: '', createdAt: `${date}T12:00:00.000Z`,
          })
      }
    }
  }

  // Mess menu
  const messMenu: MessMenuEntry[] = []
  for (const hs of hostels)
    for (let day = 0; day < 7; day++)
      for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner'] as Meal[])
        messMenu.push({ hostelId: hs.id, day, meal, items: MENU[meal][(day + (hs.id === 'hst_lotus' ? 2 : 0)) % 7]! })

  const mealOptOuts: MealOptOut[] = []
  const tomorrow = d(addDays(now, 1))
  const todayKey = d(now)
  for (const h of active.filter((x) => x.messOpted)) {
    if (r() < 0.12) mealOptOuts.push({ id: id('opt_'), hostelerId: h.id, hostelId: h.hostelId, date: todayKey, meal: 'dinner', createdAt: iso(now) })
    if (r() < 0.1) mealOptOuts.push({ id: id('opt_'), hostelerId: h.id, hostelId: h.hostelId, date: tomorrow, meal: 'lunch', createdAt: iso(now) })
  }

  const messFeedback: MessFeedback[] = active.slice(0, 12).map((h, i) => ({
    id: id('fb_'), hostelerId: h.id, hostelId: h.hostelId, date: d(subDays(now, i % 5)), meal: pick(['lunch', 'dinner', 'breakfast']),
    rating: int(2, 5), comment: pick(['Good taste', 'Too oily', 'Roti was cold', 'Loved the paneer!', 'Need more variety', 'Excellent', '']),
    createdAt: iso(subDays(now, i % 5)),
  }))

  // Attendance last 7 days
  const attendance: AttendanceRecord[] = []
  for (let k = 1; k <= 7; k++) {
    const date = d(subDays(now, k))
    for (const h of active) {
      if (h.checkInDate > date) continue
      const roll = r()
      attendance.push({ id: id('att_'), hostelerId: h.id, hostelId: h.hostelId, date, status: roll < 0.88 ? 'present' : roll < 0.94 ? 'late' : roll < 0.97 ? 'leave' : 'absent' })
    }
  }

  const leaves: LeaveRequest[] = [
    { hostelerId: active[3]?.id, from: d(addDays(now, 2)), to: d(addDays(now, 5)), reason: 'Going home for festival', destination: 'Bhopal', status: 'pending' as const },
    { hostelerId: active[7]?.id, from: d(addDays(now, 1)), to: d(addDays(now, 2)), reason: 'Sister wedding', destination: 'Ujjain', status: 'pending' as const },
    { hostelerId: active[10]?.id, from: d(subDays(now, 1)), to: d(addDays(now, 1)), reason: 'Medical checkup', destination: 'Jabalpur', status: 'approved' as const },
    { hostelerId: active[25]?.id, from: d(subDays(now, 10)), to: d(subDays(now, 8)), reason: 'Family function', destination: 'Gwalior', status: 'approved' as const },
    { hostelerId: active[30]?.id, from: d(subDays(now, 5)), to: d(subDays(now, 3)), reason: 'Trip with friends', destination: 'Goa', status: 'rejected' as const },
  ]
    .filter((l) => l.hostelerId)
    .map((l) => ({
      ...l, hostelerId: l.hostelerId!, id: id('lv_'), hostelId: active.find((h) => h.id === l.hostelerId)!.hostelId,
      createdAt: iso(subDays(now, 2)), decidedAt: l.status === 'pending' ? null : iso(subDays(now, 1)),
    }))

  const staff: Staff[] = [
    { id: 'stf_1', hostelId: 'hst_sunrise', name: 'Ramesh Patel', phone: '9893011111', role: 'warden', salary: 18000, joinDate: d(subDays(now, 380)), active: true },
    { id: 'stf_2', hostelId: 'hst_sunrise', name: 'Shankar Lal', phone: '9893022222', role: 'cook', salary: 15000, joinDate: d(subDays(now, 350)), active: true },
    { id: 'stf_3', hostelId: 'hst_sunrise', name: 'Bablu Electrician', phone: '9893033333', role: 'cleaner', salary: 9000, joinDate: d(subDays(now, 200)), active: true },
    { id: 'stf_4', hostelId: 'hst_sunrise', name: 'Vijay Singh', phone: '9893044444', role: 'security', salary: 12000, joinDate: d(subDays(now, 300)), active: true },
    { id: 'stf_5', hostelId: 'hst_lotus', name: 'Sunita Verma', phone: '9893055555', role: 'warden', salary: 18000, joinDate: d(subDays(now, 290)), active: true },
    { id: 'stf_6', hostelId: 'hst_lotus', name: 'Kamla Bai', phone: '9893066666', role: 'cook', salary: 14000, joinDate: d(subDays(now, 280)), active: true },
    { id: 'stf_7', hostelId: 'hst_lotus', name: 'Anil Sharma', phone: '9893077777', role: 'accountant', salary: 20000, joinDate: d(subDays(now, 150)), active: true },
  ]

  const complaintSeeds: [Complaint['category'], string, string, Complaint['priority'], Complaint['status']][] = [
    ['electrical', 'Fan not working', 'Ceiling fan stopped working since yesterday night.', 'high', 'open'],
    ['plumbing', 'Water leakage in washroom', 'Tap is leaking continuously.', 'medium', 'in_progress'],
    ['internet', 'Wi-Fi very slow on 2nd floor', 'Unable to attend online classes.', 'high', 'open'],
    ['cleaning', 'Room not cleaned', 'Room has not been cleaned for 3 days.', 'low', 'resolved'],
    ['food', 'Food quality issue', 'Dal was too salty at dinner.', 'medium', 'resolved'],
    ['furniture', 'Broken chair', 'Study chair leg is broken.', 'low', 'open'],
  ]
  const complaints: Complaint[] = complaintSeeds.map(([category, title, description, priority, status], i) => {
    const h = active[i * 5]!
    const created = subDays(now, i + 1)
    return {
      id: id('cmp_'), hostelId: h.hostelId, hostelerId: h.id, roomId: h.roomId, category, title, description, priority, status,
      assignedStaffId: status === 'open' ? null : h.hostelId === 'hst_sunrise' ? 'stf_3' : 'stf_5',
      comments: status === 'open' ? [] : [{ id: id('cc_'), by: 'Warden', text: 'Technician has been informed.', at: iso(addDays(created, 0)) }],
      createdAt: iso(created), resolvedAt: status === 'resolved' ? iso(addDays(created, 1)) : null,
    }
  })

  const visitors: Visitor[] = active.slice(0, 6).map((h, i) => {
    const inT = subDays(now, i)
    inT.setHours(11 + i, 15)
    const outT = new Date(inT)
    outT.setHours(inT.getHours() + 2)
    return {
      id: id('vis_'), hostelId: h.hostelId, hostelerId: h.id, name: h.guardianName, phone: h.guardianPhone, relation: 'Father',
      purpose: pick(['Meeting', 'Dropping essentials', 'Fee payment']), idProof: 'Aadhaar', inTime: iso(inT), outTime: i === 0 ? null : iso(outT),
    }
  })

  const expenses: Expense[] = []
  for (const month of months) {
    for (const hs of hostels) {
      const big = hs.id === 'hst_sunrise'
      const rows: [Expense['category'], number, string][] = [
        ['electricity', big ? int(28000, 36000) : int(18000, 24000), 'MPEB'],
        ['water', int(2500, 4000), 'Nagar Nigam'],
        ['groceries', big ? int(70000, 85000) : int(45000, 55000), 'Shree Kirana Store'],
        ['internet', 2999, 'JioFiber'],
        ['maintenance', int(2000, 9000), 'Local vendor'],
      ]
      for (const [category, amount, paidTo] of rows) {
        const date = `${month}-${String(int(1, 9)).padStart(2, '0')}`
        if (date > d(now)) continue
        expenses.push({ id: id('exp_'), hostelId: hs.id, category, amount, date, paidTo, mode: category === 'salary' ? 'bank' : pick(['upi', 'cash', 'bank']), note: '', createdAt: `${date}T10:00:00.000Z` })
      }
    }
  }

  // Salaries paid per staff member for past months (current month left unpaid)
  for (const month of months.slice(0, -1)) {
    for (const st of staff) {
      const date = `${month}-01`
      expenses.push({
        id: id('exp_'), hostelId: st.hostelId, category: 'salary', amount: st.salary, date, paidTo: st.name, mode: 'bank',
        note: `Salary ${format(new Date(`${month}-01T00:00:00`), 'MMM yyyy')}`, createdAt: `${date}T10:00:00.000Z`,
      })
    }
  }

  const notices: Notice[] = [
    { id: id('ntc_'), hostelId: null, title: 'Rent due by 5th of every month', body: 'Please pay your monthly rent by the 5th to avoid a late fee of ₹50 per day. You can pay via UPI from the hosteler portal.', priority: 'high', pinned: true, createdAt: iso(subDays(now, 6)) },
    { id: id('ntc_'), hostelId: 'hst_sunrise', title: 'Water supply off on Sunday', body: 'Water tank cleaning on Sunday 10 AM to 2 PM. Please store water in advance.', priority: 'medium', pinned: false, createdAt: iso(subDays(now, 2)) },
    { id: id('ntc_'), hostelId: null, title: 'Diwali celebration 🎉', body: 'Special dinner and rangoli competition in the common hall. Everyone is invited!', priority: 'low', pinned: false, createdAt: iso(subDays(now, 1)) },
  ]

  const gateLogs: GateLog[] = []
  for (const h of active.slice(0, 15)) {
    const out = new Date(now)
    out.setHours(int(8, 10), int(0, 59))
    gateLogs.push({ id: id('gl_'), hostelerId: h.id, hostelId: h.hostelId, direction: 'out', time: iso(out), note: '' })
    if (r() > 0.4) {
      const back = new Date(out)
      back.setHours(out.getHours() + int(6, 11))
      if (back < now) gateLogs.push({ id: id('gl_'), hostelerId: h.id, hostelId: h.hostelId, direction: 'in', time: iso(back), note: back.getHours() >= 22 ? 'Late entry' : '' })
    }
  }
  gateLogs.sort((a, b) => b.time.localeCompare(a.time))

  // tiny placeholder documents (1x1 png)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const documents: HDocument[] = []
  for (const h of active) {
    documents.push({ id: id('doc_'), hostelerId: h.id, type: 'aadhaar', fileName: 'aadhaar.png', mimeType: 'image/png', size: 68, dataUrl: PNG, verified: r() > 0.2, expiryDate: null, uploadedAt: `${h.checkInDate}T10:00:00.000Z` })
    if (r() > 0.4) documents.push({ id: id('doc_'), hostelerId: h.id, type: h.occupation === 'student' ? 'college_id' : 'office_id', fileName: 'id-card.png', mimeType: 'image/png', size: 68, dataUrl: PNG, verified: r() > 0.3, expiryDate: d(addMonths(now, int(-1, 10))), uploadedAt: `${h.checkInDate}T10:05:00.000Z` })
    if (r() > 0.6) documents.push({ id: id('doc_'), hostelerId: h.id, type: 'police_verification', fileName: 'police-verification.png', mimeType: 'image/png', size: 68, dataUrl: PNG, verified: false, expiryDate: null, uploadedAt: `${h.checkInDate}T10:10:00.000Z` })
  }

  const activities: Activity[] = [
    ...payments.slice(-6).map((p) => ({ id: id('act_'), message: `₹${p.amount.toLocaleString('en-IN')} received from ${hostelers.find((h) => h.id === p.hostelerId)?.name}`, kind: 'payment' as const, at: p.createdAt })),
    ...complaints.slice(0, 3).map((c) => ({ id: id('act_'), message: `New complaint: ${c.title}`, kind: 'complaint' as const, at: c.createdAt })),
    ...leaves.slice(0, 2).map((l) => ({ id: id('act_'), message: `${hostelers.find((h) => h.id === l.hostelerId)?.name} requested leave`, kind: 'leave' as const, at: l.createdAt })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return {
    org: {
      id: 'org_demo', name: 'Sunrise Hostels Pvt Ltd', ownerName: 'Rajesh Malhotra', email: 'demo@hostelhub.in', phone: '9826000000',
      password: 'demo123', plan: 'pro', createdAt: iso(subDays(now, 400)),
    },
    settings: { ...defaultSettings },
    hostels, rooms, beds, hostelers, documents, invoices, payments, gateLogs, messMenu, mealOptOuts, messFeedback,
    attendance, leaves, complaints, visitors, expenses, notices, staff, activities, invoiceSeq, receiptSeq,
  }
}
