/**
 * The active validator set + system-level staking figures, read from the Sui
 * system state. The system state object (0x5) holds its inner state as its single
 * dynamic field — a `SuiSystemStateInner` Move value — and *that* carries the
 * whole validator set, total stake, gas-price/epoch parameters, and the stake
 * subsidy. So one query (0x5 → its one dynamic field → the value's `json`) yields
 * everything this page shows; the rest of this module just shapes that blob.
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'

// 0x5's lone dynamic field is the versioned inner system state; its MoveValue
// `json` is the full `SuiSystemStateInnerV{N}` struct. `first: 1` because there
// is exactly one. We read the value as a flattened json blob rather than picking
// fields, since GraphQL's `Validator`/`ValidatorSet` types expose almost nothing
// structurally — the data lives in the Move value.
const SYSTEM_STATE_QUERY = `
query SystemState {
  address(address: "0x5") {
    dynamicFields(first: 1) {
      nodes {
        value {
          __typename
          ... on MoveValue { json }
        }
      }
    }
  }
}
`

/** One active validator, distilled from its on-chain metadata + staking pool. */
export interface ValidatorSummary {
  /** The validator's Sui address — its identity and own page. */
  address: string
  name: string
  description: string | null
  imageUrl: string | null
  projectUrl: string | null
  /** Voting power in basis points; the active set sums to 10_000 (= 100%). */
  votingPower: number
  /** Reference gas price this validator quotes (MIST per gas unit). */
  gasPrice: bigint
  nextEpochGasPrice: bigint
  /** Commission taken on delegator rewards, in basis points (÷100 = %). */
  commissionRate: number
  nextEpochCommissionRate: number
  /** Total SUI staked with this validator (MIST) — the staking pool balance. */
  stake: bigint
  /** Staked SUI projected for next epoch (MIST). */
  nextEpochStake: bigint
  /** Accumulated, undistributed staking rewards in the pool (MIST). */
  rewardsPool: bigint
  /** The validator's `StakingPool` object id. */
  stakingPoolId: string
  /** Total pool tokens issued (the staking-derivative supply; 9 decimals like
   *  SUI). 1 pool token is worth `stake / poolTokens` SUI — the exchange rate
   *  that grows as rewards accrue, i.e. Sui's native liquid-staking accounting. */
  poolTokens: bigint
  /** SUI queued to be staked at the next epoch (not yet earning). */
  pendingStake: bigint
  /** SUI / pool tokens queued to be withdrawn at the next epoch. */
  pendingSuiWithdraw: bigint
  pendingPoolTokenWithdraw: bigint
  /** Epoch the staking pool became active; `deactivation` is set once it's
   *  scheduled to wind down (else `null`). */
  activationEpoch: number | null
  deactivationEpoch: number | null
  /** The `OperationCap` that authorises this validator's operations. */
  operationCapId: string | null
  /** Consensus / networking public keys (base64) and the proof of possession. */
  protocolPubkey: string | null
  networkPubkey: string | null
  workerPubkey: string | null
  proofOfPossession: string | null
  /** The validator's advertised network multiaddrs. */
  netAddress: string | null
  p2pAddress: string | null
  primaryAddress: string | null
  workerAddress: string | null
  /** Pending next-epoch rotations of the keys / addresses above — non-null only
   *  when the validator has scheduled a change to take effect next epoch. */
  nextProtocolPubkey: string | null
  nextNetworkPubkey: string | null
  nextWorkerPubkey: string | null
  nextProofOfPossession: string | null
  nextNetAddress: string | null
  nextP2pAddress: string | null
  nextPrimaryAddress: string | null
  nextWorkerAddress: string | null
  /** Epochs spent below the low-stake threshold (eligible for removal), or
   *  `null` when not at risk. */
  atRisk: number | null
  /** How many other validators have reported this one this epoch. */
  reportCount: number
  /** The validator's full on-chain json (metadata, pubkeys, network addresses,
   *  staking pool, next-epoch fields) — backs the raw "keys & network" view and
   *  the copy-as-json affordance. */
  raw: unknown
}

/** The active validator set plus the system-level figures around it. */
export interface ValidatorSet {
  epoch: number
  protocolVersion: number
  /** Total SUI staked across all active validators (MIST). */
  totalStake: bigint
  /** The network reference gas price for this epoch (MIST per gas unit). */
  referenceGasPrice: bigint
  /** Storage fund size = object storage rebates + non-refundable balance (MIST). */
  storageFund: bigint
  /** Stake distributed as subsidy each epoch right now (MIST). */
  stakeSubsidy: bigint
  /** On-chain epoch start (epoch-ms) and the protocol epoch duration. */
  epochStartMs: number
  epochDurationMs: number
  /** Scheduled next-epoch boundary (epoch start + duration), or `null`. */
  nextEpochMs: number | null
  /** Validators on deck to join at the next epoch (the pending-active table). */
  pendingCount: number
  /** Applicants in the candidate table (not yet meeting the join threshold). */
  candidateCount: number
  /** Validators that have left the active set (the inactive-pool table). */
  inactiveCount: number
  /** Dynamic-field table ids for the pending / candidate / inactive sets —
   *  loaded lazily, per tab, by {@link fetchValidatorGroup}. `null` when empty. */
  pendingTableId: string | null
  candidateTableId: string | null
  inactiveTableId: string | null
  maxValidatorCount: number | null
  /** The active validators, sorted by stake descending. */
  validators: ValidatorSummary[]
  /** The whole `SuiSystemStateInner` json (0x5's dynamic-field value) — backs the
   *  "copy json" affordance, so the full state is one click away. */
  raw: unknown
}

/** The on-chain validator groupings — drives the tab switch. */
export type ValidatorGroup = 'active' | 'pending' | 'candidate' | 'inactive'

/** Whether figures are shown as they stand now or as their next-epoch
 *  projection (each validator's `next_epoch_*` values, with the per-column delta). */
export type ValidatorView = 'current' | 'next'

/** Total voting power across the active set (Sui distributes exactly this; one
 *  validator's share is `votingPower / VOTING_POWER_TOTAL`). */
export const VOTING_POWER_TOTAL = 10_000

/**
 * Validator admission is voting-power-based, phased in over hardcoded protocol
 * steps that walk the (join, low-stake, very-low-stake) limits down toward the
 * permissive end — `(12,8,4) → (6,4,2) → (3,2,1)`. Mainnet is in the final phase,
 * so the limits are **3 / 2 / 1 voting power**. These are protocol-hardcoded, not
 * the legacy absolute-MIST `min_validator_joining_stake` etc. still carried in the
 * on-chain `SystemParameters` (those predate the voting-power scheme).
 */
export const ADMISSION = {
  /** Voting power a candidate must reach to join the active set. */
  joinVotingPower: 3,
  /** Below this an active validator is "at risk" (grace period then removal). */
  lowStakeVotingPower: 2,
  /** Below this it is removed immediately at the epoch change. */
  veryLowStakeVotingPower: 1,
} as const

/** What 1 voting power "costs" in stake right now: `totalStake / 10_000` (MIST).
 *  The admission requirement is this × {@link ADMISSION.joinVotingPower}. */
export function stakePerVotingPower(totalStake: bigint): bigint {
  return totalStake / BigInt(VOTING_POWER_TOTAL)
}

// A validator's gas price is its *vote* on the network reference gas price (the
// stake-weighted price actually charged). Most cluster within ~2× of it, with a
// fat tail; only a quote ≥5× above or below the reference is a genuine outlier
// worth flagging (one validator pricing itself far off the rest of the set).
export const GAS_OUTLIER_FACTOR = 5

/** Whether a validator's gas price deviates drastically (≥ {@link
 *  GAS_OUTLIER_FACTOR}× in either direction) from the network reference. */
export function isGasOutlier(gasPrice: bigint, referenceGasPrice: bigint): boolean {
  if (referenceGasPrice <= 0n) return false
  const factor = BigInt(GAS_OUTLIER_FACTOR)
  return gasPrice >= referenceGasPrice * factor || gasPrice * factor <= referenceGasPrice
}

/* ───────────────────────────── json plumbing ───────────────────────────── */

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A u64-as-string (or number) → `bigint`; `0n` when absent/unparseable. */
function big(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.trunc(v))
  if (typeof v === 'string' && v.trim() !== '') {
    try {
      return BigInt(v)
    } catch {
      return 0n
    }
  }
  return 0n
}

/** A numeric field → `number`; `0` when absent/unparseable. */
function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}

/** A numeric field → `number`, preserving `null`/absent as `null` (so a genuine
 *  `0` — e.g. an epoch-0 activation — isn't confused with "unset"). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** A string field, trimmed → `string`, or `null` when empty/absent. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Pull `{ contents: [{ key, value }] }` VecMap entries as `[key, value]` pairs. */
function vecMapEntries(v: unknown): { key: unknown; value: unknown }[] {
  return arr(obj(v).contents).map((e) => {
    const entry = obj(e)
    return { key: entry.key, value: entry.value }
  })
}

/**
 * Shape one validator's `Validator` json (the same struct whether it's an active,
 * pending, or candidate validator) into a {@link ValidatorSummary}. `atRisk` /
 * `reports` are the system-state VecMaps keyed by address — empty for the
 * pending / candidate groups, which carry no such records.
 */
function mapValidator(
  raw: unknown,
  atRisk: Map<string, number>,
  reports: Map<string, number>,
): ValidatorSummary {
  const v = obj(raw)
  const meta = obj(v.metadata)
  const pool = obj(v.staking_pool)
  const address = str(meta.sui_address) ?? ''
  return {
    address,
    name: str(meta.name) ?? '(unnamed)',
    description: str(meta.description),
    imageUrl: str(meta.image_url),
    projectUrl: str(meta.project_url),
    votingPower: num(v.voting_power),
    gasPrice: big(v.gas_price),
    nextEpochGasPrice: big(v.next_epoch_gas_price),
    commissionRate: num(v.commission_rate),
    nextEpochCommissionRate: num(v.next_epoch_commission_rate),
    stake: big(pool.sui_balance),
    nextEpochStake: big(v.next_epoch_stake),
    rewardsPool: big(pool.rewards_pool),
    stakingPoolId: str(pool.id) ?? '',
    poolTokens: big(pool.pool_token_balance),
    pendingStake: big(pool.pending_stake),
    pendingSuiWithdraw: big(pool.pending_total_sui_withdraw),
    pendingPoolTokenWithdraw: big(pool.pending_pool_token_withdraw),
    activationEpoch: numOrNull(pool.activation_epoch),
    deactivationEpoch: numOrNull(pool.deactivation_epoch),
    operationCapId: str(v.operation_cap_id),
    protocolPubkey: str(meta.protocol_pubkey_bytes),
    networkPubkey: str(meta.network_pubkey_bytes),
    workerPubkey: str(meta.worker_pubkey_bytes),
    proofOfPossession: str(meta.proof_of_possession),
    netAddress: str(meta.net_address),
    p2pAddress: str(meta.p2p_address),
    primaryAddress: str(meta.primary_address),
    workerAddress: str(meta.worker_address),
    nextProtocolPubkey: str(meta.next_epoch_protocol_pubkey_bytes),
    nextNetworkPubkey: str(meta.next_epoch_network_pubkey_bytes),
    nextWorkerPubkey: str(meta.next_epoch_worker_pubkey_bytes),
    nextProofOfPossession: str(meta.next_epoch_proof_of_possession),
    nextNetAddress: str(meta.next_epoch_net_address),
    nextP2pAddress: str(meta.next_epoch_p2p_address),
    nextPrimaryAddress: str(meta.next_epoch_primary_address),
    nextWorkerAddress: str(meta.next_epoch_worker_address),
    atRisk: atRisk.get(address) ?? null,
    reportCount: reports.get(address) ?? 0,
    raw,
  }
}

/** Three-way comparator for bigints (ascending). Pass args swapped for
 *  descending — the shared primitive behind every stake / gas-price sort. */
export const cmpBig = (a: bigint, b: bigint): number => (a > b ? 1 : a < b ? -1 : 0)

/** Sort validators by stake, highest first (in place); returns the same array. */
function byStakeDesc(vs: ValidatorSummary[]): ValidatorSummary[] {
  return vs.sort((a, b) => cmpBig(b.stake, a.stake))
}

/**
 * Fetch the active validator set and the system-level staking figures. Reads the
 * system state inner value off 0x5's single dynamic field (see the module note)
 * and shapes it; validators come back sorted by stake, highest first. The set
 * changes only at an epoch boundary, so callers can poll on a long interval.
 */
export async function fetchValidatorSet(
  network: Network,
  signal?: AbortSignal,
): Promise<ValidatorSet> {
  const { data } = await gqlRequest<{
    address: {
      dynamicFields: {
        nodes: { value: { __typename: string; json?: unknown } }[]
      }
    } | null
  }>(network, SYSTEM_STATE_QUERY, {}, signal)

  const node = data.address?.dynamicFields.nodes[0]
  const state = obj(node?.value?.json)
  if (Object.keys(state).length === 0) {
    throw new Error('system state unavailable for this network')
  }

  const validators = obj(state.validators)
  const params = obj(state.parameters)
  const storage = obj(state.storage_fund)

  // VecMaps keyed by validator address: epochs-at-risk, and the set of reporters.
  const atRisk = new Map<string, number>()
  for (const { key, value } of vecMapEntries(validators.at_risk_validators)) {
    if (typeof key === 'string') atRisk.set(key, num(value))
  }
  const reports = new Map<string, number>()
  for (const { key, value } of vecMapEntries(state.validator_report_records)) {
    if (typeof key === 'string') reports.set(key, arr(obj(value).contents).length)
  }

  const active = byStakeDesc(
    arr(validators.active_validators).map((raw) => mapValidator(raw, atRisk, reports)),
  )

  // Pending-active is a `TableVec` (its `{id,size}` sits under `contents`);
  // candidates are a `Table` keyed by address. Both are loaded lazily by tab.
  const pending = obj(obj(validators.pending_active_validators).contents)
  const candidates = obj(validators.validator_candidates)
  const inactive = obj(validators.inactive_validators)
  const pendingCount = num(pending.size)
  const candidateCount = num(candidates.size)
  const inactiveCount = num(inactive.size)

  const epochStartMs = num(state.epoch_start_timestamp_ms)
  const epochDurationMs = num(params.epoch_duration_ms)
  const nextEpochMs =
    epochStartMs > 0 && epochDurationMs > 0 ? epochStartMs + epochDurationMs : null

  return {
    epoch: num(state.epoch),
    protocolVersion: num(state.protocol_version),
    totalStake: big(validators.total_stake),
    referenceGasPrice: big(state.reference_gas_price),
    storageFund:
      big(storage.total_object_storage_rebates) + big(storage.non_refundable_balance),
    stakeSubsidy: big(obj(state.stake_subsidy).current_distribution_amount),
    epochStartMs,
    epochDurationMs,
    nextEpochMs,
    pendingCount,
    candidateCount,
    inactiveCount,
    pendingTableId: pendingCount > 0 ? str(pending.id) : null,
    candidateTableId: candidateCount > 0 ? str(candidates.id) : null,
    inactiveTableId: inactiveCount > 0 ? str(inactive.id) : null,
    maxValidatorCount: params.max_validator_count != null ? num(params.max_validator_count) : null,
    validators: active,
    raw: node?.value?.json ?? null,
  }
}

// One page of a validator table's dynamic fields. The value is either a
// `Validator` directly (pending-active `TableVec`) or a `ValidatorWrapper`
// `{ inner: { id } }` (candidate `Table`) — the wrapper hides the real struct one
// `Versioned` hop deeper, resolved in a second batched pass below.
const TABLE_VALIDATORS_QUERY = `
query TableValidators($id: SuiAddress!, $after: String) {
  address(address: $id) {
    dynamicFields(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { value { __typename ... on MoveValue { json } } }
    }
  }
}
`

// Sui caps a request at 21 "dedicated store" sub-queries; each aliased
// `address(...){ dynamicFields }` is one, so resolve wrapper inners ≤18 at a time.
const INNER_CHUNK = 18

/** Resolve each `Versioned` inner id to its wrapped `Validator` json, batched
 *  with aliased lookups (ids are validated on-chain hex, safe to inline). */
async function resolveInnerValidators(
  network: Network,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>()
  for (let i = 0; i < ids.length; i += INNER_CHUNK) {
    const chunk = ids.slice(i, i + INNER_CHUNK)
    const selections = chunk
      .map(
        (id, j) =>
          `v${j}: address(address: "${id}") { dynamicFields(first: 1) { nodes { value { __typename ... on MoveValue { json } } } } }`,
      )
      .join('\n')
    const { data } = await gqlRequest<
      Record<string, { dynamicFields: { nodes: { value: { json?: unknown } }[] } } | null>
    >(network, `query InnerValidators {\n${selections}\n}`, {}, signal)
    chunk.forEach((id, j) => {
      out.set(id, data[`v${j}`]?.dynamicFields.nodes[0]?.value?.json ?? null)
    })
  }
  return out
}

/** One page of a validator table's entries (the raw `value.json` per node). */
async function fetchTablePage(
  network: Network,
  tableId: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<{ values: unknown[]; hasNextPage: boolean; endCursor: string | null }> {
  const { data } = await gqlRequest<{
    address: {
      dynamicFields: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { value: { __typename: string; json?: unknown } }[]
      }
    } | null
  }>(network, TABLE_VALIDATORS_QUERY, { id: tableId, after }, signal)
  const conn = data.address?.dynamicFields
  if (!conn) return { values: [], hasNextPage: false, endCursor: null }
  return {
    values: conn.nodes.map((n) => n.value.json ?? null),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

/**
 * Load the validators in a pending / candidate table (by its dynamic-field table
 * id from {@link ValidatorSet}), shaped like the active set and sorted by stake.
 * Candidates wrap their `Validator` behind a `ValidatorWrapper` → `Versioned`, so
 * those are resolved in a second batched pass; pending validators are inline.
 * Called lazily when its tab is opened.
 */
export async function fetchValidatorGroup(
  network: Network,
  tableId: string,
  signal?: AbortSignal,
): Promise<ValidatorSummary[]> {
  // 1. Page every entry of the table.
  const values: unknown[] = []
  let after: string | null = null
  for (;;) {
    const page = await fetchTablePage(network, tableId, after, signal)
    values.push(...page.values)
    if (!page.hasNextPage) break
    after = page.endCursor
  }

  // 2. Resolve any `ValidatorWrapper` entries (candidates) one hop deeper.
  const innerIds = values
    .map((v) => str(obj(obj(v).inner).id))
    .filter((id): id is string => id != null)
  const inners = innerIds.length
    ? await resolveInnerValidators(network, innerIds, signal)
    : new Map<string, unknown>()

  const empty = new Map<string, number>()
  const out = values.map((v) => {
    const innerId = str(obj(obj(v).inner).id)
    return mapValidator(innerId ? inners.get(innerId) : v, empty, empty)
  })
  return byStakeDesc(out)
}

/* ──────────────────── lean pool → validator lookup ─────────────────── */

/** A validator identified just enough to label & link it: its address (for the
 *  dashboard deep-link) and display name. */
export interface ValidatorRef {
  address: string
  name: string
}

// Projects ONLY each active validator's staking-pool id, address, and name — by
// hitting each `Validator.contents` MoveValue with aliased `extract`s — instead
// of pulling the whole (~290 KB) system-state blob. Paginated; ~150 validators.
const VALIDATOR_POOLS_QUERY = `
query ValidatorPools($after: String) {
  epoch {
    validatorSet {
      activeValidators(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          contents {
            address: extract(path: "metadata.sui_address") { json }
            name: extract(path: "metadata.name") { json }
            poolId: extract(path: "staking_pool.id") { json }
          }
        }
      }
    }
  }
}
`

/** One page of pool → validator entries, plus the next cursor. */
async function fetchValidatorPoolsPage(
  network: Network,
  after: string | null,
  signal?: AbortSignal,
): Promise<{ entries: [string, ValidatorRef][]; hasNextPage: boolean; endCursor: string | null }> {
  const { data } = await gqlRequest<{
    epoch: {
      validatorSet: {
        activeValidators: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: {
            contents: {
              address: { json: unknown } | null
              name: { json: unknown } | null
              poolId: { json: unknown } | null
            } | null
          }[]
        }
      }
    } | null
  }>(network, VALIDATOR_POOLS_QUERY, { after }, signal)
  const conn = data.epoch?.validatorSet.activeValidators
  if (!conn) return { entries: [], hasNextPage: false, endCursor: null }
  const entries: [string, ValidatorRef][] = []
  for (const n of conn.nodes) {
    const poolId = str(n.contents?.poolId?.json)
    const address = str(n.contents?.address?.json)
    if (poolId && address) {
      entries.push([poolId, { address, name: str(n.contents?.name?.json) ?? '(unnamed)' }])
    }
  }
  return { entries, hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor }
}

/**
 * A `stakingPoolId → { address, name }` map for every active validator — the lean
 * lookup that turns a `StakedSui`'s `pool_id` into the validator it's staked with.
 * Only active-set pools are present; a stake into an inactive/removed validator
 * won't resolve (the caller falls back to showing the raw pool id).
 */
export async function fetchValidatorPools(
  network: Network,
  signal?: AbortSignal,
): Promise<Map<string, ValidatorRef>> {
  const out = new Map<string, ValidatorRef>()
  let after: string | null = null
  for (;;) {
    const page = await fetchValidatorPoolsPage(network, after, signal)
    for (const [poolId, ref] of page.entries) out.set(poolId, ref)
    if (!page.hasNextPage) break
    after = page.endCursor
  }
  return out
}
