/**
 * A tiny localStorage cache for per-network data that only changes at an epoch
 * boundary — the validator committee and its names / pool ids / base metadata
 * (the set turns over once per epoch, ~daily). Each entry carries an absolute
 * `expiresAt` (the scheduled next-epoch time = epoch start + duration), so it
 * self-invalidates the moment the epoch rolls over.
 *
 * Best-effort and side-effect-free on failure: any storage-disabled / quota /
 * JSON error is swallowed and the caller just does a live fetch. Values must be
 * JSON-serialisable (no `bigint` / `Map` — serialise those to arrays first).
 */
import type { Network } from '@/context/network-context'

interface CacheEntry<T> {
  data: T
  /** Epoch-ms after which the entry is stale (next-epoch boundary). */
  expiresAt: number
}

const keyFor = (name: string, network: Network) => `devx:cache:${name}:${network}`

/** The cached value for `name` on `network`, or `null` when absent, expired, or
 *  unreadable. Expired entries are evicted on read. */
export function readEpochCache<T>(name: string, network: Network): T | null {
  try {
    const raw = localStorage.getItem(keyFor(name, network))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (typeof entry?.expiresAt !== 'number' || Date.now() >= entry.expiresAt) {
      localStorage.removeItem(keyFor(name, network))
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

/** Cache `data` for `name` on `network` until `expiresAt` (epoch-ms). A non-finite
 *  `expiresAt` (e.g. an epoch boundary we couldn't derive) skips the write. */
export function writeEpochCache<T>(
  name: string,
  network: Network,
  data: T,
  expiresAt: number,
): void {
  if (!Number.isFinite(expiresAt)) return
  try {
    localStorage.setItem(keyFor(name, network), JSON.stringify({ data, expiresAt }))
  } catch {
    /* storage full / disabled — fine, we refetch next time */
  }
}
