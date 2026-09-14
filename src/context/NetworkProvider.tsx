import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  NetworkContext,
  DEFAULT_NETWORK,
  customEndpointKey,
  isNetwork,
  networkKey,
  type Network,
} from './network-context'

const readCustomEndpoint = () => customEndpointKey.read() ?? ''

/** The URL rule: a result page (`?search=`) names its network; the landing
 *  page doesn't. */
function withNetworkParam(prev: URLSearchParams, network: Network): URLSearchParams {
  const params = new URLSearchParams(prev)
  if (params.has('search')) params.set('network', network)
  else params.delete('network')
  return params
}

/**
 * Network selection is part of the shareable URL (`?network=`). The URL is the
 * source of truth; localStorage only seeds the default for a fresh tab. Every
 * result page carries the network explicitly — mainnet included — so a copied
 * link opens on the network it was viewed on regardless of the reader's last
 * pick; only the landing page (no `?search=`) goes without. The `custom`
 * network additionally carries a user-supplied GraphQL URL, kept in
 * localStorage (not the URL — it's usually a private/local endpoint).
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const fromUrl = searchParams.get('network')
  const network: Network = isNetwork(fromUrl)
    ? fromUrl
    : (networkKey.read() ?? DEFAULT_NETWORK)

  const [customEndpoint, setCustomEndpointState] = useState(readCustomEndpoint)

  const setNetwork = useCallback(
    (next: Network) => {
      networkKey.write(next)
      setSearchParams((prev) => withNetworkParam(prev, next), { replace: true })
    },
    [setSearchParams],
  )

  // Normalise the URL to the rule above: a result page always names its
  // network (a link built without one, or a hand-typed `?search=`, gets the
  // active network written in); the landing page never does — its network is
  // the stored pick, so a `?network=` arriving there is persisted before it's
  // dropped, and the selection survives. `replace`, so the fix-up leaves no
  // history entry.
  const hasSearch = searchParams.has('search')
  useEffect(() => {
    if (hasSearch ? fromUrl === network : fromUrl == null) return
    if (!hasSearch) networkKey.write(network)
    setSearchParams((prev) => withNetworkParam(prev, network), { replace: true })
  }, [hasSearch, fromUrl, network, setSearchParams])

  const setCustomEndpoint = useCallback(
    (url: string) => {
      const trimmed = url.trim()
      customEndpointKey.write(trimmed)
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
