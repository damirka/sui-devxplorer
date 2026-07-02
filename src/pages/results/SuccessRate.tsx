import type { RecentSuccessRate } from '@/lib/transaction'
import { cn } from '@/lib/cn'

/**
 * A compact "recent success rate" chip for a transaction feed's header —
 * `47/50 ok`, the exact count of successes over the sampled window. Green when
 * healthy, red once failures pile up. Renders nothing until there's a non-empty
 * sample, so it never flashes a placeholder.
 */
export function SuccessRate({ rate }: { rate: RecentSuccessRate | null | undefined }) {
  if (!rate || rate.sampled === 0) return null
  const ratio = rate.success / rate.sampled
  const tone = ratio >= 0.95 ? 'text-secondary' : ratio >= 0.8 ? 'text-text' : 'text-danger'
  return (
    <span
      className="text-muted font-mono text-xs whitespace-nowrap"
      title={`${rate.success} of the last ${rate.sampled} transactions succeeded`}
    >
      <span className={cn('font-medium', tone)}>
        {rate.success}/{rate.sampled}
      </span>{' '}
      ok
    </span>
  )
}
