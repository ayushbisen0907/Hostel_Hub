/**
 * Turns on a paid plan for an owner after they have paid (there is no online
 * checkout for HostelHub plans yet). Uses MONGODB_URI from backend/.env.
 *
 *   npm run plan:set -- <owner email> <free|starter|pro|business> [monthly|yearly|onetime]
 *
 * Monthly/yearly: runs for a month/year from today — or from the current expiry
 * when the same plan is renewed before it runs out. One-time never expires.
 */
import { env } from '../config/env.js'
import { connectDB, disconnectDB } from '../config/db.js'
import { logActivity } from '../lib/org.js'
import { BILLING_CYCLES, PLAN_IDS, PLANS, expiryFor, type BillingCycle, type Plan } from '../lib/plans.js'
import { Bed } from '../models/Bed.js'
import { Hostel } from '../models/Hostel.js'
import { Organization } from '../models/Organization.js'
import { User } from '../models/User.js'

const USAGE = 'Usage: npm run plan:set -- <owner email> <free|starter|pro|business> [monthly|yearly|onetime]'

function fail(msg: string): never {
  console.error(`❌ ${msg}\n${USAGE}`)
  process.exit(1)
}

async function main() {
  const [rawEmail, rawPlan, rawCycle] = process.argv.slice(2)
  const email = rawEmail?.trim().toLowerCase()
  if (!email) fail('Owner email is missing.')
  if (!(PLAN_IDS as readonly string[]).includes(rawPlan ?? '')) fail(`Unknown plan "${rawPlan ?? ''}".`)
  const plan = rawPlan as Plan
  if (plan !== 'free' && !(BILLING_CYCLES as readonly string[]).includes(rawCycle ?? '')) fail('Choose monthly, yearly or onetime for a paid plan.')
  const cycle = plan === 'free' ? null : (rawCycle as BillingCycle)

  await connectDB(env.MONGODB_URI)
  try {
    const owner = await User.findOne({ email, role: 'owner' }).lean()
    const org = owner ? await Organization.findById(owner.orgId) : await Organization.findOne({ email })
    if (!org) fail(`No organization found for ${email}.`)

    // renewing the same plan early adds the new period after the current one
    const now = new Date()
    const renewing = cycle !== 'onetime' && org.plan === plan && org.billingCycle === cycle && org.planExpiresAt && org.planExpiresAt > now
    const expires = cycle ? expiryFor(cycle, renewing ? org.planExpiresAt! : now) : null

    org.set({ plan, billingCycle: cycle, planExpiresAt: expires })
    await org.save()

    const until = expires ? ` until ${expires.toDateString()}` : cycle === 'onetime' ? ' (one time, never expires)' : ''
    await logActivity(String(org._id), `Plan set to ${PLANS[plan].name}${cycle ? ` (${cycle})` : ''}${until}`)
    console.log(`✅ ${org.name} (${email}) is now on ${PLANS[plan].name}${cycle ? ` · ${cycle}` : ''}${until}`)

    const [beds, hostels] = await Promise.all([Bed.countDocuments({ orgId: org._id }), Hostel.countDocuments({ orgId: org._id })])
    const { limits } = PLANS[plan]
    if (limits.beds !== null && beds > limits.beds) console.warn(`⚠️  They have ${beds} beds; ${PLANS[plan].name} allows ${limits.beds}. Existing beds stay, new ones are blocked.`)
    if (limits.hostels !== null && hostels > limits.hostels)
      console.warn(`⚠️  They have ${hostels} hostels; ${PLANS[plan].name} allows ${limits.hostels}. Existing hostels stay, new ones are blocked.`)
  } finally {
    await disconnectDB()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
