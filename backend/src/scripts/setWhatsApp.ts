/**
 * Connects a hostel's OWN WhatsApp number (set up by HostelHub in Pabbly Chatflow), or moves it
 * back to HostelHub's default number. Uses MONGODB_URI from backend/.env.
 *
 *   npm run whatsapp:set -- <HOSTEL CODE> <Chatflow API key> "<number>" [template name]
 *   npm run whatsapp:set -- <HOSTEL CODE> --default
 *
 * The hostel code is the prefix of its Hosteler IDs (e.g. SBH for SBH-0001). The template name
 * defaults to CHATFLOW_TEMPLATE; it must be approved for that number in Chatflow.
 */
import { env } from '../config/env.js'
import { connectDB, disconnectDB } from '../config/db.js'
import { logActivity } from '../lib/org.js'
import { Hostel } from '../models/Hostel.js'

const USAGE = 'Usage: npm run whatsapp:set -- <HOSTEL CODE> <API key> "<number>" [template]   |   npm run whatsapp:set -- <HOSTEL CODE> --default'

function fail(msg: string): never {
  console.error(`❌ ${msg}\n${USAGE}`)
  process.exit(1)
}

async function main() {
  const [rawCode, keyOrFlag, number, template] = process.argv.slice(2)
  const code = rawCode?.trim().toUpperCase()
  if (!code) fail('Hostel code is missing.')
  const toDefault = keyOrFlag === '--default'
  if (!toDefault && (!keyOrFlag?.trim() || !number?.trim())) fail('Give the Chatflow API key and the number.')

  await connectDB(env.MONGODB_URI)
  try {
    const hostel = await Hostel.findOne({ code })
    if (!hostel) fail(`No hostel with code ${code}.`)
    if (toDefault) hostel.set({ whatsappApiKey: '', whatsappNumber: '', whatsappTemplate: '' })
    else hostel.set({ whatsappApiKey: keyOrFlag!.trim(), whatsappNumber: number!.trim(), whatsappTemplate: template?.trim() ?? '' })
    await hostel.save()
    const what = toDefault ? "HostelHub's default number" : `its own number ${hostel.whatsappNumber} (template ${hostel.whatsappTemplate || env.CHATFLOW_TEMPLATE})`
    await logActivity(String(hostel.orgId), `WhatsApp bills for "${hostel.name}" now go from ${what}`, 'general', hostel._id)
    console.log(`✅ ${hostel.name} (${code}) sends WhatsApp bills from ${what}${hostel.whatsappEnabled ? '' : ' — the owner still has to switch messages on'}`)
  } finally {
    await disconnectDB()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
