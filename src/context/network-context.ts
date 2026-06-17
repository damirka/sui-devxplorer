import { createContext } from 'react'

export const NETWORKS = ['mainnet', 'testnet', 'devnet'] as const
export type Network = (typeof NETWORKS)[number]

export const DEFAULT_NETWORK: Network = 'mainnet'
export const NETWORK_STORAGE_KEY = 'devx:network'

export function isNetwork(value: string | null | undefined): value is Network {
  return !!value && (NETWORKS as readonly string[]).includes(value)
}

export interface NetworkContextValue {
  network: Network
  setNetwork: (network: Network) => void
}

export const NetworkContext = createContext<NetworkContextValue | null>(null)
