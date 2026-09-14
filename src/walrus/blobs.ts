/**
 * The Walrus blobs an address owns — the owned-objects "walrus blobs" view's
 * data, one page per call. `useOwnedBlobs` accumulates the pages (capped —
 * a publisher or quilt service holds tens of thousands) so the view can facet
 * by status, which lives in Move contents the API can't filter on. A blob's
 * lifetime is in Walrus epochs; `walrusBlobStatus` reads it against the clock.
 */
import type { Network } from '@/context/network-context'
import { gqlRequest } from '@/lib/graphql'
import { mapPage, type Page, type PageArgs } from '@/lib/pagination'
import { parseWalrusBlob, walrusType, type WalrusBlob } from './types'
import type { WalrusState } from './epochs'
import { walrusSpanStatus } from './epochs'

const OWNED_BLOBS_QUERY = `
query OwnedWalrusBlobs($address: SuiAddress!, $type: String!, $first: Int, $after: String) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes { address contents { json } }
    }
  }
}
`

/** One page of the Walrus blobs `ownerId` holds, in the service's order.
 *  `type` is the concrete `blob::Blob` to filter on — the network's from the
 *  registry, or the repr the owner scan saw (which also covers a custom
 *  endpoint); an empty page when neither is known. A node that doesn't decode
 *  as a blob is dropped. */
export async function fetchOwnedWalrusBlobsPage(
  network: Network,
  ownerId: string,
  args: PageArgs,
  type: string | null = walrusType(network, 'blob'),
  signal?: AbortSignal,
): Promise<Page<WalrusBlob>> {
  if (!type) return { items: [], hasNextPage: false, endCursor: null }
  const { data } = await gqlRequest<{
    address: {
      objects: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { address: string; contents: { json: unknown } | null }[]
      }
    } | null
  }>(
    network,
    OWNED_BLOBS_QUERY,
    { address: ownerId, type, first: args.limit, after: args.cursor ?? null },
    signal,
  )
  const page = mapPage(data.address?.objects, (n) => parseWalrusBlob(n.address, n.contents?.json))
  return { ...page, items: page.items.filter((b): b is WalrusBlob => b != null) }
}

/** A blob's status: `expired` (storage ran out), `uncertified` (registered,
 *  never certified — not readable), `active`; `unknown` before the clock loads. */
export type WalrusBlobStatus = 'active' | 'uncertified' | 'expired' | 'unknown'

export function walrusBlobStatus(blob: WalrusBlob, state: WalrusState | null): WalrusBlobStatus {
  const span = walrusSpanStatus(state, blob.storage.startEpoch, blob.storage.endEpoch)
  if (span === 'unknown') return 'unknown'
  if (span === 'expired') return 'expired'
  if (blob.certifiedEpoch == null) return 'uncertified'
  return 'active'
}
