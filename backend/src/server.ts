import { env } from './config/env.js'
import { connectDB, disconnectDB } from './config/db.js'
import { createApp } from './app.js'

async function main() {
  await connectDB(env.MONGODB_URI)
  const app = createApp()
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 HostelHub API running on http://localhost:${env.PORT}/api`)
  })
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`)
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
