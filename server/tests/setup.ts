import { afterAll, beforeAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// Replica set (not a single server) so MongoDB transactions work like on Atlas.
let replSet: MongoMemoryReplSet

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replSet.getUri(), { dbName: 'hostelhub-test' })
  // build unique indexes before tests rely on them
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()))
})

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
})
