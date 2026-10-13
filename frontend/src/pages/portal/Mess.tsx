import { useEffect, useMemo, useState } from 'react'
import { addDays, format } from 'date-fns'
import { Info, Loader2, Lock, MessageSquareHeart, Star, UtensilsCrossed } from 'lucide-react'
import { isPlanError, useMessMenu, useMyFeedback, useMyOptOuts, usePortalHome, useSendMessFeedback, useToggleMeal } from '@/api/portal'
import { useHostelerSession } from '@/api/session'
import type { Meal } from '@/api/types'
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, Select, Textarea, toast } from '@/components/ui'
import { cn, formatDate, toDateKey, today } from '@/lib/utils'
import {
  MEALS,
  MEAL_CUTOFF,
  MEAL_ICON,
  MEAL_LABEL,
  MEAL_TIME,
  MEAL_TONE,
  NotAvailable,
  PortalTitle,
  SectionTitle,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  formatCutoff,
} from './_shared'

/** Whether the skip toggle for (date, meal) is locked right now — mirrors mealLockReason() on the server */
function lockReason(date: string, meal: Meal, now: Date, cutoffs: Record<Meal, string>): string | null {
  const todayKey = toDateKey(now)
  if (date < todayKey) return 'This date has passed'
  if (date === todayKey) {
    const hhmm = format(now, 'HH:mm')
    if (hhmm >= cutoffs[meal]) return `Changes closed at ${formatCutoff(cutoffs[meal])}`
  }
  return null
}

function Stars({ value, onChange, size = 'lg' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'lg' }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cn(onChange && 'transition active:scale-90', !onChange && 'cursor-default')}
        >
          <Star className={cn(size === 'lg' ? 'h-9 w-9' : 'h-4 w-4', n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
        </button>
      ))}
    </div>
  )
}

const RATING_TEXT = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent']

export default function Mess() {
  const me = useHostelerSession()?.hosteler
  const home = usePortalHome()
  const featureOn = home.data?.features.mess !== false
  const menuQ = useMessMenu(featureOn)
  const locked = !featureOn || isPlanError(menuQ.error)
  const enrolled = !!me?.messOpted

  const todayDow = new Date().getDay()
  const [day, setDay] = useState(todayDow)
  const [now, setNow] = useState(() => new Date())
  const [fbMeal, setFbMeal] = useState<Meal>(() => {
    const hhmm = format(new Date(), 'HH:mm')
    return hhmm >= '20:00' ? 'dinner' : hhmm >= '17:00' ? 'snacks' : hhmm >= '12:30' ? 'lunch' : 'breakfast'
  })
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')

  // keep lock state fresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const next7 = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(now, i)), [now])
  const from = toDateKey(next7[0]!)
  const to = toDateKey(next7[6]!)
  const optOutsQ = useMyOptOuts(from, to, !locked && enrolled)
  const feedbackQ = useMyFeedback(!locked)
  const toggle = useToggleMeal()
  const sendFeedback = useSendMessFeedback()

  const cutoffs = menuQ.data?.cutoffs ?? MEAL_CUTOFF
  const mySkips = useMemo(() => new Set((optOutsQ.data ?? []).map((o) => `${o.date}|${o.meal}`)), [optOutsQ.data])
  const myFeedback = useMemo(() => [...(feedbackQ.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [feedbackQ.data])

  if (home.isLoading) return <LoadingState />
  if (locked) {
    return (
      <div className="pb-4">
        <PortalTitle title="Mess" />
        <NotAvailable
          title="Mess isn't available for your hostel"
          description="Your hostel hasn't enabled online mess management. Please check with the warden for the menu."
        />
      </div>
    )
  }

  const menuFor = (d: number, meal: Meal) => menuQ.data?.items.find((m) => m.day === d && m.meal === meal)?.items ?? ''

  const upcomingSkips = [...mySkips].filter((k) => k.split('|')[0]! >= today()).length
  const pendingKey = toggle.isPending && toggle.variables ? `${toggle.variables.date}|${toggle.variables.meal}` : null

  const onToggle = (date: string, meal: Meal) => {
    if (toggle.isPending) return
    const reason = lockReason(date, meal, new Date(), cutoffs)
    if (reason) {
      toast.error(`${MEAL_LABEL[meal]}: ${reason}`)
      return
    }
    const wasSkipped = mySkips.has(`${date}|${meal}`)
    // the server re-checks enrolment, cut-offs and past dates; its errors are toasted by the mutation
    toggle.mutate(
      { date, meal, skip: !wasSkipped },
      {
        onSuccess: () =>
          toast.success(
            wasSkipped
              ? `${MEAL_LABEL[meal]} on ${formatDate(date, 'EEE, dd MMM')} restored`
              : `${MEAL_LABEL[meal]} on ${formatDate(date, 'EEE, dd MMM')} skipped`,
          ),
        onError: () => void optOutsQ.refetch(),
      },
    )
  }

  const submitFeedback = () => {
    if (rating < 1) {
      toast.error('Please tap a star rating')
      return
    }
    sendFeedback.mutate(
      { date: today(), meal: fbMeal, rating, comment: comment.trim() },
      {
        onSuccess: () => {
          setRating(0)
          setComment('')
        },
      },
    )
  }

  return (
    <div className="pb-4">
      <PortalTitle title="Mess" subtitle="Weekly menu, skip meals and share feedback." />

      {!enrolled && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">You're not enrolled in the mess</p>
            <p className="mt-0.5">You can still view the menu. Contact the warden to opt in to the mess plan.</p>
          </div>
        </div>
      )}

      {/* Weekly menu */}
      <Card className="overflow-hidden">
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 p-3">
          {WEEKDAYS_SHORT.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setDay(i)}
              className={cn(
                'relative min-w-[3.25rem] shrink-0 rounded-xl px-3 py-2 text-sm font-medium transition',
                day === i ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
              )}
            >
              {label}
              {i === todayDow && (
                <span className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', day === i ? 'bg-white' : 'bg-brand-600')} />
              )}
            </button>
          ))}
        </div>
        <div className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-slate-400">
          {day === todayDow ? 'Today' : WEEKDAYS[day]}
        </div>
        {menuQ.isLoading ? (
          <LoadingState className="py-10" />
        ) : menuQ.error ? (
          <ErrorState error={menuQ.error} onRetry={() => void menuQ.refetch()} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {MEALS.map((meal) => {
              const Icon = MEAL_ICON[meal]
              const items = menuFor(day, meal)
              return (
                <li key={meal} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', MEAL_TONE[meal])}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {MEAL_LABEL[meal]} <span className="ml-1 text-xs font-normal text-slate-400">{MEAL_TIME[meal]}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">{items || 'Menu not set yet'}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Skip meals */}
      <SectionTitle action={upcomingSkips > 0 && <span className="text-xs text-slate-500">{upcomingSkips} upcoming skipped</span>}>
        Skip meals
      </SectionTitle>
      {enrolled ? (
        <Card className="overflow-hidden">
          <p className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Tap a meal to skip it so the kitchen cooks less. Same-day changes close at: breakfast {formatCutoff(cutoffs.breakfast)}, lunch{' '}
            {formatCutoff(cutoffs.lunch)}, snacks {formatCutoff(cutoffs.snacks)}, dinner {formatCutoff(cutoffs.dinner)}.
          </p>
          {optOutsQ.error ? (
            <ErrorState error={optOutsQ.error} onRetry={() => void optOutsQ.refetch()} />
          ) : (
            <ul className={cn('divide-y divide-slate-100', optOutsQ.isLoading && 'pointer-events-none opacity-60')}>
              {next7.map((d, idx) => {
                const key = toDateKey(d)
                return (
                  <li key={key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="w-28 shrink-0">
                      <p className="font-medium text-slate-900">{idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : format(d, 'EEEE')}</p>
                      <p className="text-xs text-slate-500">{format(d, 'dd MMM')}</p>
                    </div>
                    <div className="grid flex-1 grid-cols-4 gap-2">
                      {MEALS.map((meal) => {
                        const skipped = mySkips.has(`${key}|${meal}`)
                        const reason = lockReason(key, meal, now, cutoffs)
                        const busy = pendingKey === `${key}|${meal}`
                        const Icon = MEAL_ICON[meal]
                        return (
                          <button
                            key={meal}
                            type="button"
                            onClick={() => onToggle(key, meal)}
                            disabled={busy}
                            title={reason ?? (skipped ? 'Skipped — tap to restore' : 'Tap to skip')}
                            aria-pressed={skipped}
                            className={cn(
                              'relative flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 text-[11px] font-medium transition',
                              reason
                                ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                                : skipped
                                  ? 'border-red-200 bg-red-50 text-red-600'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 active:scale-95',
                            )}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : reason ? (
                              <Lock className="h-4 w-4" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                            <span>{MEAL_LABEL[meal]}</span>
                            <span className={cn('text-[10px] font-normal', skipped ? 'text-red-500' : reason ? 'text-slate-400' : 'text-emerald-600')}>
                              {skipped ? 'Skipped' : reason ? 'Locked' : 'Eating'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<UtensilsCrossed className="h-5 w-5" />}
            title="Meal skipping unavailable"
            description="Only residents enrolled in the mess can skip meals."
          />
        </Card>
      )}

      {/* Feedback */}
      <SectionTitle>Rate a meal</SectionTitle>
      <Card className="p-4">
        <div className="space-y-4">
          <Field label="Which meal (today)?">
            <Select value={fbMeal} onChange={(e) => setFbMeal(e.target.value as Meal)} options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Your rating</p>
            <div className="flex items-center gap-3">
              <Stars value={rating} onChange={setRating} />
              {rating > 0 && <span className="text-sm font-medium text-slate-600">{RATING_TEXT[rating]}</span>}
            </div>
          </div>
          <Field label="Comment (optional)">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you like or what could be better?" maxLength={500} />
          </Field>
          <Button size="lg" className="w-full rounded-xl" onClick={submitFeedback} loading={sendFeedback.isPending}>
            Submit feedback
          </Button>
        </div>
      </Card>

      <SectionTitle>My feedback</SectionTitle>
      <Card>
        {feedbackQ.isLoading ? (
          <LoadingState className="py-10" />
        ) : feedbackQ.error ? (
          <ErrorState error={feedbackQ.error} onRetry={() => void feedbackQ.refetch()} />
        ) : myFeedback.length === 0 ? (
          <EmptyState icon={<MessageSquareHeart className="h-5 w-5" />} title="No feedback yet" description="Your meal ratings will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {myFeedback.map((f) => (
              <li key={f.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-900">
                    {MEAL_LABEL[f.meal]} <span className="text-xs font-normal text-slate-500">· {formatDate(f.date, 'EEE, dd MMM')}</span>
                  </p>
                  <Stars value={f.rating} size="sm" />
                </div>
                {f.comment && <p className="mt-1 text-sm text-slate-600">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
