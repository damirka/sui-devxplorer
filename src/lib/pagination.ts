/**
 * One normalized shape for every cursor-paginated list in the app. The Sui
 * GraphQL connections differ (some page forward with `first`/`after`, some
 * backward with `last`/`before`), but a view never cares — it only wants the
 * items in display order and a way to ask for the next page. Folding all of
 * them onto `Page<T>` + `PageArgs` is what lets one hook (`usePagedList`) and
 * one component (`DataList`) drive them all.
 */

/** A page of a connection, in display order. `endCursor`/`hasNextPage` always
 *  mean "the next page shown *below* this one" — regardless of whether the
 *  underlying connection pages forward or backward. */
export interface Page<T> {
  items: T[]
  hasNextPage: boolean
  /** Pass back as `cursor` in the next `PageArgs` to fetch the following page. */
  endCursor: string | null
}

/** A request for one page: how many items, and from where (`null`/omitted for
 *  the first page; otherwise the previous page's `endCursor`). */
export interface PageArgs {
  limit: number
  cursor?: string | null
}

/** An empty page — for the "owner has no such connection" fast paths. */
export function emptyPage<T>(): Page<T> {
  return { items: [], hasNextPage: false, endCursor: null }
}

/** Minimal forward-connection shape (`first`/`after`). */
interface ForwardConnection<N> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: N[]
}

/** Minimal backward-connection shape (`last`/`before`). */
interface BackwardConnection<N> {
  pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
  nodes: N[]
}

/**
 * Map a forward connection (`first`/`after`) to a `Page`, mapping each node.
 * Returns an empty page for a missing connection.
 */
export function mapPage<N, T>(
  conn: ForwardConnection<N> | null | undefined,
  map: (node: N) => T,
): Page<T> {
  if (!conn) return emptyPage<T>()
  return {
    items: conn.nodes.map(map),
    hasNextPage: conn.pageInfo.hasNextPage,
    endCursor: conn.pageInfo.endCursor,
  }
}

/**
 * Map a backward connection (`last`/`before`) to a `Page`. The service returns
 * each window ascending, so nodes are reversed to put the newest first; "next
 * page" then means the older page reached via `startCursor`.
 */
export function mapBackwardPage<N, T>(
  conn: BackwardConnection<N> | null | undefined,
  map: (node: N) => T,
): Page<T> {
  if (!conn) return emptyPage<T>()
  return {
    items: conn.nodes.map(map).reverse(),
    hasNextPage: conn.pageInfo.hasPreviousPage,
    endCursor: conn.pageInfo.startCursor,
  }
}
