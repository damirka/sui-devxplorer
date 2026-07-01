/**
 * SuiNS name resolution over Sui GraphQL. Forward: `nameRecord(name)` accepts
 * both `@handle` and `handle.sui` and exposes the registered `target` address.
 * Reverse: an `Address.defaultNameRecord` gives the address's display name.
 */
import { gqlRequest } from './graphql'
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
