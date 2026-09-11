import { createContext } from 'react'
import { storedString, storedText } from '@/lib/storage'

/** The built-in Sui networks, each with a fixed public GraphQL endpoint. */
export const NETWORKS = ['mainnet', 'testnet', 'devnet'] as const
export type FixedNetwork = (typeof NETWORKS)[number]

/** Plus `custom`: a user-supplied GraphQL endpoint (e.g. a local node). */
export type Network = FixedNetwork | 'custom'

const ALL_NETWORKS: readonly Network[] = [...NETWORKS, 'custom']

export const DEFAULT_NETWORK: Network = 'mainnet'
export const NETWORK_STORAGE_KEY = 'devx:network'
export const CUSTOM_ENDPOINT_STORAGE_KEY = 'devx:custom-graphql'

export function isNetwork(value: string | null | undefined): value is Network {
  return !!value && (ALL_NETWORKS as readonly string[]).includes(value)
}

/** The network a fresh tab starts on (the last one picked). */
export const networkKey = storedString<Network>(NETWORK_STORAGE_KEY, isNetwork)
/** The user-supplied GraphQL URL behind the `custom` network. */
export const customEndpointKey = storedText(CUSTOM_ENDPOINT_STORAGE_KEY)

export interface NetworkContextValue {
  network: Network
  setNetwork: (network: Network) => void
  /** The GraphQL URL used when `network === 'custom'` (empty if unset). */
  customEndpoint: string
  /** Save the custom GraphQL URL and switch to the `custom` network. */
  setCustomEndpoint: (url: string) => void
}

export const NetworkContext = createContext<NetworkContextValue | null>(null)
