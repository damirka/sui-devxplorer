/**
 * Chain-level metadata over Sui GraphQL — the current epoch, protocol version, and
 * the scheduled next-epoch boundary.
 */
import { gqlRequest } from './graphql'
import type { Network } from '@/context/network-context'

export interface ChainStatus {
  /** The current epoch number, or `null`. */
  epoch: number | null
  /** The protocol version the network is currently running, or `null`. */
  protocolVersion: number | null
  /** The scheduled next-epoch boundary (epoch-ms) = on-chain epoch start +
   *  protocol epoch duration. Read from the system state, so it's the protocol-
   *  scheduled time — the actual transition can still drift a second or two.
   *  `null` when unavailable. */
  nextEpochMs: number | null
}

// `systemState.extract(path:)` pulls a single value out of the (large) system
// state without fetching the whole blob — so the scheduled epoch boundary costs
// ~200 bytes instead of ~290 KB. u64s come back as numeric strings.
const CHAIN_STATUS_QUERY = `
query ChainStatus {
  epoch {
    epochId
    protocolConfigs { protocolVersion }
    systemState {
      epochStartMs: extract(path: "epoch_start_timestamp_ms") { json }
      epochDurationMs: extract(path: "parameters.epoch_duration_ms") { json }
    }
  }
}
`

/** The network's current epoch + protocol version + scheduled next-epoch time.
 *  Everything changes slowly (epoch ~daily, protocol only at an upgrade), so
 *  callers poll on a long interval rather than fast. */
export async function fetchChainStatus(
  network: Network,
  signal?: AbortSignal,
): Promise<ChainStatus> {
  const { data } = await gqlRequest<{
    epoch: {
      epochId: number
      protocolConfigs: { protocolVersion: number | null } | null
      systemState: {
        epochStartMs: { json: unknown } | null
        epochDurationMs: { json: unknown } | null
      } | null
    } | null
  }>(network, CHAIN_STATUS_QUERY, {}, signal)

  const e = data.epoch
  const startRaw = e?.systemState?.epochStartMs?.json
  const durationRaw = e?.systemState?.epochDurationMs?.json
  const start = startRaw != null ? Number(startRaw) : NaN
  const duration = durationRaw != null ? Number(durationRaw) : NaN
  const nextEpochMs =
    Number.isFinite(start) && Number.isFinite(duration) ? start + duration : null

  return {
    epoch: e?.epochId ?? null,
    protocolVersion: e?.protocolConfigs?.protocolVersion ?? null,
    nextEpochMs,
  }
}
