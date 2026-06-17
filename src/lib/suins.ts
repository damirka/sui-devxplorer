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

/** Display a domain in `@handle` form, idempotent across input shapes:
 * `0x2.sui` / `@0x2` / `0x2` → `@0x2`. */
export function atName(domain: string): string {
  return '@' + domain.replace(/^@/, '').replace(/\.sui$/i, '')
}
