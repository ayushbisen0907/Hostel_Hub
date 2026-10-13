/**
 * Server clock used by the hosteler portal for time-sensitive rules
 * (meal skip cut-offs, "not in the past", leave start date, payment date).
 * Tests replace `clock.now` to make those rules deterministic.
 */
export const clock = {
  now: (): Date => new Date(),
}

/** Local HH:mm of a Date (server time zone, same as todayStr). */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
