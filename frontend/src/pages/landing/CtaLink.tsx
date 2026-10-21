import type { MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * A link that looks like a button (no <button> inside <a>), with light and dark styles.
 * `to` = app route, `href` = in-page anchor.
 */
type Variant = 'primary' | 'outline' | 'white' | 'onBrand'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:hover:bg-brand-500',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  white: 'bg-white text-brand-700 shadow-sm hover:bg-brand-50',
  onBrand: 'border border-white/50 bg-white/10 text-white hover:bg-white/20',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}

export function CtaLink({
  to,
  href,
  variant = 'primary',
  size = 'md',
  className,
  onClick,
  children,
}: {
  to?: string
  href?: string
  variant?: Variant
  size?: Size
  className?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
  children: ReactNode
}) {
  const cls = cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
  if (to)
    return (
      <Link to={to} className={cls} onClick={onClick}>
        {children}
      </Link>
    )
  return (
    <a href={href} className={cls} onClick={onClick}>
      {children}
    </a>
  )
}
