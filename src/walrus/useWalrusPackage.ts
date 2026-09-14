/**
 * Is this package page a version of the Walrus package? Every version is its
 * own immutable object, and only the original id is in the registry — so the
 * answer comes from the on-chain upgrade chain: `fetchPackageVersions`
 * (memoised, shared with the page's Versions panel) contains the original id
 * or it doesn't. Null until known, and for anything that isn't Walrus.
 */
import type { Network } from '@/context/network-context'
import { fetchPackageVersions } from '@/lib/object'
import { useAsync } from '@/lib/useAsync'
import { walrusDeployment } from './registry'

export interface WalrusPackageInfo {
  /** This id's version in the chain. */
  version: number
  latestVersion: number
}

export function useWalrusPackage(network: Network, id: string, enabled: boolean): WalrusPackageInfo | null {
  const original = walrusDeployment(network)?.packageId ?? null
  const { data } = useAsync(
    () => (enabled && original ? fetchPackageVersions(network, id) : Promise.resolve([])),
    [network, id, enabled, original],
  )
  if (!data || !original || !data.some((v) => v.address === original)) return null
  const here = data.find((v) => v.address === id)
  return here ? { version: here.version, latestVersion: data[data.length - 1].version } : null
}
