import mongoose from 'mongoose'
import { env } from './config/env.js'
import { connectDB, disconnectDB } from './config/db.js'
import { createApp } from './app.js'
import { backfillStays } from './lib/stays.js'
import { migrateLegacyReadings } from './lib/electricity.js'
import { migrateLegacyPlans } from './lib/plans.js'
import { flushWhatsApp } from './lib/whatsapp.js'
import { generateDueBillsForAllOrgs } from './lib/rentCycle.js'

const HOUR = 60 * 60 * 1000

/** Creates rent bills whose cycle has started (each hosteler's check-in date anniversary). */
async function billingTick() {
  try {
    const created = await generateDueBillsForAllOrgs()
    if (created) console.log(`🧾 ${created} rent bill${created === 1 ? '' : 's'} generated`)
  } catch (e) {
    console.error('Billing run failed:', e instanceof Error ? e.message : e)
  }
}

async function main() {
  await connectDB(env.MONGODB_URI)
  await migrateLegacyReadings()
  await migrateLegacyPlans()
  // keep indexes in line with the schemas (adds new ones, drops ones that were removed)
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))
  await backfillStays()
  const app = createApp()
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 HostelHub API running on http://localhost:${env.PORT}/api`)
  })
  void billingTick()
  const timer = setInterval(() => void billingTick(), HOUR)
  // WhatsApp bill messages waiting to be sent (or retried)
  void flushWhatsApp()
  const waTimer = setInterval(() => void flushWhatsApp(), 60_000)
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`)
    clearInterval(timer)
    clearInterval(waTimer)
    server.close()
    await disconnectDB()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('❌ Failed to start:', err instanceof Error ? err.message : err)
  process.exit(1)
})
