import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { truncateMiddle } from '@/lib/search'
import { CopyButton } from './CopyButton'

/** Truncated monospace identifier with a copy affordance. Pass `to` to make the
 *  identifier itself a link (its own page) — see `LinkedHash` in `links.tsx`. */
export function Hash({
  value,
  lead = 6,
  tail = 4,
  copy = true,
  full = false,
  to,
  className,
}: {
  value: string
  lead?: number
  tail?: number
  copy?: boolean
  full?: boolean
  /** When set, the identifier links here (phosphor, underline on hover). */
  to?: string
  className?: string
}) {
  const label = full ? value : truncateMiddle(value, lead, tail)
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {to ? (
        <Link to={to} className="hash text-primary hover:underline" title={value}>
          {label}
        </Link>
      ) : (
        <span className="hash" title={value}>
          {label}
        </span>
      )}
      {copy && <CopyButton value={value} label="Copy id" />}
    </span>
  )
}
