/** Animation constants and hooks for the landing page. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Variants } from 'framer-motion'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const listVariants: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }
export const fadeUp: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }

/** Buttery wheel scrolling + smooth anchor links, while the landing page is mounted. */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ autoRaf: true, lerp: 0.1, anchors: { offset: -72 } })
    return () => lenis.destroy()
  }, [])
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Types `text` out one character at a time, starting after `start` ms. */
export function useTyped(text: string, start = 0, speed = 45) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let i = 0
    let iv: number | undefined
    const t = window.setTimeout(() => {
      iv = window.setInterval(() => {
        i += 1
        setN(i)
        if (i >= text.length) window.clearInterval(iv)
      }, speed)
    }, start)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(iv)
    }
  }, [text, start, speed])
  return { typed: text.slice(0, n), done: n >= text.length, started: n > 0 }
}

/** Returns how many of the `marks` (ms since mount) have passed: 0 … marks.length. */
export function useStage(marks: number[]) {
  const [stage, setStage] = useState(0)
  const key = marks.join(',')
  useEffect(() => {
    const timers = key.split(',').map((m, i) => window.setTimeout(() => setStage((s) => Math.max(s, i + 1)), Number(m)))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [key])
  return stage
}

const SCRAMBLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Shows random characters that settle into `text`, starting after `start` ms. */
export function useScramble(text: string, start: number, duration = 900) {
  const [out, setOut] = useState('')
  useEffect(() => {
    let iv: number | undefined
    const t = window.setTimeout(() => {
      const t0 = performance.now()
      iv = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / duration)
        const fixed = Math.floor(p * text.length)
        setOut(
          text
            .split('')
            .map((c, i) => (i < fixed || c === '-' ? c : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]))
            .join(''),
        )
        if (p >= 1) window.clearInterval(iv)
      }, 40)
    }, start)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(iv)
    }
  }, [text, start, duration])
  return out
}

/** Split `total` (whole rupees) by weights; leftover rupees go to the largest remainders. */
export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!sum) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sum)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - out[i], i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}
