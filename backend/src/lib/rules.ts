/**
 * Default hostel rules (English), built from the hostel's and the
 * organization's settings. Owners start from this text and edit it; hostelers
 * sign the saved version in the portal (see RulesConsent).
 */

export interface RulesHostel {
  name: string
  type: string
  noticePeriodDays?: number | null
  depositMinStayMonths?: number | null
  electricityRate?: number | null
  charges?: { mess?: number | null } | null
}
export interface RulesSettings {
  rentDueDay?: number | null
  lateFeePerDay?: number | null
  nightCurfew?: string | null
  defaultSecurityDeposit?: number | null
  currencySymbol?: string | null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "22:00" -> "10:00 PM" */
function time12(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return hhmm
  const h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`
}

export function defaultRulesText(hostel: RulesHostel, s: RulesSettings = {}): string {
  const cur = s.currencySymbol || '₹'
  const money = (n: number) => `${cur}${n.toLocaleString('en-IN')}`
  const dueDays = Math.max(0, Math.min(s.rentDueDay ?? 5, 28))
  const lateFee = s.lateFeePerDay ?? 0
  const notice = hostel.noticePeriodDays ?? 30
  const minStay = hostel.depositMinStayMonths ?? 0
  const deposit = s.defaultSecurityDeposit ?? 0
  const curfew = s.nightCurfew ? time12(s.nightCurfew) : null
  const visitorsOf = hostel.type === 'boys' ? 'Female visitors' : hostel.type === 'girls' ? 'Male visitors' : 'Visitors of the opposite gender'

  const sections: [string, string[]][] = [
    [
      'Rent and payments',
      [
        'Rent is paid in advance for every monthly rent cycle, counted from your check-in date (for example, 13 Oct – 12 Nov). A bill is created on the first day of each cycle.',
        dueDays > 0
          ? `Each bill must be paid within ${plural(dueDays, 'day')} of the cycle date (the due date is shown on the bill).`
          : 'Each bill must be paid on the cycle date (the due date is shown on the bill).',
        'Monthly charges (rent and any mess, electricity, water, internet or other charges listed on the bill) are all part of the same bill.',
        lateFee > 0 ? `A late fee of ${money(lateFee)} per day may be added to bills paid after the due date.` : null,
        'Pay to the hostel’s UPI ID / QR code and report the transaction ID in the app, or pay at the hostel office and collect a receipt.',
      ].filter((x): x is string => !!x),
    ],
    [
      'Security deposit',
      [
        deposit > 0
          ? `A refundable security deposit (usually ${money(deposit)}) is collected at check-in, either upfront or on the first bill.`
          : 'A refundable security deposit may be collected at check-in, either upfront or on the first bill.',
        minStay > 0
          ? `The security deposit is refunded only if you stay at least ${plural(minStay, 'month')} (full rent cycles). If you leave earlier, the deposit is forfeited and is not adjusted against dues.`
          : 'The security deposit is refunded at check-out.',
        'Unpaid dues may be adjusted from a refundable deposit at check-out. Charges for damages or missing items are deducted from the deposit.',
        'No interest is paid on the security deposit.',
      ],
    ],
    [
      'Moving out',
      [
        notice > 0
          ? `You must give at least ${plural(notice, 'day')} of notice before moving out. Request your move-out date from the app.`
          : 'Inform the hostel office of your move-out date in advance. Request your move-out date from the app.',
        'All dues must be paid before check-out. Your hosteler ID and app access are closed after check-out.',
        'Return your room keys, ID card and any hostel property at check-out. The room must be left clean and undamaged.',
      ],
    ],
    [
      'Timings and attendance',
      [
        curfew ? `The hostel gate closes at ${curfew}. Entry after the curfew needs prior permission from the warden.` : 'Follow the hostel’s gate timings. Late entry needs prior permission from the warden.',
        'Apply for leave in the app before staying out overnight or going home.',
        'Record your entry and exit at the gate when asked.',
      ],
    ],
    [
      'Visitors',
      [
        'Visitors are allowed only in the visitors’ area during visiting hours and must be entered in the visitor register.',
        `${visitorsOf} are not allowed inside rooms.`,
        'Visitors are not allowed to stay overnight without the warden’s permission.',
      ],
    ],
    [
      'Mess',
      [
        'Meals are served at the times shown in the mess menu.',
        'To skip a meal (mess opt-out), mark it in the app before the cut-off time; meals skipped without marking are not adjusted.',
        'Food and utensils are not to be taken out of the mess.',
      ],
    ],
    [
      'Room, conduct and safety',
      [
        'Keep your room clean. Do not paste posters or drill into walls.',
        'Damage to hostel property will be charged to the hosteler(s) responsible and may be deducted from the security deposit.',
        'Switch off lights, fans, AC and other appliances when you leave the room.' + (hostel.electricityRate ? ' Electricity is metered and billed per unit.' : ''),
        'Heaters, induction cooktops, irons and other high-power appliances are not allowed unless permitted by the warden.',
        'Alcohol, smoking, drugs, gambling and weapons are strictly prohibited on the premises.',
        'Ragging, fighting, harassment and loud music or noise (especially after 10 PM) are not allowed.',
        'You may not shift beds or rooms, or let anyone else stay in your bed, without the office’s approval.',
        'The hostel is not responsible for loss of cash, valuables or personal belongings. Keep them locked.',
      ],
    ],
    [
      'Identity and documents',
      [
        'A valid government photo ID proof (Aadhaar, PAN, passport, driving licence, etc.) and a recent photograph are required at check-in. Upload them in the app if asked.',
        'Keep your guardian’s contact details up to date. The hostel may contact your guardian in an emergency or for repeated rule violations.',
        'Police verification may be done as required by local authorities.',
      ],
    ],
    [
      'General',
      [
        'Raise complaints and maintenance requests through the app.',
        'The management may inspect rooms with prior notice, or without notice in an emergency.',
        'Repeated or serious violations of these rules may lead to a fine or cancellation of your stay.',
        'The management may update these rules; you will be asked to accept the new rules in the app.',
      ],
    ],
  ]

  const out = [`${hostel.name} — Hostel Rules`, '']
  sections.forEach(([title, items], i) => {
    out.push(`${i + 1}. ${title}`)
    for (const item of items) out.push(`   • ${item}`)
    out.push('')
  })
  out.push('By signing below, I confirm that I have read, understood and agree to follow these rules.')
  return out.join('\n')
}
