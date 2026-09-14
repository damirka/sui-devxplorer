/**
 * Walrus keeps its own epoch clock — 2 weeks on mainnet, 1 day on testnet,
 * nothing to do with Sui epochs — and every blob/storage lifetime is expressed
 * in it. Turning "expires at epoch 77" into a date therefore needs the live
 * clock: the current epoch, when it started, and how long one lasts. All three
 * live in the Staking object's inner state (`StakingInnerV1`), one dynamic
 * field below the shared object; the System object's inner state
 * (`SystemStateInnerV1`) adds capacity and prices, read in the same request.
 *
 * The projection is an estimate: an epoch ends once `epoch_duration` has
 * elapsed since the last change *and* someone drives the change transaction,
 * so real boundaries drift a little late. Copy it with a `~`.
 */
import type { Network } from '@/context/network-context'
import { gqlRequest } from '@/lib/graphql'
import { bigOrNull, numOrNull } from '@/lib/moveJson'
import { walrusDeployment } from './registry'

export interface WalrusState {
  /** The current Walrus epoch. */
  epoch: number
  epochDurationMs: number
  /**
   * When the current epoch's change completed (its effective start), or null
   * while the change is still syncing across nodes (`EpochChangeSync`) — the
   * epoch has just begun, so "now" is the practical stand-in.
   */
  epochStartMs: number | null
  nShards: number
  /** Bytes of capacity, this epoch. */
  capacity: { total: bigint; used: bigint }
  /** FROST per storage unit (1 MiB) per epoch. */
  storagePrice: bigint
  /** FROST per storage unit written. */
  writePrice: bigint
}

const STATE_QUERY = `
query WalrusState($system: SuiAddress!, $staking: SuiAddress!) {
  system: object(address: $system) {
    dynamicFields(first: 4) { nodes { value { ... on MoveValue { type { repr } json } } } }
  }
  staking: object(address: $staking) {
    dynamicFields(first: 4) { nodes { value { ... on MoveValue { type { repr } json } } } }
  }
}
`

interface InnerNode {
  value: { type: { repr: string }; json: unknown } | null
}

/** The inner-state JSON of a versioned Walrus object: the dynamic field whose
 *  value type is `…::<module>::<Struct>V<n>` for the given module. */
function innerOf(nodes: InnerNode[] | undefined, module: string): Record<string, unknown> | null {
  const hit = nodes?.find((n) => n.value?.type.repr.includes(`::${module}::`))
  const json = hit?.value?.json
  return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
}

async function fetchState(network: Network): Promise<WalrusState | null> {
  const d = walrusDeployment(network)
  if (!d) return null
  const { data } = await gqlRequest<{
    system: { dynamicFields: { nodes: InnerNode[] } } | null
    staking: { dynamicFields: { nodes: InnerNode[] } } | null
  }>(network, STATE_QUERY, { system: d.systemId, staking: d.stakingId })
  const staking = innerOf(data.staking?.dynamicFields.nodes, 'staking_inner')
  const system = innerOf(data.system?.dynamicFields.nodes, 'system_state_inner')
  if (!staking) return null
  const epoch = numOrNull(staking.epoch)
  const epochDurationMs = numOrNull(staking.epoch_duration)
  if (epoch == null || epochDurationMs == null) return null
  // `epoch_state` is a Move enum: `{ "@variant": "EpochChangeDone", "pos0": "<ms>" }`.
  // Both Done and NextParamsSelected carry the last epoch-change timestamp.
  const st = (staking.epoch_state ?? {}) as { '@variant'?: string; pos0?: unknown }
  const epochStartMs = st['@variant'] === 'EpochChangeSync' ? null : numOrNull(st.pos0)
  return {
    epoch,
    epochDurationMs,
    epochStartMs,
    nShards: numOrNull(staking.n_shards) ?? 0,
    capacity: {
      total: bigOrNull(system?.total_capacity_size) ?? 0n,
      used: bigOrNull(system?.used_capacity_size) ?? 0n,
    },
    storagePrice: bigOrNull(system?.storage_price_per_unit_size) ?? 0n,
    writePrice: bigOrNull(system?.write_price_per_unit_size) ?? 0n,
  }
}

// One in-flight/settled promise per network, good for a minute: a list of
// blobs asks for the clock once per row, and the clock moves once a day at most.
// The request is deliberately NOT tied to any caller's AbortSignal — the entry
// is shared, so one caller unmounting (StrictMode's double mount included)
// must not fail it for the others; `useAsync` already ignores a result that
// lands after its own abort.
const STATE_TTL_MS = 60_000
const memo = new Map<Network, { at: number; promise: Promise<WalrusState | null> }>()

/** The live Walrus clock + capacity for `network` (memoised ~1 min), or null
 *  where Walrus isn't deployed. */
export function fetchWalrusState(network: Network): Promise<WalrusState | null> {
  const hit = memo.get(network)
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.promise
  const promise = fetchState(network).catch((e) => {
    // Don't cache a failure.
    if (memo.get(network)?.promise === promise) memo.delete(network)
    throw e
  })
  memo.set(network, { at: Date.now(), promise })
  return promise
}

/**
 * When Walrus epoch `epoch` begins, projected from the live clock: the current
 * epoch's start plus whole epochs of difference. Past epochs project backwards
 * the same way. Null only when `state` is null.
 */
export function walrusEpochStartMs(state: WalrusState | null, epoch: number, now = Date.now()): number | null {
  if (!state) return null
  const start = state.epochStartMs ?? now
  return start + (epoch - state.epoch) * state.epochDurationMs
}

/** Milliseconds until the current epoch is due to end (may be negative while
 *  a change is overdue), or null without a clock. */
export function walrusEpochRemainingMs(state: WalrusState | null, now = Date.now()): number | null {
  const next = state ? walrusEpochStartMs(state, state.epoch + 1, now) : null
  return next == null ? null : next - now
}

/** Where a storage span `[startEpoch, endEpoch)` stands against the clock.
 *  `unknown` until the clock loads. */
export type WalrusSpanStatus = 'active' | 'expired' | 'pending' | 'unknown'

export function walrusSpanStatus(state: WalrusState | null, startEpoch: number, endEpoch: number): WalrusSpanStatus {
  if (!state) return 'unknown'
  if (endEpoch <= state.epoch) return 'expired'
  if (startEpoch > state.epoch) return 'pending'
  return 'active'
}
