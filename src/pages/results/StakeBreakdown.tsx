import { cn } from '@/lib/cn'
import { formatSuiWhole } from '@/lib/format'

/** Signed whole-SUI for a delta: `+1,234 SUI` / `−1,234 SUI` / `0 SUI`. */
function signedSui(mist: bigint): string {
  if (mist > 0n) return '+' + formatSuiWhole(mist)
  if (mist < 0n) return '−' + formatSuiWhole(-mist)
  return formatSuiWhole(mist)
}

/**
 * The hover-card body for a stake figure: breaks it into the next-epoch
 * projection — current → next, the deposits / withdrawals queued to land at the
 * rollover, and the net change. `current`/`next`/`net` always show; the two flow
 * rows appear only when non-zero. Used for a single validator and for the active
 * set's aggregate alike (same shape, summed figures).
 */
export function StakeBreakdown({
  title,
  current,
  next,
  deposits,
  withdrawals,
}: {
  title: string
  current: bigint
  next: bigint
  deposits: bigint
  withdrawals: bigint
}) {
  const delta = next - current
  return (
    <div className="w-max space-y-1.5">
      <div className="panel-label mb-2">{title}</div>
      <Row label="current" value={formatSuiWhole(current)} />
      <Row label="next epoch" value={`≈ ${formatSuiWhole(next)}`} />
      {deposits > 0n && (
        <Row label="pending deposits" value={`+${formatSuiWhole(deposits)}`} tone="text-secondary" />
      )}
      {withdrawals > 0n && (
        <Row label="pending withdrawals" value={`−${formatSuiWhole(withdrawals)}`} tone="text-danger" />
      )}
      <div className="border-line mt-1.5 border-t pt-1.5">
        <Row
          label="net change"
          value={signedSui(delta)}
          tone={delta < 0n ? 'text-danger' : 'text-secondary'}
        />
      </div>
    </div>
  )
}

/** One `LABEL ─── value` line in the breakdown. */
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-8 font-mono whitespace-nowrap">
      <span className="text-muted tracking-wider uppercase">{label}</span>
      <span className={cn('tabular-nums', tone ?? 'text-text')}>{value}</span>
    </div>
  )
}
