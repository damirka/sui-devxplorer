import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pause } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorText } from '@/components/ui/ErrorText'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { TabButton } from '@/components/ui/TabButton'
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
  type CheckpointSummary,
  type CheckpointTip,
  type Liveness,
} from '@/lib/checkpoint'
import { fetchRecentTransactions, type TxListItem } from '@/lib/transaction'
import type { Network } from '@/context/network-context'
import { LivenessBanner } from './LivenessBanner'
import { CheckpointRow } from './CheckpointRow'
import { TransactionFeedRow } from './TransactionFeedRow'

// Checkpoints land every ~0.2–0.3s — and programmable transactions many times
// faster — so a 2s refresh turns the window over almost entirely each tick,
// which is why expanding a row *freezes* the feed (below). The tip poll and the
// 1s wall-clock tick keep the verdict current.
const POLL_MS = 2_000
const PAGE_SIZES = [10, 25, 50]

/** What the live feed lists: sealed checkpoints, or the programmable (user)
 *  transactions inside them — system transactions excluded. Shareable as
 *  `?feed=txs`; checkpoints is the default and adds no param. */
type FeedMode = 'checkpoints' | 'txs'

const FEED_TABS: { mode: FeedMode; label: string }[] = [
  { mode: 'checkpoints', label: 'checkpoints' },
  { mode: 'txs', label: 'transactions' },
]

/** One polled window of the feed, tagged with the mode that produced it. The
 *  hook keeps stale data across a reload, so right after a switch it still
 *  holds the *other* mode's rows — the tag is what stops those rendering under
 *  the new tab. */
type FeedWindow =
  | { mode: 'checkpoints'; rows: CheckpointSummary[] }
  | { mode: 'txs'; rows: TxListItem[] }

async function fetchFeed(
  network: Network,
  mode: FeedMode,
  count: number,
  signal: AbortSignal,
): Promise<FeedWindow> {
  return mode === 'txs'
    ? { mode, rows: await fetchRecentTransactions(network, count, signal) }
    : { mode, rows: await fetchRecentCheckpoints(network, count, signal) }
}

/**
 * Network-liveness dashboard. A tiny always-live poll of the chain tip drives the
 * liveness verdict (so it stays honest no matter what), while the heavier feed —
 * the recent checkpoints, or (switchable) the recent programmable transactions,
 * each row expandable to its detail — *freezes* whenever a row is open, so the
 * thing you're inspecting holds still instead of scrolling out from under you.
 */
export function CheckpointsView() {
  const { network } = useNetwork()
  const [searchParams, setSearchParams] = useSearchParams()
  // Checkpoints or transactions — kept in the URL so the feed you're watching is
  // a shareable link (and survives a reload).
  const mode: FeedMode = searchParams.get('feed') === 'txs' ? 'txs' : 'checkpoints'

  // One row can be expanded at a time; while one is, the feed is frozen. Keyed
  // by row identity (`cp:<seq>` / `tx:<digest>`) so both feeds share one freeze.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const frozen = openKey != null
  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key))
  // How many recent rows the live feed shows (a "last N" window, not paging).
  const [count, setCount] = useState(10)

  const setMode = (next: FeedMode) => {
    if (next === mode) return
    const p = new URLSearchParams(searchParams)
    if (next === 'txs') p.set('feed', 'txs')
    else p.delete('feed')
    setSearchParams(p)
    // Switching lists closes whatever was open, releasing the freeze.
    setOpenKey(null)
  }

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
  // pollMs only re-arms the poll interval; the primary load keys on the query
  // identity, so the frozen rows are preserved, not refetched.
  const feed = usePolledAsync(
    (signal) => fetchFeed(network, mode, count, signal),
    [network, mode, count],
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

  // The window for the mode being shown — `null` until this mode's first load
  // lands (the hook may still hold the previous mode's rows meanwhile).
  const current = feed.data?.mode === mode ? feed.data : null
  const noun = mode === 'txs' ? 'transactions' : 'checkpoints'

  // Verdict from the live tip poll; fall back to the checkpoint feed's newest
  // row until the first tip resolves, so the banner never blanks on initial paint.
  const newestCp = current?.mode === 'checkpoints' ? (current.rows[0] ?? null) : null
  const head: CheckpointTip | null =
    tip.data ??
    (newestCp
      ? {
          sequenceNumber: newestCp.sequenceNumber,
          timestamp: newestCp.timestamp,
          epochId: newestCp.epochId,
          signers: newestCp.signers,
        }
      : null)

  if (!head) {
    // Nothing to anchor the banner on yet: a placeholder while the first tip /
    // feed loads, or the empty state once neither could be fetched.
    if (tip.loading || feed.loading) {
      return (
        <div className="space-y-6">
          <div className="border-line bg-surface h-[4.75rem] border" />
          <Panel>
            <PanelSection label="Live feed" index={1}>
              <SkeletonLines count={8} />
            </PanelSection>
          </Panel>
        </div>
      )
    }
    return (
      <EmptyState title="checkpoints unavailable">
        {tip.error?.message ??
          feed.error?.message ??
          'no checkpoints returned for this network.'}
      </EmptyState>
    )
  }

  const lag = tipLagMs(head.timestamp, now)
  // A tip we can't date is treated as stalled — we have no evidence it's live.
  const status: Liveness = lag == null ? 'stalled' : livenessForLag(lag)
  // Time left until the scheduled next-epoch boundary (counts down via `now`).
  const nextEpochInMs =
    chain.data?.nextEpochMs != null ? chain.data.nextEpochMs - now : null

  let body: ReactNode
  if (!current) {
    body = feed.error ? <ErrorText error={feed.error} /> : <SkeletonLines count={8} />
  } else if (current.rows.length === 0) {
    body = <span className="text-muted text-sm">no {noun} returned for this network.</span>
  } else if (current.mode === 'checkpoints') {
    body = (
      <ul className="divide-line divide-y font-mono text-xs">
        {current.rows.map((cp, i) => {
          const key = `cp:${cp.sequenceNumber}`
          return (
            <CheckpointRow
              key={cp.sequenceNumber}
              index={i + 1}
              cp={cp}
              now={now}
              open={openKey === key}
              onToggle={() => toggle(key)}
            />
          )
        })}
      </ul>
    )
  } else {
    body = (
      <ul className="divide-line divide-y font-mono text-xs">
        {current.rows.map((tx, i) => {
          const key = `tx:${tx.digest}`
          return (
            <TransactionFeedRow
              key={tx.digest}
              index={i + 1}
              tx={tx}
              now={now}
              open={openKey === key}
              onToggle={() => toggle(key)}
            />
          )
        })}
      </ul>
    )
  }

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
          label="Live feed"
          index={1}
          action={
            frozen ? (
              <button
                type="button"
                onClick={() => setOpenKey(null)}
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
          {/* Checkpoints vs. transactions — the same tab strip the tx panels use. */}
          <div className="border-line mb-4 flex gap-1 border-b">
            {FEED_TABS.map((t) => (
              <TabButton key={t.mode} active={mode === t.mode} onClick={() => setMode(t.mode)}>
                {t.label}
              </TabButton>
            ))}
          </div>
          {body}
        </PanelSection>
      </Panel>
    </div>
  )
}

/** A 10/25/50 toggle for how many recent rows the live feed shows. */
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
      aria-label="rows shown"
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
