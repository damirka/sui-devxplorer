/**
 * The Walrus epoch clock as a hook: every component that dates an epoch or
 * shows capacity reads it here, so the memoised fetch in `epochs.ts` is the
 * one request behind them all. `enabled: false` skips the fetch — a blob from
 * a retired deployment has no clock to read.
 */
import type { Network } from '@/context/network-context'
import { useAsync } from '@/lib/useAsync'
import { fetchWalrusState, type WalrusState } from './epochs'

export function useWalrusState(
  network: Network,
  enabled = true,
): { state: WalrusState | null; loading: boolean } {
  const { data, loading } = useAsync(
    () => (enabled ? fetchWalrusState(network) : Promise.resolve(null)),
    [network, enabled],
  )
  return { state: data ?? null, loading }
}
