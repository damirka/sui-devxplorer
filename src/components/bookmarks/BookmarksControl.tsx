import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bookmark as BookmarkIcon, BookmarkCheck } from 'lucide-react'
import { useNetwork } from '@/context/useNetwork'
import { findBookmark, pageTarget, useBookmarks } from '@/lib/bookmarks'
import { BookmarkEditModal } from './BookmarkEditModal'
import { BookmarksListModal } from './BookmarksListModal'

/** Is the key event aimed at a text field — i.e. a bare letter is typing, not a
 *  shortcut? Mirrors the guard on the global `/` search hotkey. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * The header's bookmarks entry — and the owner of the two global hotkeys, vim
 * style: `b` marks the page you're on (a popup asks for a name), `B` opens the
 * jump list. Both are ignored while typing in a field or while a popup is up.
 * Desktop only: the button hides on narrow screens (no keyboard, no hotkeys),
 * and the icon flips to a check while the current page is bookmarked.
 */
export function BookmarksControl() {
  const [searchParams] = useSearchParams()
  const { network } = useNetwork()
  const bookmarks = useBookmarks()
  const [open, setOpen] = useState<'edit' | 'list' | null>(null)

  const target = useMemo(() => pageTarget(searchParams, network), [searchParams, network])
  const existing = target ? findBookmark(bookmarks, target) : undefined
  const canBookmark = target !== null

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target) || e.key.toLowerCase() !== 'b') return
      // `B` is the shifted key on a real keyboard; some automation sends
      // `b` + shiftKey instead — treat both as the list.
      if (e.shiftKey || e.key === 'B') {
        e.preventDefault()
        setOpen('list')
      } else if (canBookmark) {
        e.preventDefault()
        setOpen('edit')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, canBookmark])

  const close = useCallback(() => setOpen(null), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen('list')}
        title={canBookmark ? 'bookmarks (B) · bookmark this page (b)' : 'bookmarks (B)'}
        className="text-muted hover:bg-surface-2 hover:text-primary hidden shrink-0 items-center gap-1.5 px-1.5 py-1 font-mono text-xs tracking-wide transition-colors sm:inline-flex"
      >
        {existing ? (
          <BookmarkCheck size={14} className="text-primary" />
        ) : (
          <BookmarkIcon size={14} />
        )}
        bookmarks
      </button>

      {target && (
        <BookmarkEditModal
          open={open === 'edit'}
          onClose={close}
          target={target}
          existing={existing}
        />
      )}
      <BookmarksListModal
        open={open === 'list'}
        onClose={close}
        canAdd={canBookmark && !existing}
        onAdd={() => setOpen('edit')}
      />
    </>
  )
}
