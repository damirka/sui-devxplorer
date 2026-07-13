import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * One tab in an in-panel tab strip — underline style, lowercase terminal look.
 * Render the strip as `<div className="border-line mb-4 flex gap-1 border-b">`
 * with one TabButton per view (see the tx Program panel / tx feed).
 */
export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-2.5 py-1 font-mono text-xs lowercase transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
