import type { ReactNode } from 'react'
import { Pause } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { type CheckpointTip, type Liveness } from '@/lib/checkpoint'
import { formatAge, formatCount } from '@/lib/format'
import { cn } from '@/lib/cn'

const STATUS_META: Record<Liveness, { label: string; cls: string; pulse: boolean }> = {
  // Green = healthy, red = off (the app's two-hue palette). Label + live age say
  // how far off; the healthy state pulses like a heartbeat.
  live: { label: 'LIVE', cls: 'text-secondary', pulse: true },
  lagging: { label: 'LAGGING', cls: 'text-danger', pulse: false },
  stalled: { label: 'STALLED', cls: 'text-danger', pulse: false },
}

/**
 * The network-liveness verdict at the top of the checkpoints view. Its status and
 * stats come from the chain tip (an always-live poll, even while the feed below is
 * frozen for inspection — see `CheckpointsView`), so it keeps telling the truth
 * about the chain regardless of what the feed is doing.
 */
export function LivenessBanner({
  head,
  lag,
  status,
  txPerSec,
  protocolVersion,
  nextEpochInMs,
  frozen,
}: {
  /** The chain tip, or `null` until the first poll resolves. */
  head: CheckpointTip | null
  /** Tip freshness (ms behind wall-clock), or `null` when undatable. */
  lag: number | null
  status: Liveness
  /** Programmable (non-system) transactions per second; `null` until measured. */
  txPerSec: number | null
  /** The network's current protocol version; `null` until resolved. */
  protocolVersion: number | null
  /** Estimated time left until the next epoch (ms); `null` until derived. */
  nextEpochInMs: number | null
  /** Whether the feed below is paused for inspection (the verdict stays live). */
  frozen: boolean
}) {
  const meta = STATUS_META[status]
  const tpsTitle =
    txPerSec == null
      ? undefined
      : `${Math.round(txPerSec).toLocaleString()} programmable tx/s (system txs excluded)`
  const tpmTitle =
    txPerSec == null
      ? undefined
      : `${Math.round(txPerSec * 60).toLocaleString()} programmable tx/min (system txs excluded)`
  return (
    <div className="border-line bg-surface flex flex-col gap-3 border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Badge>network liveness</Badge>
        {frozen && (
          <span className="text-muted inline-flex items-center gap-1.5 font-mono text-xs tracking-wider uppercase">
            <Pause size={12} /> feed paused
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-2 font-mono text-sm font-bold tracking-[0.18em]',
            meta.cls,
          )}
        >
          <span className={cn('size-2 rounded-full bg-current', meta.pulse && 'animate-pulse')} />
          {meta.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs">
        <Stat label="tip" tone="text-primary" value={head ? `#${head.sequenceNumber.toLocaleString()}` : '—'} />
        <Stat label="age" tone={meta.cls} value={lag == null ? '—' : formatAge(lag)} />
        <Stat label="tx/s" title={tpsTitle} value={txPerSec == null ? '—' : formatCount(Math.round(txPerSec))} />
        <Stat label="tx/min" title={tpmTitle} value={txPerSec == null ? '—' : formatCount(Math.round(txPerSec * 60))} />
        <Stat label="signers" value={head?.signers ?? '—'} />
        <Stat label="epoch" value={head?.epochId ?? '—'} />
        <Stat
          label="next epoch"
          title="scheduled boundary (on-chain epoch start + protocol epoch duration); the actual transition can vary by a second or two"
          value={
            nextEpochInMs == null ? '—' : nextEpochInMs <= 0 ? '~now' : `~${formatAge(nextEpochInMs)}`
          }
        />
        <Stat label="protocol" title="current protocol version" value={protocolVersion ?? '—'} />
      </div>
    </div>
  )
}

/** A `LABEL value` pair in the banner's stat strip. Values are tabular; `tone`
 *  colours the value (the verdict hue, or red for a warning). */
function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: ReactNode
  tone?: string
  title?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted tracking-wider uppercase">{label}</span>
      <span className={cn('tabular-nums', tone ?? 'text-text')} title={title}>
        {value}
      </span>
    </span>
  )
}
