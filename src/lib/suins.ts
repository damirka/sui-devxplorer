/**
 * SuiNS name resolution over Sui GraphQL. Forward: `nameRecord(name)` accepts
 * both `@handle` and `handle.sui` and exposes the registered `target` address.
 * Reverse: an `Address.defaultNameRecord` gives the address's display name.
 */
import { endpointFor, gqlRequest } from './graphql'
import { normalizeSuiId } from './search'
import type { Network } from '@/context/network-context'

const RESOLVE_QUERY = `
query ResolveSuins($name: String!) {
  nameRecord(name: $name) {
    domain
    target { address }
  }
}
`

export interface SuinsResolution {
  /** Canonical domain (always `handle.sui` form, even when queried as `@h`). */
  domain: string
  /** The address the name points at. */
  address: string
}

/** Resolve a SuiNS name to its target address. `null` when the name isn't
 * registered or has no target set. */
export async function resolveSuinsName(
  network: Network,
  name: string,
  signal?: AbortSignal,
): Promise<SuinsResolution | null> {
  const { data } = await gqlRequest<{
    nameRecord: { domain: string; target: { address: string } | null } | null
  }>(network, RESOLVE_QUERY, { name }, signal)
  const rec = data.nameRecord
  if (!rec?.target) return null
  return { domain: rec.domain, address: rec.target.address }
}

const DEFAULT_NAME_QUERY = `
query DefaultSuins($address: SuiAddress!) {
  address(address: $address) {
    defaultNameRecord { domain }
  }
}
`

/** The default SuiNS name for an address (reverse lookup), or `null`. */
export async function fetchDefaultSuinsName(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { data } = await gqlRequest<{
    address: { defaultNameRecord: { domain: string } | null } | null
  }>(network, DEFAULT_NAME_QUERY, { address }, signal)
  return data.address?.defaultNameRecord?.domain ?? null
}

/**
 * The SuiNS registration NFT, as a Move Registry *type* name. Pinned to `/1`
 * because `SuinsRegistration` is defined in SuiNS Core V1 — the unversioned
 * `@suins/core` is a facade the type filter wouldn't match. Resolve it through
 * `resolveMvrType` for the network's actual on-chain type.
 */
export const SUINS_REGISTRATION_MVR = '@suins/core/1::suins_registration::SuinsRegistration'

/** Does a type repr name a SuiNS registration? Matched by `module::struct`, so the
 *  per-network / upgraded package id still counts. A cheap gate before the strict
 *  MVR-resolved equality check (which is the actual verdict). */
export function isSuinsType(repr: string | null | undefined): boolean {
  return !!repr && /::suins_registration::SuinsRegistration$/.test(repr)
}

/** Display a domain in `@handle` form, idempotent across input shapes:
 * `0x2.sui` / `@0x2` / `0x2` → `@0x2`. */
export function atName(domain: string): string {
  return '@' + domain.replace(/^@/, '').replace(/\.sui$/i, '')
}

/** A SuiNS registration the owner holds: the NFT id, its `.sui` domain, and its
 *  expiry (epoch-ms). */
export interface OwnedSuinsName {
  address: string
  domain: string | null
  expirationMs: number | null
}

const OWNED_SUINS_QUERY = `
query OwnedSuins($address: SuiAddress!, $type: String!, $first: Int, $after: String) {
  address(address: $address) {
    objects(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes { address contents { json } }
    }
  }
}
`

/**
 * Every SuiNS registration of `type` owned by `ownerId`, sorted by expiry
 * ascending (soonest first; undated last). Reads each NFT's `domain_name` +
 * `expiration_timestamp_ms` from its Move contents, paging through the full set
 * (names per owner are bounded) so the sort is global rather than per-page.
 */
/** One page of owned SuiNS registrations (shaped), plus the next cursor. */
async function fetchOwnedSuinsPage(
  network: Network,
  ownerId: string,
  type: string,
  after: string | null,
  signal?: AbortSignal,
): Promise<{ items: OwnedSuinsName[]; hasNextPage: boolean; endCursor: string | null }> {
  const { data } = await gqlRequest<{
    address: {
      objects: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { address: string; contents: { json: unknown } | null }[]
      }
    } | null
  }>(network, OWNED_SUINS_QUERY, { address: ownerId, type, first: 50, after }, signal)
  const conn = data.address?.objects
  if (!conn) return { items: [], hasNextPage: false, endCursor: null }
  const items = conn.nodes.map((n) => {
    const j = (n.contents?.json ?? {}) as {
      domain_name?: unknown
      expiration_timestamp_ms?: unknown
    }
    const raw = j.expiration_timestamp_ms
    const ms = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
    return {
      address: n.address,
      domain: typeof j.domain_name === 'string' ? j.domain_name : null,
      expirationMs: Number.isFinite(ms) ? ms : null,
    }
  })
  return { items, hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor }
}

export async function fetchOwnedSuinsNames(
  network: Network,
  ownerId: string,
  type: string,
  signal?: AbortSignal,
): Promise<OwnedSuinsName[]> {
  const out: OwnedSuinsName[] = []
  let after: string | null = null
  for (;;) {
    const page = await fetchOwnedSuinsPage(network, ownerId, type, after, signal)
    out.push(...page.items)
    if (!page.hasNextPage) break
    after = page.endCursor
  }
  return out.sort(
    (a, b) =>
      (a.expirationMs ?? Infinity) - (b.expirationMs ?? Infinity) ||
      a.address.localeCompare(b.address),
  )
}

/* ────────── default names, batched + cached (the reverse lookup at scale) ────────── */

// Every transaction row wants its sender's default name, so reverse lookups go
// through one shared path: a per-session memo of settled/in-flight promises, a
// localStorage cache that survives reloads (a default name is stable for hours,
// and misses — most addresses have none — are cached too), and micro-batching:
// every address asked for in the same tick goes out as one aliased request.
// List queries that fetch the name inline seed the same cache (`primeSuinsNames`).
const NAME_CACHE_KEY = 'suins-names:v1'
const NAME_TTL_MS = 6 * 60 * 60 * 1000
const NAME_CACHE_MAX = 2_000
const NAME_BATCH_MAX = 50

interface CachedName {
  /** The default domain, or `null` for a known miss. */
  d: string | null
  /** When it was resolved (epoch ms) — for the TTL and eviction order. */
  t: number
}
type NameStore = Record<string, CachedName>

/** Canonical cache key for an address: full-width, lowercase, `0x`-prefixed. */
function canonAddress(address: string): string {
  return normalizeSuiId(address.trim().toLowerCase().replace(/^0x/, ''))
}

// Stores are keyed by endpoint (not network name) so a `custom` endpoint never
// shares names with another, and loaded from localStorage once per session.
const stores = new Map<string, NameStore>()
const memo = new Map<string, Promise<string | null>>()

function storeFor(endpoint: string): NameStore {
  let s = stores.get(endpoint)
  if (!s) {
    try {
      const raw = localStorage.getItem(`${NAME_CACHE_KEY}:${endpoint}`)
      s = raw ? (JSON.parse(raw) as NameStore) : {}
    } catch {
      s = {}
    }
    stores.set(endpoint, s)
  }
  return s
}

// Writes are coalesced: a list fetch primes up to 50 names at once, and the
// serialized store is a few tens of KB — one write per tick, not per name.
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushStores() {
  flushTimer = null
  for (const endpoint of dirty) {
    const s = storeFor(endpoint)
    const keys = Object.keys(s)
    // Bounded: past the cap, evict the oldest entries.
    if (keys.length > NAME_CACHE_MAX) {
      keys.sort((a, b) => s[a].t - s[b].t)
      for (const k of keys.slice(0, keys.length - NAME_CACHE_MAX)) delete s[k]
    }
    try {
      localStorage.setItem(`${NAME_CACHE_KEY}:${endpoint}`, JSON.stringify(s))
    } catch {
      /* storage unavailable or full — the in-memory copy still serves this session */
    }
  }
  dirty.clear()
}

function remember(endpoint: string, address: string, domain: string | null) {
  storeFor(endpoint)[address] = { d: domain, t: Date.now() }
  memo.set(`${endpoint}|${address}`, Promise.resolve(domain))
  dirty.add(endpoint)
  if (!flushTimer) flushTimer = setTimeout(flushStores, 0)
}

/**
 * Seed the reverse cache with names a list query already fetched inline (a tx
 * list's `sender { defaultNameRecord }`), misses included — so an `AddressLink`
 * for the same address later renders its name instantly instead of re-asking.
 */
export function primeSuinsNames(
  network: Network,
  entries: Iterable<[address: string, domain: string | null]>,
) {
  const endpoint = endpointFor(network)
  for (const [address, domain] of entries) remember(endpoint, canonAddress(address), domain)
}

const DEFAULT_NAMES_ALIAS = 'a'

/**
 * The default SuiNS names of several addresses in one request — an aliased
 * `address(...)` lookup per entry (passed as variables, never spliced into the
 * query). Returns a map keyed by the *given* address strings; `null` for an
 * address with no default name. Keep batches ≤ 50.
 */
export async function fetchDefaultSuinsNames(
  network: Network,
  addresses: string[],
  signal?: AbortSignal,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (addresses.length === 0) return out
  const variables: Record<string, string> = {}
  const decls: string[] = []
  const fields: string[] = []
  addresses.forEach((address, i) => {
    const v = `${DEFAULT_NAMES_ALIAS}${i}`
    variables[v] = address
    decls.push(`$${v}: SuiAddress!`)
    fields.push(`${v}: address(address: $${v}) { defaultNameRecord { domain } }`)
  })
  const query = `query DefaultSuinsNames(${decls.join(', ')}) { ${fields.join(' ')} }`
  const { data } = await gqlRequest<
    Record<string, { defaultNameRecord: { domain: string } | null } | null>
  >(network, query, variables, signal)
  addresses.forEach((address, i) => {
    out.set(address, data[`${DEFAULT_NAMES_ALIAS}${i}`]?.defaultNameRecord?.domain ?? null)
  })
  return out
}

// Addresses awaiting resolution, per network, drained as one batch per tick.
const queues = new Map<Network, Map<string, (domain: string | null) => void>>()
let batchTimer: ReturnType<typeof setTimeout> | null = null

function drainQueues() {
  batchTimer = null
  const pending = [...queues]
  queues.clear()
  for (const [network, queue] of pending) {
    const entries = [...queue]
    for (let i = 0; i < entries.length; i += NAME_BATCH_MAX) {
      void resolveBatch(network, entries.slice(i, i + NAME_BATCH_MAX))
    }
  }
}

async function resolveBatch(
  network: Network,
  entries: [address: string, resolve: (domain: string | null) => void][],
) {
  const endpoint = endpointFor(network)
  try {
    const names = await fetchDefaultSuinsNames(
      network,
      entries.map(([address]) => address),
    )
    for (const [address, resolve] of entries) {
      const domain = names.get(address) ?? null
      remember(endpoint, address, domain)
      resolve(domain)
    }
  } catch {
    // A failed batch reads as "no name" for now and is forgotten, so the next
    // mount retries instead of pinning a transient error for the whole session.
    for (const [address, resolve] of entries) {
      memo.delete(`${endpoint}|${address}`)
      resolve(null)
    }
  }
}

/**
 * The default SuiNS name of `address` (its `.sui` domain), or `null` — via the
 * session memo, then the localStorage cache (fresh within the TTL), then a
 * batched lookup shared with every other address requested in the same tick.
 * Never rejects: a lookup failure resolves `null`.
 */
export function defaultSuinsNameCached(
  network: Network,
  address: string,
): Promise<string | null> {
  const endpoint = endpointFor(network)
  const addr = canonAddress(address)
  const key = `${endpoint}|${addr}`
  const hit = memo.get(key)
  if (hit) return hit

  const cached = storeFor(endpoint)[addr]
  if (cached && Date.now() - cached.t < NAME_TTL_MS) {
    const p = Promise.resolve(cached.d)
    memo.set(key, p)
    return p
  }

  const p = new Promise<string | null>((resolve) => {
    let queue = queues.get(network)
    if (!queue) {
      queue = new Map()
      queues.set(network, queue)
    }
    queue.set(addr, resolve)
    if (!batchTimer) batchTimer = setTimeout(drainQueues, 0)
  })
  memo.set(key, p)
  return p
}
