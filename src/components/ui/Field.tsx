import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** A labeled datum: terminal-style label above its value. */
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <span className="panel-label">{label}</span>
      <div>{children}</div>
    </div>
  )
}

/**
 * Responsive grid of `Field`s. Two columns by default; pass `cols={3}` to add a
 * third column at `lg` (used by denser overviews like the transaction view).
 */
export function FieldGrid({
  children,
  cols = 2,
}: {
  children: ReactNode
  cols?: 2 | 3
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-5 sm:grid-cols-2',
        cols === 3 && 'lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  )
}

/** Muted placeholder text — the em-dash / "none" affordance inside fields. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted text-sm">{children}</span>
}
