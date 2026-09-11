import { useSyncExternalStore } from 'react'
import { isNetwork, type Network } from '@/context/network-context'
import { formatAddress, formatType } from './format'
import { detectSearchKind, truncateMiddle, type SearchKind } from './search'

/**
 * Bookmarks: a per-browser list of explorer pages worth coming back to, kept in
 * localStorage (no backend). A page is identified the same way the app is
 * driven — by its URL: the network plus every query param except `network`
 * (`search` and any pins such as `version`, `vtab`, `validator`, `view`), so a
 * bookmark reopens exactly the view that was marked.
 *
 * The list is a tiny external store (`useSyncExternalStore`): one cached array,
 * written through to localStorage on every change and re-read on cross-tab
 * `storage` events, so several tabs stay in step. Actions are plain functions —
 * import them where needed; `useBookmarks()` is the live read.
 */

export const BOOKMARKS_STORAGE_KEY = 'devx:bookmarks'

/** Where a bookmark points: a network + the page's query params (sans network). */
export interface PageTarget {
  network: Network
  /** `search` plus any view pins; never `network`. */
  params: Record<string, string>
}

export interface Bookmark extends PageTarget {
  /** Stable id — React key + update handle. */
  id: string
  /** User label; empty = unnamed (rows show the target id instead). */
  name: string
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
export function pageKey(t: PageTarget): string {
  const parts = Object.entries(t.params)
    .map(([k, v]) => [k, k === 'search' ? detectSearchKind(v).value : v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
  return `${t.network}?${parts.join('&')}`
}

/** The bookmarkable target of the current URL, or `null` on the landing page. */
export function pageTarget(
  searchParams: URLSearchParams,
  network: Network,
): PageTarget | null {
  const search = searchParams.get('search')?.trim()
  if (!search) return null
  const params: Record<string, string> = {}
  for (const [k, v] of searchParams) {
    if (k !== 'network' && v) params[k] = v
  }
  params.search = search
  return { network, params }
}

export function findBookmark(
  bookmarks: readonly Bookmark[],
  target: PageTarget,
): Bookmark | undefined {
  const key = pageKey(target)
  return bookmarks.find((b) => pageKey(b) === key)
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

export function bookmarkKind(t: PageTarget): SearchKind {
  return detectSearchKind(t.params.search).kind
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

let cache: Bookmark[] | null = null
const listeners = new Set<() => void>()

/** Shape-check one persisted entry — a corrupt or foreign value is dropped. */
function isBookmark(v: unknown): v is Bookmark {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  const params = b.params
  return (
    typeof b.id === 'string' &&
    typeof b.name === 'string' &&
    typeof b.createdAt === 'number' &&
    typeof b.network === 'string' &&
    isNetwork(b.network) &&
    typeof params === 'object' &&
    params !== null &&
    typeof (params as Record<string, unknown>).search === 'string' &&
    Object.values(params as Record<string, unknown>).every((x) => typeof x === 'string')
  )
}

function load(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isBookmark) : []
  } catch {
    return []
  }
}

function getSnapshot(): Bookmark[] {
  if (cache === null) cache = load()
  return cache
}

function commit(next: Bookmark[]): void {
  cache = next
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota / private mode: keep the in-memory list for this session.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab wrote the list: drop the cache so the next read reloads it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BOOKMARKS_STORAGE_KEY) {
      cache = null
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The live bookmark list, in insertion order — sort at the call site. */
export function useBookmarks(): readonly Bookmark[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function addBookmark(target: PageTarget, name: string): Bookmark {
  const b: Bookmark = {
    id: uid(),
    name,
    network: target.network,
    params: { ...target.params },
    createdAt: Date.now(),
  }
  commit([...getSnapshot(), b])
  return b
}

export function renameBookmark(id: string, name: string): void {
  commit(getSnapshot().map((b) => (b.id === id ? { ...b, name } : b)))
}

export function removeBookmark(id: string): void {
  commit(getSnapshot().filter((b) => b.id !== id))
}

/** Put a removed bookmark back (undo). Same id and timestamp, so it returns to
 *  its old place in a time-sorted list. No-op if it's already present. */
export function restoreBookmark(b: Bookmark): void {
  const list = getSnapshot()
  if (list.some((x) => x.id === b.id)) return
  commit([...list, b])
}
