import { useState } from 'react'
import { Pause } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { usePolledAsync } from '@/lib/useAsync'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/cn'
import { fetchChainStatus } from '@/lib/chain'
import {
  fetchRecentCheckpoints,
  fetchLatestCheckpoint,
  fetchThroughput,
  livenessForLag,
  tipLagMs,
  type CheckpointTip,
  type Liveness,
} from '@/lib/checkpoint'
import { LivenessBanner } from './LivenessBanner'
import { CheckpointRow } from './CheckpointRow'

// Checkpoints land every ~0.2–0.3s, so a 2s refresh turns the window over almost
// entirely each tick — which is why expanding a row *freezes* the feed (below).
// The tip poll and the 1s wall-clock tick keep the verdict current.
const POLL_MS = 2_000
const PAGE_SIZES = [10, 25, 50]

/**
 * Network-liveness dashboard. A tiny always-live poll of the chain tip drives the
 * liveness verdict (so it stays honest no matter what), while the heavier feed of
 * recent checkpoints — each expandable to its detail and the transactions it
 * sealed — *freezes* whenever a row is open, so the checkpoint you're inspecting
 * holds still instead of scrolling out from under you.
 */
export function CheckpointsView() {
  const { network } = useNetwork()

  // One checkpoint can be expanded at a time; while one is, the feed is frozen.
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const frozen = openSeq != null
  // How many recent checkpoints the live feed shows (a "last N" window, not paging).
  const [count, setCount] = useState(10)

  // Liveness heartbeat — cheap, and never pauses (even while the feed is frozen),
  // so the banner verdict always reflects the real chain tip.
  const tip = usePolledAsync(
    (signal) => fetchLatestCheckpoint(network, signal),
    [network],
    POLL_MS,
  )
  // Programmable-tx throughput — its own always-live poll (never frozen), so the
  // tx/s · tx/min readout keeps ticking even while the feed is held for inspection.
  const throughput = usePolledAsync(
    (signal) => fetchThroughput(network, signal),
    [network],
    POLL_MS,
  )
  // The inspectable feed — paused (pollMs → null) whenever a row is open. Toggling
  // pollMs only re-arms the poll interval; the primary load keys on `[network]`,
  // so the frozen rows are preserved, not refetched.
  const feed = usePolledAsync(
    (signal) => fetchRecentCheckpoints(network, count, signal),
    [network, count],
    frozen ? null : POLL_MS,
  )
  // A 1s clock so the tip "age" / verdict keep advancing between 2s polls — and
  // keep climbing if a poll fails (a frozen tip then surfaces as stale, not green).
  const now = useNow(1000)

  // Protocol version + estimated next-epoch boundary. Polled slowly (these change
  // ~daily at most) so the estimate re-anchors after an epoch rollover; the epoch
  // number in the banner comes live from the tip poll above.
  const chain = usePolledAsync(
    (signal) => fetchChainStatus(network, signal),
    [network],
    60_000,
  )

  if (feed.loading && !feed.data) {
    return (
      <div className="space-y-6">
        <div className="border-line bg-surface h-[4.75rem] border" />
        <Panel>
          <PanelSection label="Recent checkpoints" index={1}>
            <SkeletonLines count={8} />
          </PanelSection>
        </Panel>
      </div>
    )
  }

  if (feed.error || !feed.data || feed.data.length === 0) {
    return (
      <EmptyState title="checkpoints unavailable">
        {feed.error ? feed.error.message : 'no checkpoints returned for this network.'}
      </EmptyState>
    )
  }

  // Verdict from the live tip poll; fall back to the feed's newest row until the
  // first tip resolves, so the banner never blanks on initial paint.
  const head: CheckpointTip | null =
    tip.data ??
    (feed.data[0]
      ? {
          sequenceNumber: feed.data[0].sequenceNumber,
          timestamp: feed.data[0].timestamp,
          epochId: feed.data[0].epochId,
          signers: feed.data[0].signers,
        }
      : null)
  const lag = head ? tipLagMs(head.timestamp, now) : null
  // A tip we can't date is treated as stalled — we have no evidence it's live.
  const status: Liveness = lag == null ? 'stalled' : livenessForLag(lag)
  // Time left until the scheduled next-epoch boundary (counts down via `now`).
  const nextEpochInMs =
    chain.data?.nextEpochMs != null ? chain.data.nextEpochMs - now : null

  return (
    <div className="space-y-6">
      <LivenessBanner
        head={head}
        lag={lag}
        status={status}
        txPerSec={throughput.data ?? null}
        protocolVersion={chain.data?.protocolVersion ?? null}
        nextEpochInMs={nextEpochInMs}
        frozen={frozen}
      />
      <Panel>
        <PanelSection
          label="Recent checkpoints"
          index={1}
          action={
            frozen ? (
              <button
                type="button"
                onClick={() => setOpenSeq(null)}
                className="text-danger inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
                title="resume live updates"
              >
                <Pause size={12} /> frozen · resume
              </button>
            ) : (
              <PageSizeSwitch value={count} onChange={setCount} />
            )
          }
        >
          <ul className="divide-line divide-y font-mono text-xs">
            {feed.data.map((cp, i) => (
              <CheckpointRow
                key={cp.sequenceNumber}
                index={i + 1}
                cp={cp}
                now={now}
                open={openSeq === cp.sequenceNumber}
                onToggle={() =>
                  setOpenSeq((s) => (s === cp.sequenceNumber ? null : cp.sequenceNumber))
                }
              />
            ))}
          </ul>
        </PanelSection>
      </Panel>
    </div>
  )
}

/** A 10/25/50 toggle for how many recent checkpoints the live feed shows. */
function PageSizeSwitch({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div
      role="group"
      aria-label="checkpoints shown"
      className="inline-flex items-center gap-1 font-mono text-xs"
    >
      {PAGE_SIZES.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            'border px-2 py-1 tabular-nums transition-colors',
            value === n
              ? 'border-primary text-primary bg-surface-2'
              : 'border-line text-muted hover:border-primary hover:text-primary',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
