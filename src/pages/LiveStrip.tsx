import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useSearchHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { usePolledAsync } from '@/lib/useAsync'
import { useNow } from '@/lib/useNow'
import { fetchChainStatus } from '@/lib/chain'
import { fetchRecentCheckpoints } from '@/lib/checkpoint'
import { formatCount, formatNextEpoch, formatSuiCompact } from '@/lib/format'

// The feed is a tiny `last:N` query — poll it fast so the checkpoints visibly
// arrive (the chain seals ~3–4/s, so each tick brings several new ones). The
// epoch/protocol/stake figures change ~daily, so they ride a slow poll; the
// next-epoch countdown is kept live by the 1s wall clock.
const FEED_POLL_MS = 2_000
const STATUS_POLL_MS = 60_000
const FEED_COUNT = 3

/**
 * A live status bar anchored to the bottom of the landing page — the one sign of
 * a beating chain on an otherwise bare, search-first page. The left cluster is a
 * pulsing phosphor heartbeat trailed by the last few checkpoints as they land
 * (newest first, the fresh tip flashing phosphor, sequence numbers climbing in
 * real time); the right cluster is the slow epoch context. The bar links into
 * the live network dashboard.
 *
 * It's a grounded bar (a top rule spanning the content width) rather than a
 * floating block, so it reads as a deliberate status line — and it sits well
 * below the centered search, so the hints dropdown never covers it.
 *
 * Hidden until the first checkpoints resolve: a minimal page shouldn't flash a
 * spinner or an error here, just settle in once there's a pulse to show.
 */
export function LiveStrip() {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const feed = usePolledAsync(
    (signal) => fetchRecentCheckpoints(network, FEED_COUNT, signal),
    [network],
    FEED_POLL_MS,
  )
  const status = usePolledAsync(
    (signal) => fetchChainStatus(network, signal),
    [network],
    STATUS_POLL_MS,
  )
  const now = useNow(1000)

  const rows = feed.data
  if (!rows || rows.length === 0) return null

  const head = rows[0]
  const d = status.data
  const epoch = head.epochId ?? d?.epoch ?? null
  const nextInMs = d?.nextEpochMs != null ? d.nextEpochMs - now : null
  const nextLabel = nextInMs == null ? null : formatNextEpoch(nextInMs)
  const href = searchHref('checkpoints')

  // The slow epoch-level context, dropping any figure that hasn't resolved.
  const meta = [
    epoch != null ? `epoch ${epoch.toLocaleString()}` : null,
    d?.protocolVersion != null ? `v${d.protocolVersion}` : null,
    d?.totalStake != null ? `${formatSuiCompact(d.totalStake)} staked` : null,
    nextLabel != null ? `next ${nextLabel}` : null,
  ].filter(Boolean)

  // Mobile gets a single quiet grey line instead of the full phosphor bar (which
  // would wrap into a cluttered three-line block on a narrow screen).
  const mobileLine = [
    `#${head.sequenceNumber.toLocaleString()}`,
    epoch != null ? `epoch ${epoch.toLocaleString()}` : null,
    nextLabel != null ? `next ${nextLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="border-line border-t pt-4 font-mono text-xs"
      style={{ animation: 'fadeIn 0.4s ease-out' }}
    >
      {/* Mobile (< sm): one muted, single-line summary — no phosphor, no wrap. */}
      <Link
        to={href}
        title="open the live network dashboard"
        className="text-muted hover:text-text flex min-w-0 items-center gap-1.5 tabular-nums transition-colors sm:hidden"
      >
        <span className="bg-muted size-1.5 shrink-0 rounded-full" />
        <span className="truncate">live · {mobileLine}</span>
      </Link>

      {/* Desktop (sm+): the full status bar. */}
      <div className="hidden flex-wrap items-center justify-between gap-x-6 gap-y-3 sm:flex">
      {/* Left: heartbeat + the last few checkpoints streaming in. */}
      <Link
        to={href}
        title="open the live network dashboard"
        className="group inline-flex flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {/* A plain pulsing dot — its box left edge sits exactly on the content
            gutter (aligned with the header logo's ❯). An expanding ring would
            bleed left of that edge and read as a misalignment. */}
        <span className="bg-primary size-2 shrink-0 animate-pulse rounded-full" />
        <span className="text-primary font-bold tracking-[0.22em]">LIVE</span>

        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 tabular-nums">
          {rows.map((cp, i) => (
            <Fragment key={cp.sequenceNumber}>
              {i > 0 && <span className="text-muted/30 select-none">·</span>}
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-primary" style={{ animation: 'tipflash 1.4s ease-out' }}>
                  #{cp.sequenceNumber.toLocaleString()}
                </span>
                <span className="text-muted/70">
                  {cp.txCount != null ? `${formatCount(cp.txCount)} tx` : '—'}
                </span>
              </span>
            </Fragment>
          ))}
        </span>

        <span
          aria-hidden
          className="text-muted transition-all group-hover:translate-x-0.5 group-hover:text-primary"
        >
          ↗
        </span>
      </Link>

      {/* Right: the slow epoch context. */}
      {meta.length > 0 && (
        <span className="text-muted tabular-nums">{meta.join('  ·  ')}</span>
      )}
      </div>
    </div>
  )
}
