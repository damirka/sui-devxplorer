import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { SearchKind } from '@/lib/search'

/**
 * A kind/type tag. One phosphor hue for every kind — the uppercase label is
 * the differentiator, not the colour (green = signal, the dry way). `tone`
 * switches to the alarm-red or muted variant for failures / inert tags.
 *
 * `kind` is accepted for call-site ergonomics (and future per-kind treatment)
 * but does not change the colour today.
 */
export function Badge({
  children,
  tone,
  className,
  title,
}: {
  kind?: SearchKind
  tone?: 'danger' | 'muted'
  children: React.ReactNode
  className?: string
  /** Native tooltip — set directly so callers needn't wrap the badge in a span
   *  (a wrapper is a different box type and misaligns in a flex badge row). */
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'badge',
        tone === 'danger' && 'badge-danger',
        tone === 'muted' && 'badge-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * The one row that lays out badges (and badge-adjacent chips/hashes). It owns a
 * single uniform gap, so a kind tag and any trailing meta always sit on one
 * baseline with equal spacing. Pass the tags as direct children — a fragment,
 * never a pre-wrapped flex container (nesting reintroduces a second, mismatched
 * gap). This is the single place header/meta tag spacing is defined.
 */
export function BadgeRow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
  )
}
