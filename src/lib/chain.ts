/**
 * Chain-level metadata over Sui GraphQL — values that describe the network as a
 * whole rather than any one object/tx (the current epoch and protocol version).
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'

export interface ChainStatus {
  /** The current epoch number, or `null` if unavailable. */
  epoch: number | null
  /** The protocol version the network is currently running, or `null`. */
  protocolVersion: number | null
}

// No-arg `epoch` / `protocolConfigs` resolve to the *current* ones. We read only
// the epoch number and version — the lightest selections, not the full config.
const CHAIN_STATUS_QUERY = `
query ChainStatus {
  epoch { epochId }
  protocolConfigs { protocolVersion }
}
`

/** The network's current epoch + protocol version. Both change slowly (epoch
 *  ~daily, protocol only at an upgrade), so callers fetch once per network rather
 *  than polling. */
export async function fetchChainStatus(
  network: Network,
  signal?: AbortSignal,
): Promise<ChainStatus> {
  const { data } = await gqlRequest<{
    epoch: { epochId: number } | null
    protocolConfigs: { protocolVersion: number | null } | null
  }>(network, CHAIN_STATUS_QUERY, {}, signal)
  return {
    epoch: data.epoch?.epochId ?? null,
    protocolVersion: data.protocolConfigs?.protocolVersion ?? null,
  }
}
