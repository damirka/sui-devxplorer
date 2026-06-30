/**
 * Native staking objects an address holds. A `StakedSui` (`0x3::staking_pool`)
 * is the receipt for SUI delegated to a validator's staking pool: it carries the
 * pool it's staked into and the principal locked. The type id is the same on
 * every network, so no per-network resolution is needed.
 */
import { gqlRequest } from './graphql'
import { normalizeSuiId } from './search'
import type { Network } from '@/context/network-context'

/** The on-chain `StakedSui` type (same id on every network). */
export const STAKED_SUI_TYPE = `${normalizeSuiId('3')}::staking_pool::StakedSui`

/** Does a type repr name a `StakedSui` object? Matched by `module::struct` so any
 *  zero-padded form of 0x3 counts. */
export function isStakedSuiType(repr: string | null | undefined): boolean {
  return !!repr && /^0x0*3::staking_pool::StakedSui$/.test(repr)
}

/** A `StakedSui` object the owner holds: the receipt id, the staking pool it's
 *  staked into, and the principal locked (MIST). */
export interface OwnedStakedSui {
  /** The StakedSui object id. */
  address: string
  /** The `StakingPool` object id it's staked into, or `null`. */
  poolId: string | null
  /** Principal staked, in MIST. */
  principal: bigint
  /** Epoch the stake became active, or `null`. */
  activationEpoch: number | null
}

const OWNED_STAKED_QUERY = `
query OwnedStaked($address: SuiAddress!, $type: String!, $after: String) {
  address(address: $address) {
    objects(first: 50, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes { address contents { json } }
    }
  }
}
`

/** A u64-as-string (or number) → `bigint`; `0n` when absent/unparseable. */
function bigOrZero(v: unknown): bigint {
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

function parseStaked(node: {
  address: string
  contents: { json: unknown } | null
}): OwnedStakedSui {
  const j = (node.contents?.json ?? {}) as {
    pool_id?: unknown
    principal?: unknown
    stake_activation_epoch?: unknown
  }
  const ep = j.stake_activation_epoch
  const epoch = typeof ep === 'string' || typeof ep === 'number' ? Number(ep) : NaN
  return {
    address: node.address,
    poolId: typeof j.pool_id === 'string' ? j.pool_id : null,
    principal: bigOrZero(j.principal),
    activationEpoch: Number.isFinite(epoch) ? epoch : null,
  }
}

/** One page of owned StakedSui objects (shaped), plus the next cursor. */
async function fetchOwnedStakedPage(
  network: Network,
  ownerId: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<{ items: OwnedStakedSui[]; hasNextPage: boolean; endCursor: string | null }> {
  const { data } = await gqlRequest<{
    address: {
      objects: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { address: string; contents: { json: unknown } | null }[]
      }
    } | null
  }>(network, OWNED_STAKED_QUERY, { address: ownerId, type: STAKED_SUI_TYPE, after }, signal)
  const conn = data.address?.objects
  if (!conn) return { items: [], hasNextPage: false, endCursor: null }
  return {
    items: conn.nodes.map(parseStaked),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

/**
 * Every `StakedSui` object owned by `ownerId`, sorted by principal descending
 * (largest stake first). Pages through the full set — stakes per owner are
 * bounded — so the sort is global rather than per-page.
 */
export async function fetchOwnedStakedSui(
  network: Network,
  ownerId: string,
  signal?: AbortSignal,
): Promise<OwnedStakedSui[]> {
  const out: OwnedStakedSui[] = []
  let after: string | null = null
  for (;;) {
    const page = await fetchOwnedStakedPage(network, ownerId, after, signal)
    out.push(...page.items)
    if (!page.hasNextPage) break
    after = page.endCursor
  }
  return out.sort(
    (a, b) =>
      (b.principal > a.principal ? 1 : b.principal < a.principal ? -1 : 0) ||
      a.address.localeCompare(b.address),
  )
}
