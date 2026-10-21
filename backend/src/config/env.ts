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
  // Pabbly Chatflow (WhatsApp bill messages); e.g. https://testchatflow.pabbly.com for the test server
  CHATFLOW_BASE_URL: z.string().url().default('https://chatflow.pabbly.com'),
  // one HostelHub WhatsApp number for every hostel: its Chatflow API key (secret) and approved template name
  CHATFLOW_API_KEY: z.string().trim().default(''),
  CHATFLOW_TEMPLATE: z.string().trim().default('hostel_bill'),
  // the default number, shown to owners, e.g. +91 96913 03358
  CHATFLOW_NUMBER: z.string().trim().default(''),
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
  // a bare host (e.g. Render's `fromService … property: host`) means https://<host>
  corsOrigins: parsed.data.CORS_ORIGIN.split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((s) => (/^https?:\/\//.test(s) ? s : `https://${s}`)),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
}
