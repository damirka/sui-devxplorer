/**
 * The owned-blobs view's data: the blobs an address holds, loaded page by page
 * into memory so the view can facet them by status (active / uncertified /
 * expired — a status that lives in Move contents the API can't filter on).
 * Capped, because a publisher or quilt service holds tens of thousands: it
 * stops at `BLOB_CAP` and offers `loadAll`, the same bargain the owner type
 * scan makes. Rows land progressively — each page extends the list.
 */
import { useEffect, useState } from 'react'
import type { Network } from '@/context/network-context'
import { fetchOwnedWalrusBlobsPage } from './blobs'
import type { WalrusBlob } from './types'

export const BLOB_CAP = 500

export interface OwnedBlobs {
  items: WalrusBlob[]
  /** More pages are still landing. */
  loading: boolean
  error: Error | null
  /** Stopped at `BLOB_CAP` with more remaining — `items` is a prefix. */
  capped: boolean
  loadAll: () => void
}

export function useOwnedWalrusBlobs(network: Network, id: string, type: string | null): OwnedBlobs {
  const [state, setState] = useState<Omit<OwnedBlobs, 'loadAll'>>({
    items: [],
    loading: true,
    error: null,
    capped: false,
  })
  const [unbounded, setUnbounded] = useState(false)
  useEffect(() => setUnbounded(false), [network, id, type])

  useEffect(() => {
    const controller = new AbortController()
    setState({ items: [], loading: true, error: null, capped: false })
    const items: WalrusBlob[] = []
    let after: string | null = null
    void (async () => {
      try {
        for (;;) {
          const page = await fetchOwnedWalrusBlobsPage(
            network,
            id,
            { limit: 50, cursor: after },
            type ?? undefined,
            controller.signal,
          )
          if (controller.signal.aborted) return
          items.push(...page.items)
          const capped = !unbounded && items.length >= BLOB_CAP && page.hasNextPage
          const done = !page.hasNextPage || capped
          setState({ items: [...items], loading: !done, error: null, capped })
          if (done) break
          after = page.endCursor
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e : new Error(String(e)) }))
      }
    })()
    return () => controller.abort()
  }, [network, id, type, unbounded])

  return { ...state, loadAll: () => setUnbounded(true) }
}
