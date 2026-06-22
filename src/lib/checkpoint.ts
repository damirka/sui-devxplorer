/**
 * Checkpoint fetching + network-liveness signals. A checkpoint exposes no
 * per-checkpoint tx count or gas figure — only running totals — so those deltas
 * are derived by diffing each checkpoint against its older neighbour (hence the
 * one extra checkpoint fetched, to anchor the oldest displayed row).
 */
import { gqlRequest } from './graphql'
import { netGasUsed, type GasSummary } from './gas'
import type { Network } from '@/context/network-context'

const RECENT_CHECKPOINTS_QUERY = `
query RecentCheckpoints($last: Int!) {
  checkpoints(last: $last) {
    nodes {
      sequenceNumber
      digest
      contentDigest
      previousCheckpointDigest
      timestamp
      networkTotalTransactions
      epoch { epochId }
      rollingGasSummary {
        computationCost
        storageCost
        storageRebate
        nonRefundableStorageFee
      }
      validatorSignatures { signersMap }
    }
  }
}
`

interface RawCheckpoint {
  sequenceNumber: number
  digest: string
  contentDigest: string | null
  previousCheckpointDigest: string | null
  timestamp: string | null
  networkTotalTransactions: string | number
  epoch: { epochId: number } | null
  rollingGasSummary: GasSummary | null
  validatorSignatures: { signersMap: number[] | null } | null
}

export interface CheckpointSummary {
  sequenceNumber: number
  digest: string
  contentDigest: string | null
  /** The prior checkpoint's `digest` — chains the sequence backward. */
  previousCheckpointDigest: string | null
  timestamp: string | null
  epochId: number | null
  /** Cumulative tx count across the whole network as of this checkpoint. */
  networkTotalTransactions: number
  /** Transactions sealed in *this* checkpoint — the cumulative count minus the
   *  older neighbour's; null when that neighbour isn't in the fetched window. */
  txCount: number | null
  /** Validators whose signatures aggregate into this checkpoint's certificate
   *  (size of the signer bitmap) — a participation / liveness signal. */
  signers: number | null
  /** Epoch-rolling cumulative gas summary at this checkpoint. */
  rollingGas: GasSummary | null
  /** Net gas charged in *this* checkpoint — the rolling summary minus the older
   *  neighbour's; null at an epoch boundary (the rolling total resets, so the
   *  diff would go negative) or when the neighbour isn't in-window. */
  gasUsed: bigint | null
}

/**
 * The most recent `count` checkpoints, newest first, each enriched with the
 * per-checkpoint tx count and net gas derived by diffing the running totals
 * against the older neighbour. One extra checkpoint is fetched (and dropped from
 * the result) purely to anchor the oldest displayed row's diff. `count` is
 * clamped so `count + 1` stays within the service's 50-item page cap.
 */
export async function fetchRecentCheckpoints(
  network: Network,
  count: number,
  signal?: AbortSignal,
): Promise<CheckpointSummary[]> {
  const last = Math.min(count + 1, 50)
  const { data } = await gqlRequest<{ checkpoints: { nodes: RawCheckpoint[] } }>(
    network,
    RECENT_CHECKPOINTS_QUERY,
    { last },
    signal,
  )

  // The connection returns the window ascending (oldest→newest); reverse for a
  // newest-first feed. `desc[i + 1]` is then the *older* neighbour of `desc[i]`.
  const desc = [...data.checkpoints.nodes].reverse()
  return desc.slice(0, count).map((cp, i): CheckpointSummary => {
    const older = desc[i + 1]
    const total = Number(cp.networkTotalTransactions)
    const txCount = older ? total - Number(older.networkTotalTransactions) : null

    const gasNow = netGasUsed(cp.rollingGasSummary)
    const gasOlder = older ? netGasUsed(older.rollingGasSummary) : null
    // A negative diff means the rolling total reset at an epoch boundary — leave
    // it unknown rather than report a bogus (negative) per-checkpoint figure.
    const gasUsed =
      gasNow != null && gasOlder != null && gasNow >= gasOlder
        ? gasNow - gasOlder
        : null

    return {
      sequenceNumber: Number(cp.sequenceNumber),
      digest: cp.digest,
      contentDigest: cp.contentDigest,
      previousCheckpointDigest: cp.previousCheckpointDigest,
      timestamp: cp.timestamp,
      epochId: cp.epoch?.epochId ?? null,
      networkTotalTransactions: total,
      txCount,
      signers: cp.validatorSignatures?.signersMap?.length ?? null,
      rollingGas: cp.rollingGasSummary,
      gasUsed,
    }
  })
}

/** The chain tip in the few fields the liveness banner needs — cheap enough to
 *  poll continuously even while the heavier `last:N` feed is frozen for
 *  inspection, so the liveness verdict stays honest while the feed holds still. */
export interface CheckpointTip {
  sequenceNumber: number
  timestamp: string | null
  epochId: number | null
  signers: number | null
}

const LATEST_CHECKPOINT_QUERY = `
query LatestCheckpoint {
  checkpoint {
    sequenceNumber
    timestamp
    epoch { epochId }
    validatorSignatures { signersMap }
  }
}
`

/** The latest checkpoint (the no-arg `checkpoint` field is the chain tip), in the
 *  minimal shape the liveness banner reads. `null` if the network returns none. */
export async function fetchLatestCheckpoint(
  network: Network,
  signal?: AbortSignal,
): Promise<CheckpointTip | null> {
  const { data } = await gqlRequest<{
    checkpoint: {
      sequenceNumber: number
      timestamp: string | null
      epoch: { epochId: number } | null
      validatorSignatures: { signersMap: number[] | null } | null
    } | null
  }>(network, LATEST_CHECKPOINT_QUERY, {}, signal)
  const cp = data.checkpoint
  if (!cp) return null
  return {
    sequenceNumber: Number(cp.sequenceNumber),
    timestamp: cp.timestamp,
    epochId: cp.epoch?.epochId ?? null,
    signers: cp.validatorSignatures?.signersMap?.length ?? null,
  }
}

// Sampled in one request, each checkpoint's SYSTEM_TX count read inline. Sui caps a
// request at 21 "dedicated store" sub-queries (1 + one `transactions` per node), so
// the window stays ≤ 20 (18 for margin). `SYSTEM_TX` includes
// `ProgrammableSystemTransaction` (the PROGRAMMABLE_TX bucket is user PTBs only); at
// a fixed ~7/checkpoint (max ~11), `first: 50` never truncates, so the count is exact.
const THROUGHPUT_WINDOW = 18
const SYSTEM_TX_CAP = 50

const THROUGHPUT_QUERY = `
query Throughput($last: Int!, $sysFirst: Int!) {
  checkpoints(last: $last) {
    nodes {
      networkTotalTransactions
      timestamp
      systemTx: transactions(first: $sysFirst, filter: { kind: SYSTEM_TX }) {
        nodes { digest }
      }
    }
  }
}
`

/**
 * Programmable transactions per second over the most recent window of checkpoints,
 * or `null` if the window is too small to measure. `networkTotalTransactions` counts
 * *every* tx, so each checkpoint's `SYSTEM_TX` count (consensus prologue, state
 * updates, system PTBs — all bucket as SYSTEM_TX) is read inline and subtracted off,
 * leaving programmable txs only. Polled independently of the feed so it keeps
 * updating while the feed is frozen.
 */
export async function fetchThroughput(
  network: Network,
  signal?: AbortSignal,
): Promise<number | null> {
  const { data } = await gqlRequest<{
    checkpoints: {
      nodes: {
        networkTotalTransactions: string | number
        timestamp: string | null
        systemTx: { nodes: { digest: string }[] }
      }[]
    }
  }>(network, THROUGHPUT_QUERY, { last: THROUGHPUT_WINDOW, sysFirst: SYSTEM_TX_CAP }, signal)

  const nodes = data.checkpoints.nodes // ascending (oldest → newest)
  if (nodes.length < 2) return null
  const oldest = nodes[0]
  const newest = nodes[nodes.length - 1]
  const spanMs =
    (newest.timestamp ? new Date(newest.timestamp).getTime() : NaN) -
    (oldest.timestamp ? new Date(oldest.timestamp).getTime() : NaN)
  if (!(spanMs > 0)) return null

  // `totalDelta` is the txs sealed after `oldest` (its cumulative count is the
  // baseline) — i.e. in checkpoints oldest+1 … newest. Subtract the SYSTEM_TX in
  // those same checkpoints (nodes[1…]), so the remainder is programmable only.
  const totalDelta =
    Number(newest.networkTotalTransactions) - Number(oldest.networkTotalTransactions)
  let systemDelta = 0
  for (let i = 1; i < nodes.length; i++) systemDelta += nodes[i].systemTx.nodes.length
  const programmable = Math.max(0, totalDelta - systemDelta)
  return programmable / (spanMs / 1000)
}

/* ─────────────────────────── liveness signals ──────────────────────────── */

export type Liveness = 'live' | 'lagging' | 'stalled'

// Tip-freshness thresholds (ms). Steady-state lag — wall-clock minus the latest
// checkpoint's close time — is sub-second plus request latency, so 5s already
// means ~20+ checkpoints behind. The thresholds are deliberately generous so that
// ordinary network latency and minor client-clock skew never trip a false alarm,
// while a genuine halt sails past both.
export const TIP_LAGGING_MS = 5_000
export const TIP_STALLED_MS = 15_000

// Cadence warning threshold (ms/checkpoint): every current Sui network seals well
// under a second, so a multi-second average over the window means production has
// slowed — a clock-independent signal that complements tip freshness.
export const INTERVAL_WARN_MS = 2_000

/** Liveness tier from how stale the chain tip is (ms behind wall-clock). */
export function livenessForLag(lagMs: number): Liveness {
  if (lagMs >= TIP_STALLED_MS) return 'stalled'
  if (lagMs >= TIP_LAGGING_MS) return 'lagging'
  return 'live'
}

/** Milliseconds the checkpoint at `timestamp` is behind `now`, clamped at 0 — a
 *  client clock running behind the chain would otherwise report a spurious
 *  negative lag. `null` when the timestamp is missing or unparseable. */
export function tipLagMs(timestamp: string | null, now: number): number | null {
  if (!timestamp) return null
  const t = new Date(timestamp).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, now - t)
}

/** Mean interval between checkpoints across the window (ms), from its newest and
 *  oldest timestamps. `null` with fewer than two usable timestamps. */
export function avgCheckpointIntervalMs(
  checkpoints: CheckpointSummary[],
): number | null {
  const times = checkpoints
    .map((c) => (c.timestamp ? new Date(c.timestamp).getTime() : NaN))
    .filter((t) => !Number.isNaN(t))
  if (times.length < 2) return null
  // `times` is newest-first: the span between the extremes over the gap count.
  const span = times[0] - times[times.length - 1]
  return span / (times.length - 1)
}
