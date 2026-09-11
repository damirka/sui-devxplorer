import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNetwork } from '@/context/useNetwork'
import {
  findBookmark,
  pageParams,
  useBookmarks,
  type Bookmark,
  type PageParams,
} from '@/lib/bookmarks'
import { hotkeyAllowed, shiftedLetter, useKeydown } from '@/lib/hotkeys'
import { BookmarkEditModal } from './BookmarkEditModal'
import { BookmarksListModal } from './BookmarksListModal'

/** What the edit popup is working on, and where to go when it closes. */
interface Editing {
  params: PageParams
  existing?: Bookmark
  /** Launched from the list (`+ this page`, `rename`) → drop back into it. */
  fromList: boolean
}

/**
 * The headless owner of the two bookmark hotkeys, vim style: `b` marks the
 * page you're on (a popup asks for a name), `B` opens the jump list for the
 * current network. Both go through `hotkeyAllowed` (no popup open, not typing,
 * desktop). Renders nothing but the popups — there's deliberately no chrome for
 * this; the `?` cheatsheet is where the keys are listed. Desktop only: inert
 * below the `sm` breakpoint.
 */
export function BookmarksHotkeys() {
  const [searchParams] = useSearchParams()
  const { network } = useNetwork()
  const bookmarks = useBookmarks(network)
  const [open, setOpen] = useState<'edit' | 'list' | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)

  const params = useMemo(() => pageParams(searchParams), [searchParams])
  const existing = params ? findBookmark(bookmarks, params) : undefined
  const canBookmark = params !== null

  const editCurrent = useCallback(
    (fromList: boolean) => {
      if (!params) return
      setEditing({ params, existing, fromList })
      setOpen('edit')
    },
    [params, existing],
  )

  useKeydown((e) => {
    if (!hotkeyAllowed(e) || e.ctrlKey || e.metaKey || e.altKey) return
    if (shiftedLetter(e) === 'B') {
      e.preventDefault()
      setOpen('list')
    } else if (e.key === 'b' && canBookmark) {
      e.preventDefault()
      editCurrent(false)
    }
  })

  const closeAll = useCallback(() => setOpen(null), [])
  const closeEdit = useCallback(
    () => setOpen(editing?.fromList ? 'list' : null),
    [editing],
  )

  return (
    <>
      {editing && (
        <BookmarkEditModal
          open={open === 'edit'}
          onClose={closeEdit}
          network={network}
          params={editing.params}
          existing={editing.existing}
        />
      )}
      <BookmarksListModal
        open={open === 'list'}
        onClose={closeAll}
        network={network}
        canAdd={canBookmark && !existing}
        onAdd={() => editCurrent(true)}
        onRename={(b) => {
          setEditing({ params: b.params, existing: b, fromList: true })
          setOpen('edit')
        }}
      />
    </>
  )
}
