import { useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * A long string clamped to `limit` characters with a trailing `…`; clicking
 * toggles the full text (and back). For values long enough to dominate a row —
 * e.g. a Display template's format string, which can be a full data-URI. Strings
 * within the limit render as plain text with no affordance.
 */
export function ExpandableText({
  text,
  limit = 120,
  className,
}: {
  text: string
  limit?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (text.length <= limit) return <span className={cn('break-all', className)}>{text}</span>
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={open ? 'click to collapse' : 'click to show full value'}
      className={cn('hover:text-text break-all text-left transition-colors', className)}
    >
      {open ? (
        text
      ) : (
        <>
          {text.slice(0, limit).trimEnd()}
          <span className="text-primary">…</span>
        </>
      )}
    </button>
  )
}
