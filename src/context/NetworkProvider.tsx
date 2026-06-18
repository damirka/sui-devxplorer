import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  NetworkContext,
  DEFAULT_NETWORK,
  NETWORK_STORAGE_KEY,
  CUSTOM_ENDPOINT_STORAGE_KEY,
  isNetwork,
  type Network,
} from './network-context'

const readCustomEndpoint = () =>
  typeof window !== 'undefined'
    ? (localStorage.getItem(CUSTOM_ENDPOINT_STORAGE_KEY) ?? '')
    : ''

/**
 * Network selection is part of the shareable URL (`?network=testnet`). The URL
 * is the source of truth; localStorage only seeds the default for a fresh tab.
 * The `custom` network additionally carries a user-supplied GraphQL URL, kept in
 * localStorage (not the URL — it's usually a private/local endpoint).
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

  const [customEndpoint, setCustomEndpointState] = useState(readCustomEndpoint)

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

  const setCustomEndpoint = useCallback(
    (url: string) => {
      const trimmed = url.trim()
      localStorage.setItem(CUSTOM_ENDPOINT_STORAGE_KEY, trimmed)
      setCustomEndpointState(trimmed)
      setNetwork('custom')
    },
    [setNetwork],
  )

  const value = useMemo(
    () => ({ network, setNetwork, customEndpoint, setCustomEndpoint }),
    [network, setNetwork, customEndpoint, setCustomEndpoint],
  )

  // Switching among the fixed networks refetches via each view's `network`
  // dependency. For `custom`, the endpoint (read from localStorage at request
  // time) isn't a dependency — so remount the subtree when it changes to force a
  // clean reload. Fixed↔fixed switches keep the key `fixed`, staying smooth.
  const subtreeKey = network === 'custom' ? `custom:${customEndpoint}` : 'fixed'

  return (
    <NetworkContext.Provider value={value}>
      <Fragment key={subtreeKey}>{children}</Fragment>
    </NetworkContext.Provider>
  )
}
