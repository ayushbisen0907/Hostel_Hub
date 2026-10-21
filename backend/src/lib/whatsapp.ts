/**
 * WhatsApp bill messages through Pabbly Chatflow. Each hostel switches them on or off
 * (Hostel.whatsappEnabled) and they go out from:
 *  - HostelHub's default number — server settings CHATFLOW_API_KEY / CHATFLOW_TEMPLATE / CHATFLOW_NUMBER, or
 *  - the hostel's own number, which HostelHub connects in Chatflow and attaches with
 *    `npm run whatsapp:set` (Hostel.whatsappApiKey / whatsappNumber / whatsappTemplate).
 * API keys are never sent to the browser or included in exports.
 *
 *   POST <CHATFLOW_BASE_URL>/api/v1/messages   (https://chatflow.pabbly.com, or testchatflow.pabbly.com)
 *   Authorization: Bearer <API key>             (Chatflow → Settings → API & Webhooks)
 *   { to: "919876543210", type: "template", templateName, bodyParams: [...] }
 *
 * When a bill is created, queueBillWhatsApp() adds a message to the WhatsAppMessage outbox
 * inside the same transaction; flushWhatsApp() sends due messages after it commits (right
 * away, and every minute from server.ts). Failures that may pass (network, 5xx, 429) are
 * retried up to MAX_ATTEMPTS times with a growing pause; anything else is marked failed.
 * Part of the Starter plan and up (module 'whatsapp').
 */
import type { ClientSession, Types } from 'mongoose'
import { env } from '../config/env.js'
import { Hostel } from '../models/Hostel.js'
import { Hosteler } from '../models/Hosteler.js'
import { WhatsAppMessage } from '../models/WhatsAppMessage.js'
import { previousBalance } from './billing.js'
import { shortDate } from './dates.js'
import { hasModule, orgPlan } from './plans.js'

type Id = string | Types.ObjectId

export const CHATFLOW_URL = `${env.CHATFLOW_BASE_URL.replace(/\/+$/, '')}/api/v1/messages`

/** HostelHub's default Chatflow number (from the environment; tests may change it). */
export const chatflow = { apiKey: env.CHATFLOW_API_KEY, templateName: env.CHATFLOW_TEMPLATE, number: env.CHATFLOW_NUMBER }

/** True when the server has a default Chatflow API key and template to send with. */
export function chatflowReady() {
  return !!chatflow.apiKey && !!chatflow.templateName
}

type HostelSenderFields = { whatsappApiKey?: string | null; whatsappNumber?: string | null; whatsappTemplate?: string | null }

/** Who sends a hostel's messages: its own number when HostelHub has connected one, else the default; null = nobody. */
export function senderFor(h: HostelSenderFields | null | undefined) {
  if (h?.whatsappApiKey) return { own: true, apiKey: h.whatsappApiKey, templateName: h.whatsappTemplate || chatflow.templateName, number: h.whatsappNumber ?? '' }
  if (chatflowReady()) return { own: false, apiKey: chatflow.apiKey, templateName: chatflow.templateName, number: chatflow.number }
  return null
}

export const SENDER_FIELDS = 'whatsappEnabled whatsappApiKey whatsappNumber whatsappTemplate'
export const MAX_ATTEMPTS = 3

/** The template owners create in Pabbly Chatflow (category: Utility). Its 7 variables are filled by billParams(). */
export const BILL_TEMPLATE_TEXT = `Hello {{1}},
Your bill from {{2}} for {{3}} is ready.
{{4}}
Total to pay: {{5}}
Due date: {{6}}
Pay by UPI to {{7}} and report the payment in the hosteler app. Thank you!`

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** WhatsApp template values can't contain new lines, tabs or runs of spaces. */
export function cleanParam(s: string) {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 900) || '-'
}

/** Phone with country code, digits only (a 10-digit Indian number gets 91); null if unusable. */
export function waNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (d.length === 10) return `91${d}`
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

/** "Room rent ₹5,000 · Mess fees ₹2,200 · Electricity ₹126 · Previous balance ₹826" */
export function billBreakdown(items: { label: string; amount: number }[], previous: number) {
  const parts = items.filter((i) => i.amount !== 0).map((i) => `${i.label.replace(/\s*\([^)]*\)\s*$/, '')} ${rupees(i.amount)}`)
  if (previous > 0) parts.push(`Previous balance ${rupees(previous)}`)
  return parts.join(' · ')
}

/** Template variables {{1}}…{{7}} of a bill message. */
export function billParams(b: {
  hostelerName: string
  hostelName: string
  period: string
  items: { label: string; amount: number }[]
  billDue: number
  previous: number
  dueDate: string
  upiId: string
}) {
  return [
    b.hostelerName,
    b.hostelName,
    b.period,
    billBreakdown(b.items, b.previous),
    rupees(b.billDue + Math.max(0, b.previous)),
    shortDate(b.dueDate, true),
    b.upiId || 'the hostel office',
  ].map(cleanParam)
}

type BillLike = {
  _id: unknown
  hostelerId: Id
  hostelId: Id
  items: { label: string; amount: number }[]
  total: number
  paidAmount?: number
  dueDate: string
  month: string
}

/**
 * Queues the WhatsApp message for a new bill (inside the bill's transaction).
 * Nothing is queued when the plan, the hostel's WhatsApp settings or the hosteler's number don't allow it.
 * `auto: false` = sent again by staff.
 */
export async function queueBillWhatsApp(orgId: Id, inv: BillLike, period: string, session?: ClientSession, auto = true) {
  if (!hasModule(await orgPlan(orgId, session), 'whatsapp')) return null
  const hostel = await Hostel.findById(inv.hostelId).select(`name upiId ${SENDER_FIELDS}`).session(session ?? null).lean()
  const sender = senderFor(hostel)
  if (!hostel?.whatsappEnabled || !sender) return null
  const h = await Hosteler.findById(inv.hostelerId).select('name phone').session(session ?? null).lean()
  const to = waNumber(h?.phone)
  if (!h || !to) return null
  const prev = await previousBalance(orgId, inv, session)
  const params = billParams({
    hostelerName: h.name,
    hostelName: hostel.name,
    period,
    items: inv.items,
    billDue: inv.total - (inv.paidAmount ?? 0),
    previous: prev.amount,
    dueDate: inv.dueDate,
    upiId: hostel.upiId ?? '',
  })
  const [msg] = await WhatsAppMessage.create(
    [{ orgId, hostelId: inv.hostelId, hostelerId: inv.hostelerId, invoiceId: inv._id, auto, to, templateName: sender.templateName, params }],
    { session },
  )
  return msg!
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string; retry: boolean }

/** Sends one template message through Pabbly Chatflow. Never throws. */
export async function sendTemplate(apiKey: string, to: string, templateName: string, params: string[]): Promise<SendResult> {
  try {
    const res = await fetch(CHATFLOW_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ to, type: 'template', templateName, bodyParams: params }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => null)) as {
      status?: string
      message?: string
      error?: { message?: string } | string
      data?: { metaResponse?: { messages?: { id?: string }[] } }
    } | null
    if (res.ok && body?.status === 'success') return { ok: true, id: body.data?.metaResponse?.messages?.[0]?.id ?? '' }
    const detail = body?.message || (typeof body?.error === 'string' ? body.error : body?.error?.message) || ''
    const error = res.status === 401 || res.status === 403 ? 'Pabbly Chatflow rejected the API key' : detail || `Pabbly Chatflow answered ${res.status}`
    return { ok: false, error: String(error).slice(0, 300), retry: res.status >= 500 || res.status === 429 }
  } catch (e) {
    const err = e as Error
    const error = err.name === 'TimeoutError' ? 'Pabbly Chatflow did not answer in time' : `Could not reach Pabbly Chatflow (${err.message})`
    return { ok: false, error, retry: true }
  }
}

/** Sends the messages that are due, one at a time (each one is claimed first, so parallel runs never double-send). */
async function sendDue(limit: number) {
  let sent = 0
  for (let i = 0; i < limit; i++) {
    const now = new Date()
    const msg = await WhatsAppMessage.findOneAndUpdate(
      { status: { $in: ['pending', 'sending'] }, nextAttemptAt: { $lte: now } },
      // 'sending' + a 2-minute hold: a crashed run's message is picked up again later
      { $set: { status: 'sending', nextAttemptAt: new Date(now.getTime() + 2 * 60_000) }, $inc: { attempts: 1 } },
      { new: true, sort: { nextAttemptAt: 1 } },
    )
    if (!msg) break
    let r: SendResult
    if (msg.attempts > MAX_ATTEMPTS) r = { ok: false, error: msg.error || 'Gave up after several tries', retry: false }
    else {
      const hostel = await Hostel.findById(msg.hostelId).select(SENDER_FIELDS).lean()
      const sender = senderFor(hostel)
      if (!hostel?.whatsappEnabled) r = { ok: false, error: 'WhatsApp is switched off for this hostel', retry: false }
      else if (!sender) r = { ok: false, error: 'No WhatsApp number is set up (CHATFLOW_API_KEY)', retry: false }
      else if (!hasModule(await orgPlan(msg.orgId), 'whatsapp')) r = { ok: false, error: 'WhatsApp messages are not part of the current plan', retry: false }
      // the key is looked up now, so a hostel moved to its own number (or back) sends from the right one
      else r = await sendTemplate(sender!.apiKey, msg.to, sender!.own ? sender!.templateName : msg.templateName, msg.params)
    }
    if (r.ok) {
      msg.set({ status: 'sent', sentAt: new Date(), providerMessageId: r.id, error: '' })
      sent++
    } else if (r.retry && msg.attempts < MAX_ATTEMPTS) {
      msg.set({ status: 'pending', error: r.error, nextAttemptAt: new Date(Date.now() + msg.attempts * 5 * 60_000) })
    } else {
      msg.set({ status: 'failed', error: r.error })
    }
    await msg.save()
  }
  return sent
}

let running: Promise<number> | null = null

/** Sends due messages now (joins a run already in progress). Resolves to the number sent. */
export function flushWhatsApp(limit = 100): Promise<number> {
  running ??= sendDue(limit)
    .catch((e) => {
      console.error('WhatsApp send run failed:', e instanceof Error ? e.message : e)
      return 0
    })
    .finally(() => {
      running = null
    })
  return running
}

/** Starts a send run in the background after a bill was created (not in tests — they flush explicitly). */
export function kickWhatsApp() {
  if (!env.isTest) void flushWhatsApp()
}

/** A sample bill message, used by the "Send test message" button. */
export function sampleBillParams(hostelName: string, upiId: string) {
  return billParams({
    hostelerName: 'Rahul Verma',
    hostelName,
    period: '13 Oct – 12 Nov 2026',
    items: [
      { label: 'Room rent', amount: 5000 },
      { label: 'Mess fees', amount: 2200 },
      { label: 'Electricity', amount: 126 },
    ],
    billDue: 7326,
    previous: 0,
    dueDate: '2026-11-13',
    upiId,
  })
}
