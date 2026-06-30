import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A pure-CSS hover card: the trigger and card share a hover group, and a small
 * top bridge (`pt-1.5`) keeps the card open while the cursor crosses into it so
 * its contents stay interactive. Lives in a non-clipping container so it can
 * overflow surrounding lines.
 *
 * Pass `className` to control how the trigger sizes (e.g. `min-w-0` so it can
 * shrink/truncate inside a flex row).
 */
export function HoverCard({
  children,
  card,
  className,
  align = 'left',
}: {
  children: ReactNode
  card: ReactNode
  className?: string
  /** Which edge the card is anchored to — `right` grows it leftward, so a
   *  trigger near the viewport's right edge (e.g. a right-aligned column) doesn't
   *  push the card off-screen. */
  align?: 'left' | 'right'
}) {
  return (
    <span className={cn('group/hc relative inline-block', className)}>
      {children}
      <span
        className={cn(
          'pointer-events-none invisible absolute top-full z-30 pt-1.5 opacity-0 transition-opacity duration-100 group-hover/hc:visible group-hover/hc:pointer-events-auto group-hover/hc:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <span className="border-line bg-surface glow block w-max max-w-md border p-3 text-xs">
          {card}
        </span>
      </span>
    </span>
  )
}
