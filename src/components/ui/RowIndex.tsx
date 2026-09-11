import { cn } from '@/lib/cn'
import { fmtIndex } from './Panel'

/**
 * The leading `01`/`02` menu index on a list row (Sifu-style). `.menu-num`
 * already sets `tabular-nums`, so callers don't repeat it.
 */
export function RowIndex({ n, className }: { n: number; className?: string }) {
  return <span className={cn('menu-num shrink-0', className)}>{fmtIndex(n)}</span>
}
