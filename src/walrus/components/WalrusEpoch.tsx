import { describeInstant, formatSpan, formatAgo, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import { walrusEpochStartMs, type WalrusState } from '../epochs'

/**
 * A Walrus epoch as a date: `~Oct 12, 2026` with the epoch number, projected
 * from the live clock; red once past. Reads `epoch N` alone until the clock
 * loads. Every projection is an estimate (see `epochs.ts`), hence the `~`.
 */
export function WalrusEpochDate({
  epoch,
  state,
  now = Date.now(),
  compact = false,
  className,
}: {
  epoch: number
  state: WalrusState | null
  now?: number
  /** Date only — the distance from now stays in the tooltip (list rows). */
  compact?: boolean
  className?: string
}) {
  const ms = walrusEpochStartMs(state, epoch, now)
  if (ms == null) {
    return (
      <span className={cn('tabular-nums', className)} title="a Walrus epoch — the clock is still loading">
        epoch {formatNumber(epoch)}
      </span>
    )
  }
  const past = ms <= now
  const date = new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
  return (
    <span
      className={cn('tabular-nums', past ? 'text-danger' : undefined, className)}
      title={`walrus epoch ${formatNumber(epoch)} — begins ${describeInstant(ms, now)} (estimated from the epoch clock)`}
    >
      ~{date}
      {!compact && (
        <span className="opacity-70"> · {past ? formatAgo(now - ms) : `in ${formatSpan(ms - now)}`}</span>
      )}
    </span>
  )
}
