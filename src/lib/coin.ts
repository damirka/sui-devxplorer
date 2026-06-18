/**
 * Coin balances over Sui GraphQL. The `balances` connection on an owner
 * (address / object / package — all queried through the `address` root, which is
 * non-null for any id) aggregates every coin held by *coin type*. In a single
 * request it gives, per type, the total plus the split between owned coin objects
 * and the address's accumulator balance — so the breakdown costs no extra fetch.
 * `coinMetadata` supplies decimals + symbol for human-readable formatting.
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'

export interface CoinMeta {
  decimals: number
  symbol: string
  /** `CoinMetadata.iconUrl`, when set and non-empty. */
  iconUrl?: string
}

// SUI's on-chain `CoinMetadata.iconUrl` is empty, so we supply the official one.
const SUI_TYPE_RE = /^0x0*2::sui::SUI$/
const SUI_ICON_URL =
  'https://strapi-space-bucket-fra1-1.fra1.cdn.digitaloceanspaces.com/sui_c07df05f00.png'

/**
 * Fetch decimals + symbol for several coin types in one request — aliased
 * `coinMetadata` selections, each type passed as a query variable so a repr
 * (with its `::` / `<>`) can't break out of the string. Returns a map
 * repr → metadata; coins with no registered `CoinMetadata` are simply absent,
 * so the caller can fall back to the raw amount.
 */
export async function fetchCoinMetadata(
  network: Network,
  coinTypes: string[],
  signal?: AbortSignal,
): Promise<Map<string, CoinMeta>> {
  const out = new Map<string, CoinMeta>()
  const types = [...new Set(coinTypes)]
  if (types.length === 0) return out

  const varDecls = types.map((_, i) => `$c${i}: String!`).join(', ')
  const selections = types
    .map((_, i) => `m${i}: coinMetadata(coinType: $c${i}) { decimals symbol iconUrl }`)
    .join('\n')
  const variables: Record<string, string> = {}
  types.forEach((t, i) => {
    variables[`c${i}`] = t
  })

  const { data } = await gqlRequest<
    Record<
      string,
      { decimals: number | null; symbol: string | null; iconUrl: string | null } | null
    >
  >(network, `query CoinMeta(${varDecls}) {\n${selections}\n}`, variables, signal)

  types.forEach((t, i) => {
    const m = data[`m${i}`]
    if (m && m.decimals != null) {
      out.set(t, {
        decimals: m.decimals,
        symbol: m.symbol ?? '',
        iconUrl: SUI_TYPE_RE.test(t)
          ? SUI_ICON_URL
          : m.iconUrl?.trim() || undefined,
      })
    }
  })
  return out
}

const BALANCES_QUERY = `
query Balances($address: SuiAddress!, $first: Int, $after: String) {
  address(address: $address) {
    balances(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        coinType { repr }
        totalBalance
        coinBalance
        addressBalance
      }
    }
  }
}
`

export interface CoinBalance {
  coinType: string
  /** Aggregate = the accumulator balance + every owned coin object's balance. */
  total: string
  /** Sum across the owner's `Coin<T>` objects. */
  inCoins: string
  /** Balance tracked by the address's accumulator object (the newer model). */
  inAccumulator: string
}

export interface BalancesPage {
  balances: CoinBalance[]
  hasNextPage: boolean
  endCursor: string | null
}

/**
 * One page of an owner's coin balances, aggregated per coin type. `first` is
 * capped at 50 by the service. Works for any id (account address, object, or
 * package); the page is empty for owners holding no coins.
 */
export async function fetchBalances(
  network: Network,
  ownerId: string,
  opts: { first: number; after?: string | null },
  signal?: AbortSignal,
): Promise<BalancesPage> {
  const { data } = await gqlRequest<{
    address: {
      balances: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: {
          coinType: { repr: string }
          totalBalance: string | null
          coinBalance: string | null
          addressBalance: string | null
        }[]
      }
    } | null
  }>(
    network,
    BALANCES_QUERY,
    { address: ownerId, first: opts.first, after: opts.after ?? null },
    signal,
  )
  const conn = data.address?.balances
  if (!conn) return { balances: [], hasNextPage: false, endCursor: null }
  return {
    balances: conn.nodes.map((n) => ({
      coinType: n.coinType.repr,
      total: n.totalBalance ?? '0',
      inCoins: n.coinBalance ?? '0',
      inAccumulator: n.addressBalance ?? '0',
    })),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

/**
 * Balances for a specific set of coin types, looked up by exact type via aliased
 * `balance(coinType:)` (types passed as variables). Used to pin well-known coins
 * to the top of the balances list no matter where they'd fall in the paginated
 * full set — the `balances` connection is server-ordered, so a held coin can sit
 * pages deep. Returns one entry per requested type, in request order (a type the
 * owner doesn't hold comes back with `total: '0'` — the caller decides whether to
 * show it). One request.
 */
export async function fetchBalancesForTypes(
  network: Network,
  ownerId: string,
  coinTypes: string[],
  signal?: AbortSignal,
): Promise<CoinBalance[]> {
  if (coinTypes.length === 0) return []

  const varDecls = ['$a: SuiAddress!', ...coinTypes.map((_, i) => `$c${i}: String!`)].join(
    ', ',
  )
  const selections = coinTypes
    .map(
      (_, i) =>
        `b${i}: balance(coinType: $c${i}) { totalBalance coinBalance addressBalance }`,
    )
    .join('\n')
  const variables: Record<string, string> = { a: ownerId }
  coinTypes.forEach((t, i) => {
    variables[`c${i}`] = t
  })

  const { data } = await gqlRequest<{
    address: Record<
      string,
      { totalBalance: string | null; coinBalance: string | null; addressBalance: string | null } | null
    > | null
  }>(
    network,
    `query TypedBalances(${varDecls}) {\n  address(address: $a) {\n${selections}\n  }\n}`,
    variables,
    signal,
  )

  const addr = data.address
  if (!addr) return []
  return coinTypes.map((t, i) => {
    const b = addr[`b${i}`]
    return {
      coinType: t,
      total: b?.totalBalance ?? '0',
      inCoins: b?.coinBalance ?? '0',
      inAccumulator: b?.addressBalance ?? '0',
    }
  })
}
