import type { ReactNode } from 'react'
import { Pause } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { INTERVAL_WARN_MS, type CheckpointTip, type Liveness } from '@/lib/checkpoint'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/cn'

const STATUS_META: Record<Liveness, { label: string; cls: string; pulse: boolean }> = {
  // Green when healthy, red whenever production is off — the app's dry two-hue
  // palette (green signal / red alarm), no third colour. The label and the live
  // numeric age convey *how far* off; both off tiers share the alarm hue so a
  // glance is enough. The healthy state pulses like a heartbeat.
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
  interval,
  frozen,
}: {
  /** The chain tip, or `null` until the first poll resolves. */
  head: CheckpointTip | null
  /** Tip freshness (ms behind wall-clock), or `null` when undatable. */
  lag: number | null
  status: Liveness
  /** Mean inter-checkpoint interval over the window (ms); `null` if unknown. */
  interval: number | null
  /** Whether the feed below is paused for inspection (the verdict stays live). */
  frozen: boolean
}) {
  const meta = STATUS_META[status]
  const intervalOff = interval != null && interval >= INTERVAL_WARN_MS
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
        <Stat label="tip">
          <span className="text-primary tabular-nums">
            #{head ? head.sequenceNumber.toLocaleString() : '—'}
          </span>
        </Stat>
        <Stat label="age">
          <span className={cn('tabular-nums', meta.cls)}>{lag == null ? '—' : formatAge(lag)}</span>
        </Stat>
        <Stat label="cadence">
          <span
            className={cn('tabular-nums', intervalOff && 'text-danger')}
            title="average interval between checkpoints"
          >
            {interval == null ? '—' : `${Math.round(interval)}ms`}
          </span>
        </Stat>
        <Stat label="signers">
          <span className="tabular-nums">{head?.signers ?? '—'}</span>
        </Stat>
        <Stat label="epoch">
          <span className="tabular-nums">{head?.epochId ?? '—'}</span>
        </Stat>
      </div>
    </div>
  )
}

/** A small `LABEL value` pair in the banner's stat strip. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted tracking-wider uppercase">{label}</span>
      <span className="text-text">{children}</span>
    </span>
  )
}
