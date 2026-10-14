/**
 * Draw-your-signature box (mouse, touch and pen via Pointer Events).
 * Exports a small PNG data URL (600×200, white background) — well under the
 * 200 KB the API accepts.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { cn } from '@/lib/utils'

export const SIGNATURE_WIDTH = 600
export const SIGNATURE_HEIGHT = 200

export interface SignaturePadHandle {
  clear: () => void
  isEmpty: () => boolean
  /** PNG data URL at 600×200 with a white background, or null when nothing is drawn */
  toDataUrl: () => string | null
}

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { onChange?: (empty: boolean) => void; disabled?: boolean; className?: string; invalid?: boolean }
>(function SignaturePad({ onChange, disabled, className, invalid }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const strokes = useRef(0)
  const [empty, setEmpty] = useState(true)

  const reset = useCallback(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  useEffect(() => reset(), [reset])

  const markDrawn = () => {
    strokes.current += 1
    if (empty) {
      setEmpty(false)
      onChange?.(false)
    }
  }

  /** pointer position in canvas pixels (the canvas is scaled by CSS) */
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    last.current = p
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      // a dot for a tap
      ctx.beginPath()
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fillStyle = '#0f172a'
      ctx.fill()
    }
    markDrawn()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    const p = pos(e)
    if (ctx && last.current) {
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
    last.current = p
  }

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)
  }

  const clear = useCallback(() => {
    reset()
    strokes.current = 0
    setEmpty(true)
    onChange?.(true)
  }, [reset, onChange])

  useImperativeHandle(
    ref,
    () => ({
      clear,
      isEmpty: () => strokes.current === 0,
      toDataUrl: () => (strokes.current === 0 ? null : (canvasRef.current?.toDataURL('image/png') ?? null)),
    }),
    [clear],
  )

  return (
    <div className={className}>
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border-2 border-dashed bg-white',
          invalid ? 'border-red-300' : 'border-slate-300',
          disabled && 'opacity-60',
        )}
      >
        <canvas
          ref={canvasRef}
          width={SIGNATURE_WIDTH}
          height={SIGNATURE_HEIGHT}
          aria-label="Signature pad: draw your signature"
          role="img"
          className="block aspect-[3/1] w-full cursor-crosshair touch-none select-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Sign here with your finger or mouse</span>
        )}
        <span className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-200" />
      </div>
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" /> Clear
        </button>
      </div>
    </div>
  )
})
