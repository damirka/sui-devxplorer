import { useSyncExternalStore } from 'react'
import type { Network } from '@/context/network-context'
import { formatAddress, formatType } from './format'
import { detectSearchKind, truncateMiddle, type SearchKind } from './search'

/**
 * Bookmarks: per-browser, per-network lists of explorer pages worth coming back
 * to, kept in localStorage (no backend) under `devx:bookmarks:<network>`. A
 * page is identified the way the app is driven — by its query params: `search`
 * plus any view pins (`version`, `vtab`, `validator`, `view`) — so a bookmark
 * reopens exactly the view that was marked. The network is not part of a
 * bookmark: each network keeps its own list, and only the current network's
 * list is ever shown.
 *
 * The lists are a tiny external store (`useSyncExternalStore`): one cached
 * array per network, written through to localStorage on every change and
 * re-read on cross-tab `storage` events, so several tabs stay in step. Actions
 * are plain functions — import them where needed; `useBookmarks(network)` is
 * the live read.
 */

export const BOOKMARKS_STORAGE_PREFIX = 'devx:bookmarks:'

/** A page's query params minus `network`: `search` plus any view pins. */
export type PageParams = Record<string, string>

export interface Bookmark {
  /** Stable id — React key + update handle. */
  id: string
  /** User label; empty = unnamed (rows show the target id instead). */
  name: string
  params: PageParams
  /** When it was added: epoch milliseconds (UTC-based, so timezone-free — the
   *  relative age reads right after travelling; the list shows it as `3h ago`). */
  createdAt: number
}

// ─── identity ───────────────────────────────────────────────────────────────

/**
 * Order-independent identity of a page. `search` is compared in its normalized
 * form (`0x2` ≡ `0x000…0002`, `vals` ≡ `validators`) so the same page reached by
 * different spellings maps onto one bookmark.
 */
export function pageKey(params: PageParams): string {
  return Object.entries(params)
    .map(([k, v]) => [k, k === 'search' ? detectSearchKind(v).value : v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/** The bookmarkable params of the current URL, or `null` on the landing page. */
export function pageParams(searchParams: URLSearchParams): PageParams | null {
  const search = searchParams.get('search')?.trim()
  if (!search) return null
  const params: PageParams = {}
  for (const [k, v] of searchParams) {
    if (k !== 'network' && v) params[k] = v
  }
  params.search = search
  return params
}

export function findBookmark(
  bookmarks: readonly Bookmark[],
  params: PageParams,
): Bookmark | undefined {
  const key = pageKey(params)
  return bookmarks.find((b) => pageKey(b.params) === key)
}

// ─── display ────────────────────────────────────────────────────────────────

/** Short kind tag for a bookmark row. `package` covers any `::` Move path
 *  (module, type or function), hence the neutral `move`. */
export const KIND_TAG: Record<SearchKind, string> = {
  address: 'address',
  object: 'object',
  transaction: 'tx',
  package: 'move',
  suins: 'suins',
  mvr: 'mvr',
  checkpoints: 'checkpoints',
  validators: 'validators',
  unknown: '?',
}

export function bookmarkKind(params: PageParams): SearchKind {
  return detectSearchKind(params.search).kind
}

/**
 * The name to suggest for a page (the popup's placeholder; used as-is on a bare
 * ↵). For a Move path the addresses are what you *don't* want to read in a
 * label, so `0xabc…::usdc::USDC` suggests `usdc::USDC` — generics included:
 * `0x2::coin::Coin<0xabc…::usdc::USDC>` → `coin::Coin<usdc::USDC>`. Any other
 * id suggests itself (kept as an *unnamed* bookmark when accepted, so the list
 * shows the id once).
 */
export function suggestedName(params: PageParams): string {
  const search = params.search
  return search.includes('::') ? search.replace(/0x[0-9a-fA-F]+::/g, '') : search
}

/**
 * The target id in display form: addresses trimmed (inside Move paths too),
 * long digests middle-truncated, names and keywords as typed.
 */
export function displayTarget(search: string): string {
  if (search.includes('::')) return formatType(search)
  if (/^0x[0-9a-f]+$/i.test(search)) return formatAddress(search)
  if (search.length > 24) return truncateMiddle(search, 8, 6)
  return search
}

// ─── store ──────────────────────────────────────────────────────────────────

const cache = new Map<Network, Bookmark[]>()
const listeners = new Set<() => void>()

function storageKey(network: Network): string {
  return BOOKMARKS_STORAGE_PREFIX + network
}

/** Shape-check one persisted entry — a corrupt or foreign value is dropped. */
function isBookmark(v: unknown): v is Bookmark {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  const params = b.params
  return (
    typeof b.id === 'string' &&
    typeof b.name === 'string' &&
    typeof b.createdAt === 'number' &&
    typeof params === 'object' &&
    params !== null &&
    typeof (params as Record<string, unknown>).search === 'string' &&
    Object.values(params as Record<string, unknown>).every((x) => typeof x === 'string')
  )
}

function load(network: Network): Bookmark[] {
  try {
    const raw = localStorage.getItem(storageKey(network))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isBookmark) : []
  } catch {
    return []
  }
}

function getSnapshot(network: Network): Bookmark[] {
  let list = cache.get(network)
  if (!list) {
    list = load(network)
    cache.set(network, list)
  }
  return list
}

function commit(network: Network, next: Bookmark[]): void {
  cache.set(network, next)
  try {
    localStorage.setItem(storageKey(network), JSON.stringify(next))
  } catch {
    // Quota / private mode: keep the in-memory list for this session.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab wrote a list: drop that cache so the next read reloads it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null) cache.clear()
    else if (e.key.startsWith(BOOKMARKS_STORAGE_PREFIX)) {
      cache.delete(e.key.slice(BOOKMARKS_STORAGE_PREFIX.length) as Network)
    } else return
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The live bookmark list of one network, in insertion order — sort at the
 *  call site. */
export function useBookmarks(network: Network): readonly Bookmark[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(network),
    () => getSnapshot(network),
  )
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function addBookmark(network: Network, params: PageParams, name: string): Bookmark {
  const b: Bookmark = { id: uid(), name, params: { ...params }, createdAt: Date.now() }
  commit(network, [...getSnapshot(network), b])
  return b
}

export function renameBookmark(network: Network, id: string, name: string): void {
  commit(
    network,
    getSnapshot(network).map((b) => (b.id === id ? { ...b, name } : b)),
  )
}

export function removeBookmark(network: Network, id: string): void {
  commit(
    network,
    getSnapshot(network).filter((b) => b.id !== id),
  )
}

/** Put a removed bookmark back (undo). Same id and timestamp, so it returns to
 *  its old place in a time-sorted list. No-op if it's already present. */
export function restoreBookmark(network: Network, b: Bookmark): void {
  const list = getSnapshot(network)
  if (list.some((x) => x.id === b.id)) return
  commit(network, [...list, b])
}
