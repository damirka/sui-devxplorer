import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyHints, type KeyHint } from '@/components/ui/KeyHints'
import { Modal } from '@/components/ui/Modal'
import { PromptInput } from '@/components/ui/PromptInput'
import { RowIndex } from '@/components/ui/RowIndex'
import { useCopy } from '@/components/ui/useCopy'
import type { Network } from '@/context/network-context'
import { cn } from '@/lib/cn'
import { formatAgo, formatIdentifier } from '@/lib/format'
import { cycle, MOD_KEY } from '@/lib/hotkeys'
import { useNow } from '@/lib/useNow'
import {
  bookmarkKind,
  removeBookmark,
  restoreBookmark,
  useBookmarks,
  type Bookmark,
} from '@/lib/bookmarks'
import { KIND_META } from '@/lib/search'
import { KindTag } from './bits'

/** What the action strip (tab) offers for the highlighted bookmark; `key` is
 *  the single-letter shortcut once the strip is open. */
const ACTIONS = [
  { id: 'open', label: 'open', key: 'o' },
  { id: 'rename', label: 'rename', key: 'r' },
  { id: 'delete', label: 'delete', key: 'd' },
  { id: 'copy', label: 'copy id', key: 'c' },
] as const
type ActionId = (typeof ACTIONS)[number]['id']

interface ListProps {
  onClose: () => void
  network: Network
  /** The current page can be bookmarked and isn't yet — offers `+ this page`. */
  canAdd: boolean
  onAdd: () => void
  /** Rename one bookmark (the host swaps in the edit popup). */
  onRename: (b: Bookmark) => void
}

/**
 * The `B` popup: the current network's bookmarks as an indexed menu, newest
 * first, driven from one filter field like a command palette — type to narrow,
 * ↑/↓ (or ctrl+n/p) to move, ↵ to open, ⌫ to delete the highlighted row (only
 * while the filter is empty, so backspacing a query can't eat a bookmark) and
 * ⌘z/ctrl+z to put the last deletion back. tab opens an action strip under the
 * highlighted row (open / rename / delete / copy id — ←/→ or the letter keys,
 * ↵ runs, esc backs out); esc with no strip open closes the popup.
 */
export function BookmarksListModal({ open, ...props }: ListProps & { open: boolean }) {
  // Mounted only while open, so filter, highlight and undo state start fresh.
  if (!open) return null
  return <BookmarkList {...props} />
}

/** Everything a row shows, lowercased — what the filter matches against. */
function haystack(b: Bookmark): string {
  const search = b.params.search
  return [b.name, search, formatIdentifier(search), KIND_META[bookmarkKind(b.params)].tag]
    .join(' ')
    .toLowerCase()
}

function BookmarkList({ onClose, network, canAdd, onAdd, onRename }: ListProps) {
  const bookmarks = useBookmarks(network)
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionIdx, setActionIdx] = useState(0)
  const [lastDeleted, setLastDeleted] = useState<Bookmark | null>(null)
  const { copiedValue, copy } = useCopy()
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([])
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
    if (idx >= 0) rowRefs.current[idx]?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  /** Href to open a bookmark: its params on the current network — the list
   *  only ever holds this network's bookmarks, and every result URL names its
   *  network (the landing page's URL doesn't, so read the active one, not the
   *  param). */
  function hrefFor(b: Bookmark): string {
    const p = new URLSearchParams(b.params)
    p.set('network', network)
    return `?${p.toString()}`
  }

  function openBookmark(b: Bookmark) {
    navigate(hrefFor(b))
    onClose()
  }

  function deleteCurrent() {
    if (!current) return
    removeBookmark(network, current.id)
    setLastDeleted(current)
  }

  function undoDelete() {
    if (!lastDeleted) return
    restoreBookmark(network, lastDeleted)
    setLastDeleted(null)
  }

  function runAction(id: ActionId) {
    if (!current) return
    setActionsOpen(false)
    if (id === 'open') openBookmark(current)
    else if (id === 'rename') onRename(current)
    else if (id === 'delete') deleteCurrent()
    else if (id === 'copy') copy(current.params.search)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const ctrl = e.ctrlKey && !e.metaKey
    const mod = e.metaKey || e.ctrlKey
    const n = visible.length

    // Row movement works the same with or without the strip (it follows the row).
    if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) {
      e.preventDefault()
      setActive(cycle(idx, 1, n))
      return
    }
    if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) {
      e.preventDefault()
      setActive(cycle(idx, -1, n))
      return
    }

    if (actionsOpen) {
      if (mod) return // leave browser shortcuts alone
      // The strip owns the keyboard: nothing here types into the filter.
      e.preventDefault()
      if (e.key === 'Escape') {
        e.stopPropagation() // back to the list — not out of the popup
        setActionsOpen(false)
      } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
        const step = e.key === 'Tab' && e.shiftKey ? -1 : 1
        setActionIdx((i) => cycle(i, step, ACTIONS.length))
      } else if (e.key === 'ArrowLeft') {
        setActionIdx((i) => cycle(i, -1, ACTIONS.length))
      } else if (e.key === 'Enter') {
        runAction(ACTIONS[actionIdx].id)
      } else {
        const a = ACTIONS.find((x) => x.key === e.key)
        if (a) runAction(a.id)
      }
      return
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      if (current) {
        setActionIdx(0)
        setActionsOpen(true)
      }
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

  const hints: KeyHint[] = actionsOpen
    ? [
        ['←→', 'choose'],
        ['↵', 'run'],
        ['esc', 'back'],
      ]
    : [
        ['↑↓', 'move'],
        ['↵', 'open'],
        ['tab', 'actions'],
        ['⌫', 'delete'],
      ]
  if (!actionsOpen && lastDeleted) hints.push([`${MOD_KEY}z`, 'undo'])

  const status = copiedValue ? (
    <>
      copied <span className="text-text">{formatIdentifier(copiedValue)}</span>
    </>
  ) : lastDeleted ? (
    <>
      deleted{' '}
      <span className="text-text">
        {lastDeleted.name || formatIdentifier(lastDeleted.params.search)}
      </span>
    </>
  ) : null

  return (
    <Modal
      open
      onClose={onClose}
      title="bookmarks"
      className="max-w-xl"
      actions={
        <>
          <span className="text-muted shrink-0 font-mono text-xs">{network}</span>
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
      footer={
        <>
          <span className="text-muted min-w-0 truncate font-mono text-[11px]">{status}</span>
          <KeyHints items={hints} />
        </>
      }
    >
      <div className="border-line border-b">
        <PromptInput
          bare
          autoFocus
          label="Filter bookmarks"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setActive(0)
            setActionsOpen(false)
          }}
          onKeyDown={onKeyDown}
          placeholder="filter bookmarks"
        />
      </div>

      <div className="max-h-[55vh] overflow-y-auto">
        {visible.map((b, i) => {
          const on = i === idx
          const search = b.params.search
          // A pinned object version is part of what was marked — show it.
          const id = formatIdentifier(search) + (b.params.version ? ` v${b.params.version}` : '')
          const kind = bookmarkKind(b.params)
          return (
            <Fragment key={b.id}>
              <Link
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                to={hrefFor(b)}
                onClick={onClose}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'border-line flex items-center gap-3 border-b px-4 py-2 font-mono text-xs transition-colors last:border-b-0',
                  on && 'bg-surface-2',
                )}
              >
                <RowIndex n={i + 1} className="w-5" />
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
                {KIND_META[kind].tag !== search && <KindTag kind={kind} />}
                <span
                  className="text-muted w-16 shrink-0 text-right tabular-nums"
                  title={new Date(b.createdAt).toISOString()}
                >
                  {formatAgo(now - b.createdAt)}
                </span>
              </Link>

              {/* The action strip, attached under the highlighted row. */}
              {on && actionsOpen && (
                <div
                  // Keep the filter focused when an action is clicked, so the
                  // keyboard keeps working afterwards.
                  onMouseDown={(e) => e.preventDefault()}
                  className="border-line bg-surface-2 flex items-center gap-1 border-b px-4 py-1.5 font-mono text-xs"
                >
                  <span aria-hidden className="text-muted mr-1 select-none">
                    ↳
                  </span>
                  {ACTIONS.map((a, j) => (
                    <button
                      key={a.id}
                      type="button"
                      onMouseEnter={() => setActionIdx(j)}
                      onClick={() => runAction(a.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-1 transition-colors',
                        j === actionIdx
                          ? 'bg-surface text-primary'
                          : 'text-muted hover:text-text',
                      )}
                    >
                      <kbd className="kbd">{a.key}</kbd>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          )
        })}

        {visible.length === 0 && (
          <div className="text-muted px-4 py-8 text-center font-mono text-xs">
            {sorted.length === 0 ? (
              <>
                no bookmarks on {network} yet — press <kbd className="kbd">b</kbd> on any
                page to mark it
              </>
            ) : (
              'no match'
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
