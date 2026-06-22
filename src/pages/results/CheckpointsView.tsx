import { useState } from 'react'
import { Pause } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { useNetwork } from '@/context/useNetwork'
import { usePolledAsync } from '@/lib/useAsync'
import { useNow } from '@/lib/useNow'
import {
  fetchRecentCheckpoints,
  fetchLatestCheckpoint,
  livenessForLag,
  tipLagMs,
  avgCheckpointIntervalMs,
  type CheckpointTip,
  type Liveness,
} from '@/lib/checkpoint'
import { LivenessBanner } from './LivenessBanner'
import { CheckpointRow } from './CheckpointRow'

/** How many checkpoints the feed shows, and how often both polls refresh.
 *  Checkpoints land every ~0.2–0.3s, so a 2s `last:10` refresh turns the window
 *  over almost entirely each tick — which is why expanding a row *freezes* the
 *  feed (below). The tip poll and the 1s wall-clock tick keep the verdict current. */
const COUNT = 10
const POLL_MS = 2_000

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

  // Liveness heartbeat — cheap, and never pauses (even while the feed is frozen),
  // so the banner verdict always reflects the real chain tip.
  const tip = usePolledAsync(
    (signal) => fetchLatestCheckpoint(network, signal),
    [network],
    POLL_MS,
  )
  // The inspectable feed — paused (pollMs → null) whenever a row is open. Toggling
  // pollMs only re-arms the poll interval; the primary load keys on `[network]`,
  // so the frozen rows are preserved, not refetched.
  const feed = usePolledAsync(
    (signal) => fetchRecentCheckpoints(network, COUNT, signal),
    [network],
    frozen ? null : POLL_MS,
  )
  // A 1s clock so the tip "age" / verdict keep advancing between 2s polls — and
  // keep climbing if a poll fails (a frozen tip then surfaces as stale, not green).
  const now = useNow(1000)

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
  const interval = avgCheckpointIntervalMs(feed.data)

  return (
    <div className="space-y-6">
      <LivenessBanner head={head} lag={lag} status={status} interval={interval} frozen={frozen} />
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
              <span className="text-muted font-mono text-xs">last {feed.data.length}</span>
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
