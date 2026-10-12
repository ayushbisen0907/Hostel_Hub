import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (see .env.example)'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
})

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST

const parsed = schema.safeParse({
  ...process.env,
  // tests run against an in-memory database and a throwaway secret
  ...(isTest
    ? {
        NODE_ENV: 'test',
        MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://set-by-tests',
        JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret',
      }
    : {}),
})

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:')
  for (const issue of parsed.error.issues) console.error(`   ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
}
