import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, MousePointer2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE } from './anim'

/** A mouse pointer that glides onto the centre of its (relative) parent. */
export function Pointer({ delay = 0.35 }: { delay?: number }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 z-10"
      initial={{ x: 70, y: 60, opacity: 0 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.25 } }}
      transition={{ duration: 1.1, delay, ease: EASE }}
    >
      <MousePointer2 className="h-5 w-5 fill-slate-900 text-white drop-shadow-md" />
    </motion.span>
  )
}

/** One expanding ring — the "click" moment. */
export function Ripple({ className }: { className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 rounded-lg ring-2 ring-emerald-400', className)}
      initial={{ opacity: 0.9, scale: 1 }}
      animate={{ opacity: 0, scale: 1.6 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    />
  )
}

/** A fake button that a pointer "clicks"; flips to its done state. */
export function DemoButton({ done, label, doneLabel, className, pointerDelay }: { done: boolean; label: ReactNode; doneLabel: ReactNode; className?: string; pointerDelay?: number }) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors duration-300',
        done ? 'bg-emerald-600' : 'bg-brand-600',
        className,
      )}
    >
      {done ? (
        <>
          <Check className="h-3.5 w-3.5" /> {doneLabel}
        </>
      ) : (
        label
      )}
      <AnimatePresence>{!done && <Pointer key="pointer" delay={pointerDelay} />}</AnimatePresence>
      <AnimatePresence>{done && <Ripple key="ripple" />}</AnimatePresence>
    </span>
  )
}

/** Appears with a small lift when `show` turns true. */
export function Appear({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const init = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
  return <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-semibold text-white', className ?? 'h-10 w-10 text-sm')}>{init}</span>
}

/** Pseudo QR code (decorative). */
export function FakeQr({ className }: { className?: string }) {
  const n = 11
  const finder = (r: number, c: number) => {
    const inBox = (r0: number, c0: number) => r >= r0 && r < r0 + 3 && c >= c0 && c < c0 + 3
    return inBox(0, 0) || inBox(0, n - 3) || inBox(n - 3, 0)
  }
  return (
    <div className={cn('grid aspect-square gap-px rounded-md bg-white p-1.5', className)} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n * n }, (_, i) => {
        const r = Math.floor(i / n)
        const c = i % n
        const on = finder(r, c) || (r * 7 + c * 13 + r * c) % 5 < 2
        return <span key={i} className={cn('rounded-[1px]', on ? 'bg-slate-900' : 'bg-white')} />
      })}
    </div>
  )
}
