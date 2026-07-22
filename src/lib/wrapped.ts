/**
 * Wrapper resolution for wrapped UIDs. A UID that lives *inside* another
 * object's struct (a `Table`'s id field, a bare `UID` member, …) is not an
 * object: `object()` is null and `objectVersions` is empty. The chain keeps no
 * wrapping index either — the only trace is the transaction that touched the id
 * (`affectedObject` records every id in a tx's effects, including ids created
 * already wrapped, which never materialize as objects at all).
 *
 * So the wrapper is found forensically, in two steps:
 *  1. scan the affecting tx's changed objects and deep-search each one's
 *     flattened contents JSON for the id — the object containing it is the
 *     wrapper;
 *  2. re-fetch that wrapper at its *latest* version and search again, to verify
 *     the id is still held there (it may since have been moved or deleted).
 *
 * The declared Move type at the found path (e.g. `0x2::table::Table<K, V>`)
 * comes from walking the wrapper's concrete type layout along the JSON path.
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'
import type { ObjectOwner } from './object'

/** A path into a contents JSON tree: object keys and array indices. */
export type JsonPath = (string | number)[]

/** Every path in `json` whose leaf string equals `target` (case-insensitive —
 *  addresses in contents JSON are lowercase, the searched id may not be). */
export function deepFindPaths(json: unknown, target: string): JsonPath[] {
  const t = target.toLowerCase()
  const out: JsonPath[] = []
  const walk = (v: unknown, path: JsonPath) => {
    if (typeof v === 'string') {
      if (v.toLowerCase() === t) out.push([...path])
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...path, i]))
      return
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, [...path, k])
    }
  }
  walk(json, [])
  return out
}

/** Prefer the match that is a real UID field: contents JSON flattens a
 *  `UID` to a string under its field name — for containers (`Table`, `Bag`,
 *  `ObjectBag`, …) that name is `id`. A path NOT ending in `id` is more likely
 *  an `ID`/`address` *reference* to the object than the wrapped UID itself. */
export function bestPath(paths: JsonPath[]): JsonPath | null {
  return paths.find((p) => p[p.length - 1] === 'id') ?? paths[0] ?? null
}

/** Render a path for display, dropping a trailing `id` segment (the UID field
 *  itself) so it reads as the *container* field: `value.queue.withdrawal_txns`. */
export function describePath(path: JsonPath): string {
  const trimmed = path[path.length - 1] === 'id' ? path.slice(0, -1) : path
  return trimmed.map((s) => (typeof s === 'number' ? `[${s}]` : s)).join('.')
}

/* ───────────────────────────── layout walking ──────────────────────────── */

// `MoveType.layout` — a recursive description of a concrete type's runtime
// shape. Structs carry their full type repr; vectors nest; primitives are
// plain strings ("address", "u64", …). Enums exist in the schema too but the
// walk bails on them (their JSON uses `@variant` keys that don't map back).
type MoveLayout =
  | string
  | { struct: { type: string; fields: { name: string; layout: MoveLayout }[] } }
  | { vector: MoveLayout }
  | Record<string, unknown>

function isStruct(
  l: MoveLayout,
): l is { struct: { type: string; fields: { name: string; layout: MoveLayout }[] } } {
  return typeof l === 'object' && l != null && 'struct' in l
}

function isVector(l: MoveLayout): l is { vector: MoveLayout } {
  return typeof l === 'object' && l != null && 'vector' in l
}

/** Struct type repr at a layout node, `null` for primitives/vectors/enums. */
function structType(l: MoveLayout | null): string | null {
  return l != null && isStruct(l) ? l.struct.type : null
}

// Contents JSON flattens some wrappers that the layout keeps (`Option<T>` drops
// its `vec` + index, `String` drops `bytes`, …), so a JSON path segment may sit
// one or more layout levels deeper. When a segment doesn't match, descend
// through single-field structs / vector elements a few hops before giving up.
const BRIDGE_HOPS = 3

/** Walk `layout` along a JSON `path`, returning the layout node at each step
 *  (index 0 = the root). `null` entries mark steps that couldn't be resolved —
 *  everything after the first `null` is `null` too. */
export function walkLayout(layout: MoveLayout, path: JsonPath): (MoveLayout | null)[] {
  const nodes: (MoveLayout | null)[] = [layout]
  let cur: MoveLayout | null = layout
  for (const seg of path) {
    cur = step(cur, seg)
    nodes.push(cur)
  }
  return nodes
}

function step(layout: MoveLayout | null, seg: string | number): MoveLayout | null {
  let cur = layout
  for (let hop = 0; cur != null && hop <= BRIDGE_HOPS; hop++) {
    if (typeof seg === 'number') {
      if (isVector(cur)) return cur.vector
    } else if (isStruct(cur)) {
      const f = cur.struct.fields.find((x) => x.name === seg)
      if (f) return f.layout
    }
    // Bridge one flattened level: a single-field struct or a vector element.
    if (isStruct(cur) && cur.struct.fields.length === 1) {
      cur = cur.struct.fields[0].layout
    } else if (isVector(cur)) {
      cur = cur.vector
    } else {
      return null
    }
  }
  return null
}

const UID_TYPE = /::object::UID$/
const ID_TYPE = /::object::ID$/

/** What the matched path points at, resolved against the wrapper's layout. */
export interface PathTypeInfo {
  /** Declared type of the container struct holding the UID (the path's parent —
   *  e.g. `0x2::table::Table<K, V>`), or `0x2::object::UID` for a bare UID
   *  field directly on the wrapper. `null` when the layout walk failed. */
  containerType: string | null
  /** `uid` = the path is a real embedded UID; `reference` = it's an
   *  `ID`/`address` field merely *pointing* at the id; `unknown` = unresolved. */
  kind: 'uid' | 'reference' | 'unknown'
}

/** Resolve the declared type at a matched JSON path via the wrapper's layout. */
export function pathTypeInfo(layout: MoveLayout | null, path: JsonPath): PathTypeInfo {
  if (layout == null || path.length === 0) return { containerType: null, kind: 'unknown' }
  const nodes = walkLayout(layout, path)
  const leaf = nodes[nodes.length - 1]
  if (leaf == null) return { containerType: null, kind: 'unknown' }

  const leafStruct = structType(leaf)
  if (leafStruct != null && ID_TYPE.test(leafStruct)) {
    return { containerType: null, kind: 'reference' }
  }
  const isUid =
    (leafStruct != null && UID_TYPE.test(leafStruct)) ||
    // A UID flattened to `address` shouldn't happen (layout keeps the struct),
    // but a plain `address` leaf is a reference either way.
    leaf === 'address'
  if (leaf === 'address') return { containerType: null, kind: 'reference' }
  if (!isUid) return { containerType: null, kind: 'unknown' }

  // The container is the nearest enclosing struct — usually the direct parent
  // (`Table`/`Bag`/…), or the wrapper itself for a bare `uid: UID` member, in
  // which case the wrapped thing is just the UID.
  const parent = path.length >= 2 ? structType(nodes[nodes.length - 2]) : null
  const root = structType(nodes[0])
  const containerType =
    parent != null && parent !== root ? parent : '0x2::object::UID'
  return { containerType, kind: 'uid' }
}

/* ─────────────────────────────── queries ───────────────────────────────── */

const OWNER_FRAGMENT = `
      __typename
      ... on AddressOwner { owner: address { address } }
      ... on ObjectOwner { owner: address { address } }
      ... on ConsensusAddressOwner { startVersion owner: address { address } }
      ... on Shared { initialSharedVersion }`

// The changed objects of the tx being scanned, with each output's full contents
// JSON (the haystack the wrapped id is searched in). Output-only: an object
// whose output is null was itself removed/wrapped and can't be the wrapper.
const TX_CHANGES_QUERY = `
query WrapperScan($digest: String!, $after: String) {
  transaction(digest: $digest) {
    effects {
      objectChanges(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          address
          outputState {
            version
            owner {${OWNER_FRAGMENT}
            }
            asMoveObject { contents { type { repr } json } }
          }
        }
      }
    }
  }
}
`

// The candidate wrapper's *current* state, to verify the id is still inside.
const WRAPPER_STATE_QUERY = `
query WrapperState($address: SuiAddress!) {
  object(address: $address) {
    version
    owner {${OWNER_FRAGMENT}
    }
    asMoveObject { contents { type { repr } json } }
  }
}
`

// The wrapper's concrete type layout, for resolving the declared type at the
// matched path. Fetched by type repr (not from the object) so it still works
// when the wrapper itself is no longer live.
const TYPE_LAYOUT_QUERY = `
query TypeLayout($type: String!) {
  type(type: $type) { layout }
}
`

// Effects pages scanned before giving up. 4 × 50 changed objects covers all but
// pathological transactions; past that the wrapper is reported as not found.
const MAX_SCAN_PAGES = 4

interface ScanNode {
  address: string
  outputState: {
    version: number | null
    owner: ObjectOwner | null
    asMoveObject: { contents: { type: { repr: string }; json: unknown } | null } | null
  } | null
}

interface ScanPageResult {
  transaction: {
    effects: {
      objectChanges: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ScanNode[]
      }
    }
  } | null
}

/** The wrapper object found holding a wrapped id, at the scanned transaction. */
export interface WrapperMatch {
  address: string
  /** The wrapper's concrete type repr. */
  type: string | null
  /** The wrapper's output version in the scanned tx. */
  version: number | null
  /** The wrapper's owner at that version. */
  owner: ObjectOwner | null
  /** JSON path to the id within the wrapper's contents at that version. */
  path: JsonPath
  /** True when the scan couldn't check every changed object (paging cap hit). */
  truncated: boolean
}

/** Scan a transaction's changed objects for the one whose output contents embed
 *  `wrappedId`. `null` when no changed object contains it (or the scan hit the
 *  paging cap without a match — `truncated` can't be told apart then). */
async function scanTxForWrapper(
  network: Network,
  digest: string,
  wrappedId: string,
  signal?: AbortSignal,
): Promise<WrapperMatch | null> {
  const candidates: { node: ScanNode; paths: JsonPath[] }[] = []
  let after: string | null = null
  let truncated = false
  for (let page = 0; ; page++) {
    if (page >= MAX_SCAN_PAGES) {
      truncated = true
      break
    }
    // The annotation breaks a type-inference cycle: `after` is assigned from
    // this response, so passing it inline makes `data`'s type circular (TS7022).
    const vars: Record<string, unknown> = { digest, after }
    const { data } = await gqlRequest<ScanPageResult>(
      network,
      TX_CHANGES_QUERY,
      vars,
      signal,
    )
    const conn = data.transaction?.effects.objectChanges
    if (!conn) break
    for (const node of conn.nodes) {
      if (node.address === wrappedId) continue
      const json = node.outputState?.asMoveObject?.contents?.json
      if (json == null) continue
      const paths = deepFindPaths(json, wrappedId)
      if (paths.length > 0) candidates.push({ node, paths })
    }
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }

  // Prefer a candidate holding a real UID field (path ending in `id`) over one
  // that merely references the id.
  const pick =
    candidates.find((c) => c.paths.some((p) => p[p.length - 1] === 'id')) ??
    candidates[0]
  if (!pick) return null
  const out = pick.node.outputState
  return {
    address: pick.node.address,
    type: out?.asMoveObject?.contents?.type.repr ?? null,
    version: out?.version ?? null,
    owner: out?.owner ?? null,
    path: bestPath(pick.paths)!,
    truncated,
  }
}

/** Where the wrapped id stands against the wrapper's LATEST contents. */
export type WrappedCurrent =
  | {
      state: 'present'
      version: number | null
      owner: ObjectOwner | null
      path: JsonPath
    }
  /** The wrapper is live but its current contents no longer embed the id. */
  | { state: 'absent'; version: number | null }
  /** The wrapper object itself is gone from the live set (deleted or wrapped
   *  in turn) — the id's current location can't be verified. */
  | { state: 'wrapper-gone' }
  /** No wrapper was found to validate against. */
  | { state: 'unknown' }

export interface WrappedInfo {
  /** The transaction whose changed objects were scanned. */
  scannedTx: string
  wrapper: WrapperMatch | null
  /** Declared type at the matched path (see {@link PathTypeInfo}). */
  containerType: string | null
  kind: PathTypeInfo['kind']
  current: WrappedCurrent
}

/**
 * Full wrapper resolution for a wrapped id: scan `txDigest`'s changed objects
 * for the wrapper (step 1), then re-check the wrapper's latest contents to
 * verify the id is still held there (step 2), resolving the declared Move type
 * at the matched path from the wrapper's type layout. For a born-wrapped UID
 * pass the id's creating tx; for an object wrapped later, the removing tx.
 */
export async function fetchWrappedInfo(
  network: Network,
  wrappedId: string,
  txDigest: string,
  signal?: AbortSignal,
): Promise<WrappedInfo> {
  const wrapper = await scanTxForWrapper(network, txDigest, wrappedId, signal)
  if (!wrapper) {
    return {
      scannedTx: txDigest,
      wrapper: null,
      containerType: null,
      kind: 'unknown',
      current: { state: 'unknown' },
    }
  }

  // Current wrapper state + type layout, in parallel. Both are best-effort —
  // a failure downgrades the answer rather than failing the whole view.
  const [state, layout] = await Promise.all([
    gqlRequest<{
      object: {
        version: number | null
        owner: ObjectOwner | null
        asMoveObject: { contents: { type: { repr: string }; json: unknown } | null } | null
      } | null
    }>(network, WRAPPER_STATE_QUERY, { address: wrapper.address }, signal).then(
      (r) => r.data.object,
      () => undefined,
    ),
    wrapper.type
      ? gqlRequest<{ type: { layout: unknown } | null }>(
          network,
          TYPE_LAYOUT_QUERY,
          { type: wrapper.type },
          signal,
        ).then(
          (r) => (r.data.type?.layout ?? null) as MoveLayout | null,
          () => null,
        )
      : Promise.resolve(null),
  ])

  let current: WrappedCurrent
  let typePath = wrapper.path
  if (state === undefined) {
    current = { state: 'unknown' }
  } else if (state === null) {
    current = { state: 'wrapper-gone' }
  } else {
    const json = state.asMoveObject?.contents?.json
    const path = bestPath(deepFindPaths(json, wrappedId))
    if (path) {
      current = {
        state: 'present',
        version: state.version,
        owner: state.owner,
        path,
      }
      typePath = path
    } else {
      current = { state: 'absent', version: state.version }
    }
  }

  const info = pathTypeInfo(layout, typePath)
  return {
    scannedTx: txDigest,
    wrapper,
    containerType: info.containerType,
    kind: info.kind,
    current,
  }
}
