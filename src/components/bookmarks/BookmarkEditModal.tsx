import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import type { Network } from '@/context/network-context'
import {
  addBookmark,
  bookmarkKind,
  displayTarget,
  removeBookmark,
  renameBookmark,
  suggestedName,
  type Bookmark,
  type PageParams,
} from '@/lib/bookmarks'
import { formatAgo } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { KeyHints } from '@/components/ui/KeyHints'
import { KindTag } from './bits'

/**
 * The `b` popup: name a page and save it — or rename the bookmark it already
 * has (from the page itself, or via `rename` in the list's action strip). The
 * field starts empty with a suggested name as its placeholder (the id, or an
 * address-free Move path like `usdc::USDC`), so the fast path is either ↵
 * (take the suggestion) or just type; esc cancels. Taking a bare id as the
 * label stores an *unnamed* bookmark, so the list shows the id once rather
 * than twice. In rename mode the field holds the current name, selected.
 */
export function BookmarkEditModal({
  open,
  onClose,
  network,
  params,
  existing,
}: {
  open: boolean
  onClose: () => void
  network: Network
  params: PageParams
  /** The page's bookmark, when it already has one (→ rename mode). */
  existing?: Bookmark
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'rename bookmark' : 'bookmark'}
      actions={
        existing && (
          <button
            type="button"
            onClick={() => {
              removeBookmark(network, existing.id)
              onClose()
            }}
            className="text-muted hover:text-danger shrink-0 font-mono text-xs transition-colors"
          >
            remove
          </button>
        )
      }
    >
      {/* Mounted fresh on every open, so the draft starts from the live label. */}
      {open && (
        <EditForm network={network} params={params} existing={existing} onDone={onClose} />
      )}
    </Modal>
  )
}

function EditForm({
  network,
  params,
  existing,
  onDone,
}: {
  network: Network
  params: PageParams
  existing?: Bookmark
  onDone: () => void
}) {
  const search = params.search
  const suggestion = suggestedName(params)
  const [name, setName] = useState(existing?.name ?? '')
  const now = useNow(1000)

  function save() {
    const clean = name.trim() || suggestion
    // A bare id as the label is stored as "unnamed" (the row shows the id).
    const label = clean === search ? '' : clean
    if (existing) renameBookmark(network, existing.id, label)
    else addBookmark(network, params, label)
    onDone()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    save()
  }

  // Save on ↵ explicitly (not only via the form's implicit submission) so the
  // popup behaves like the list: one keydown, done.
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-4">
      <div className="flex min-w-0 items-center gap-2.5 font-mono text-xs">
        <KindTag kind={bookmarkKind(params)} />
        <span className="hash min-w-0 flex-1 truncate" title={search}>
          {displayTarget(search)}
        </span>
        {existing && (
          <span
            className="text-muted shrink-0 tabular-nums"
            title={new Date(existing.createdAt).toISOString()}
          >
            {formatAgo(now - existing.createdAt)}
          </span>
        )}
      </div>

      <div className="relative">
        <span
          aria-hidden
          className="text-primary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none"
        >
          ❯
        </span>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          // Rename mode: the current name comes selected so typing replaces it.
          onFocus={(e) => e.currentTarget.select()}
          placeholder={suggestion}
          spellCheck={false}
          autoComplete="off"
          aria-label="Bookmark name"
          className="input py-2.5 pl-9 text-sm"
        />
      </div>

      <KeyHints items={[['↵', 'save'], ['esc', 'cancel']]} />
    </form>
  )
}
