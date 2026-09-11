import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { fmtIndex } from '@/components/ui/Panel'
import { useNetwork } from '@/context/useNetwork'
import { cn } from '@/lib/cn'
import { formatAgo } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import {
  bookmarkKind,
  displayTarget,
  removeBookmark,
  restoreBookmark,
  useBookmarks,
  KIND_TAG,
  type Bookmark,
} from '@/lib/bookmarks'
import { KeyHints, KindTag, MOD_KEY } from './bits'

/**
 * The `B` popup: every bookmark as an indexed menu, newest first, driven from
 * one filter field like a command palette — type to narrow, ↑/↓ (or ctrl+n/p)
 * to move, ↵ to open, ⌫ to delete the highlighted row (only while the filter is
 * empty, so backspacing a query can't eat a bookmark) and ⌘z/ctrl+z to put the
 * last deletion back.
 */
export function BookmarksListModal({
  open,
  onClose,
  canAdd,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  /** The current page can be bookmarked and isn't yet — offers `+ this page`. */
  canAdd: boolean
  onAdd: () => void
}) {
  const bookmarks = useBookmarks()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="bookmarks"
      className="max-w-xl"
      actions={
        <>
          <span className="menu-num shrink-0">{bookmarks.length}</span>
          {canAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="text-muted hover:text-primary shrink-0 font-mono text-xs transition-colors"
            >
              + this page
            </button>
          )}
        </>
      }
    >
      {/* Mounted fresh on every open: filter, highlight and undo state reset. */}
      {open && <BookmarkList bookmarks={bookmarks} onClose={onClose} />}
    </Modal>
  )
}

/** Everything a row shows, lowercased — what the filter matches against. */
function haystack(b: Bookmark): string {
  const search = b.params.search
  return [b.name, search, displayTarget(search), b.network, KIND_TAG[bookmarkKind(b)]]
    .join(' ')
    .toLowerCase()
}

function BookmarkList({
  bookmarks,
  onClose,
}: {
  bookmarks: readonly Bookmark[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { network } = useNetwork()
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const [lastDeleted, setLastDeleted] = useState<Bookmark | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Ages tick while the list is open (unmounts with it, so no idle timer).
  const now = useNow(1000)

  const sorted = useMemo(
    () => [...bookmarks].sort((a, b) => b.createdAt - a.createdAt),
    [bookmarks],
  )
  const q = filter.trim().toLowerCase()
  const visible = useMemo(
    () => (q ? sorted.filter((b) => haystack(b).includes(q)) : sorted),
    [sorted, q],
  )
  // Clamp the highlight: rows shift under it as the filter and deletions change.
  const idx = visible.length ? Math.min(active, visible.length - 1) : -1
  const current = idx >= 0 ? visible[idx] : null

  // Keep the highlighted row in view as the keyboard walks a long list.
  useEffect(() => {
    if (idx < 0) return
    listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  /** Href to open a bookmark. The URL omits `network` on the default and the
   *  tab's stored default then fills it in — so pin it explicitly whenever it
   *  could resolve to a different network than the one bookmarked. */
  function hrefFor(b: Bookmark): string {
    const p = new URLSearchParams(b.params)
    if (b.network !== network || searchParams.has('network')) p.set('network', b.network)
    return `?${p.toString()}`
  }

  function openBookmark(b: Bookmark) {
    navigate(hrefFor(b))
    onClose()
  }

  function deleteCurrent() {
    if (!current) return
    removeBookmark(current.id)
    setLastDeleted(current)
  }

  function undoDelete() {
    if (!lastDeleted) return
    restoreBookmark(lastDeleted)
    setLastDeleted(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const ctrl = e.ctrlKey && !e.metaKey
    const mod = e.metaKey || e.ctrlKey
    const n = visible.length
    if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) {
      e.preventDefault()
      if (n) setActive((idx + 1) % n)
    } else if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) {
      e.preventDefault()
      if (n) setActive((idx - 1 + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (current) openBookmark(current)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && !filter && !mod) {
      e.preventDefault()
      deleteCurrent()
    } else if (mod && !e.shiftKey && e.key === 'z' && lastDeleted) {
      e.preventDefault()
      undoDelete()
    }
  }

  const hints: (readonly [string, string])[] = [
    ['↑↓', 'move'],
    ['↵', 'open'],
    ['⌫', 'delete'],
  ]
  if (lastDeleted) hints.push([`${MOD_KEY}z`, 'undo'])

  return (
    <div className="flex flex-col">
      <div className="border-line relative border-b">
        <span
          aria-hidden
          className="text-primary pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm select-none"
        >
          ❯
        </span>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          autoFocus
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="filter bookmarks"
          spellCheck={false}
          autoComplete="off"
          aria-label="Filter bookmarks"
          className="placeholder:text-muted w-full bg-transparent py-3 pr-4 pl-10 font-mono text-sm outline-none"
        />
      </div>

      <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
        {visible.map((b, i) => {
          const on = i === idx
          const search = b.params.search
          // A pinned object version is part of what was marked — show it.
          const id = displayTarget(search) + (b.params.version ? ` v${b.params.version}` : '')
          const kind = bookmarkKind(b)
          return (
            <Link
              key={b.id}
              to={hrefFor(b)}
              onClick={onClose}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'border-line flex items-center gap-3 border-b px-4 py-2 font-mono text-xs transition-colors last:border-b-0',
                on && 'bg-surface-2',
              )}
            >
              <span className="menu-num w-5 shrink-0">{fmtIndex(i + 1)}</span>
              <span
                className={cn('min-w-0 flex-1 truncate', on ? 'text-primary' : 'text-text')}
                title={search}
              >
                {b.name || id}
              </span>
              {/* Capped so a long type path can't squeeze the name out. */}
              {b.name && (
                <span className="text-muted max-w-40 shrink-0 truncate" title={search}>
                  {id}
                </span>
              )}
              {/* Keyword pages (`checkpoints`) already read as their kind. */}
              {KIND_TAG[kind] !== search && <KindTag kind={kind} />}
              {b.network !== 'mainnet' && (
                <span className="text-muted shrink-0">{b.network}</span>
              )}
              <span
                className="text-muted w-16 shrink-0 text-right tabular-nums"
                title={new Date(b.createdAt).toISOString()}
              >
                {formatAgo(now - b.createdAt)}
              </span>
            </Link>
          )
        })}

        {visible.length === 0 && (
          <div className="text-muted px-4 py-8 text-center font-mono text-xs">
            {sorted.length === 0 ? (
              <>
                no bookmarks yet — press <kbd className="kbd">b</kbd> on any page to mark it
              </>
            ) : (
              'no match'
            )}
          </div>
        )}
      </div>

      <div className="border-line flex items-center justify-between gap-3 border-t px-4 py-2">
        <span className="text-muted min-w-0 truncate font-mono text-[11px]">
          {lastDeleted && (
            <>
              deleted{' '}
              <span className="text-text">
                {lastDeleted.name || displayTarget(lastDeleted.params.search)}
              </span>
            </>
          )}
        </span>
        <KeyHints items={hints} />
      </div>
    </div>
  )
}
