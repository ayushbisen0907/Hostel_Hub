/**
 * Animated building blocks for the landing page. Everything respects "reduce motion"
 * via <MotionConfig reducedMotion="user"> on the page.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { EASE } from './anim'

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/** Animates a number from its previous value (0 at first sight) to `value`. */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString('en-IN'),
  duration = 1,
  className,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduce = useReducedMotion()
  const shown = useRef(0)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !inView) return
    if (reduce) {
      shown.current = value
      el.textContent = fmt.current(value)
      return
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        shown.current = v
        el.textContent = fmt.current(v)
      },
    })
    return () => controls.stop()
  }, [value, inView, reduce, duration])

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {format(shown.current)}
    </span>
  )
}

