import { useCallback, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  NetworkContext,
  DEFAULT_NETWORK,
  NETWORK_STORAGE_KEY,
  isNetwork,
  type Network,
} from './network-context'

/**
 * Network selection is part of the shareable URL (`?network=testnet`). The URL
 * is the source of truth; localStorage only seeds the default for a fresh tab.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const fromUrl = searchParams.get('network')
  const stored =
    typeof window !== 'undefined'
      ? localStorage.getItem(NETWORK_STORAGE_KEY)
      : null

  const network: Network = isNetwork(fromUrl)
    ? fromUrl
    : isNetwork(stored)
      ? stored
      : DEFAULT_NETWORK

  const setNetwork = useCallback(
    (next: Network) => {
      localStorage.setItem(NETWORK_STORAGE_KEY, next)
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next === DEFAULT_NETWORK) params.delete('network')
          else params.set('network', next)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const value = useMemo(() => ({ network, setNetwork }), [network, setNetwork])

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  )
}
