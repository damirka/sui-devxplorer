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
}: {
  kind?: SearchKind
  tone?: 'danger' | 'muted'
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
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
