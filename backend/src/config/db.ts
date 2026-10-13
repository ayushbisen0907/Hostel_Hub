import mongoose from 'mongoose'

mongoose.set('strictQuery', true)

export async function connectDB(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  const { host, name } = mongoose.connection
  console.log(`✅ MongoDB connected: ${host}/${name}`)
  return mongoose.connection
}

export async function disconnectDB() {
  await mongoose.disconnect()
}

/**
 * Runs `fn` inside a MongoDB transaction (Atlas clusters are replica sets, so
 * transactions are available). All writes must pass `{ session }`.
 */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession()
  try {
    let result!: T
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } finally {
    await session.endSession()
  }
}
