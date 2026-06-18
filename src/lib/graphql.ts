/**
 * Minimal Sui GraphQL client. DevXplorer has no backend — every view fetches
 * directly from the public GraphQL endpoint for the active network. No client
 * library, no cache layer yet: one `fetch`, typed by the caller.
 */
import {
  CUSTOM_ENDPOINT_STORAGE_KEY,
  type FixedNetwork,
  type Network,
} from '@/context/network-context'

const ENDPOINTS: Record<FixedNetwork, string> = {
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
  devnet: 'https://graphql.devnet.sui.io/graphql',
}

/**
 * The GraphQL URL for a network. `custom` reads the user-supplied endpoint from
 * localStorage (so it's always current — a change is picked up on the next
 * request); it falls back to mainnet if none is set.
 */
export function endpointFor(network: Network): string {
  if (network === 'custom') {
    const url =
      typeof window !== 'undefined'
        ? localStorage.getItem(CUSTOM_ENDPOINT_STORAGE_KEY)
        : null
    return url || ENDPOINTS.mainnet
  }
  return ENDPOINTS[network]
}

export class GraphQLError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphQLError'
  }
}

export interface GqlError {
  message: string
  path?: (string | number)[]
}

interface GraphQLResponse<T> {
  data?: T | null
  errors?: GqlError[]
}

/**
 * POST a query and return `data` together with any `errors`. GraphQL reports
 * field-level failures (e.g. a malformed `display` format) as `errors` *with*
 * partial `data` still present — so we only treat a missing `data` as fatal.
 * Callers decide how to surface partial errors (see `fetchObject`).
 */
export async function gqlRequest<T>(
  network: Network,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: T; errors: GqlError[] }> {
  const res = await fetch(endpointFor(network), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })

  if (!res.ok) {
    throw new GraphQLError(`request failed: ${res.status} ${res.statusText}`)
  }

  const body = (await res.json()) as GraphQLResponse<T>
  if (body.data == null) {
    throw new GraphQLError(
      body.errors?.map((e) => e.message).join('; ') ?? 'empty response',
    )
  }
  return { data: body.data, errors: body.errors ?? [] }
}
