import { cn } from '@/lib/cn'

/** One legend entry: a bare key (`'↵'`) or a key with its meaning. */
export type KeyHint = string | readonly [key: string, label: string]

/** A row of `kbd` chips, each with an optional label — a popup's footer legend
 *  (`↵ save · esc cancel`) or a bare key list (`↑ ↓ ↵`). */
export function KeyHints({
  items,
  gap = 'wide',
  className,
}: {
  items: readonly KeyHint[]
  /** `wide` between labeled entries; `tight` for a run of bare keys. */
  gap?: 'wide' | 'tight'
  className?: string
}) {
  return (
    <span
      className={cn(
        'text-muted inline-flex flex-wrap items-center font-mono text-[11px]',
        gap === 'wide' ? 'gap-x-3 gap-y-1' : 'gap-1.5',
        className,
      )}
    >
      {items.map((item) => {
        const [key, label] = typeof item === 'string' ? [item, ''] : item
        return (
          <span key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <kbd className="kbd">{key}</kbd>
            {label}
          </span>
        )
      })}
    </span>
  )
}
