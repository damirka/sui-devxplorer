import { cn } from '@/lib/cn'
import { truncateMiddle } from '@/lib/search'
import { CopyButton } from './CopyButton'

/** Truncated monospace identifier with a copy affordance. */
export function Hash({
  value,
  lead = 6,
  tail = 4,
  copy = true,
  full = false,
  className,
}: {
  value: string
  lead?: number
  tail?: number
  copy?: boolean
  full?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="hash" title={value}>
        {full ? value : truncateMiddle(value, lead, tail)}
      </span>
      {copy && <CopyButton value={value} label="Copy id" />}
    </span>
  )
}
