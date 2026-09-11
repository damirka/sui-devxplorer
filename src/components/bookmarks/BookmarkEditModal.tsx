import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  addBookmark,
  bookmarkKind,
  displayTarget,
  removeBookmark,
  renameBookmark,
  type Bookmark,
  type PageTarget,
} from '@/lib/bookmarks'
import { formatAgo } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { KeyHints, KindTag } from './bits'

/**
 * The `b` popup: name the current page and save it — or rename the bookmark it
 * already has. The field is prefilled with the page's id and fully selected, so
 * the fast path is either ↵ (keep the id as the label) or type-to-replace.
 * Keeping the id as the label stores an *unnamed* bookmark, so the list shows
 * the id once rather than twice.
 */
export function BookmarkEditModal({
  open,
  onClose,
  target,
  existing,
}: {
  open: boolean
  onClose: () => void
  target: PageTarget
  /** The current page's bookmark, when it already has one (→ rename mode). */
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
              removeBookmark(existing.id)
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
      {open && <EditForm target={target} existing={existing} onDone={onClose} />}
    </Modal>
  )
}

function EditForm({
  target,
  existing,
  onDone,
}: {
  target: PageTarget
  existing?: Bookmark
  onDone: () => void
}) {
  const search = target.params.search
  const [name, setName] = useState(existing?.name || search)
  const now = useNow(1000)

  function save() {
    const clean = name.trim()
    // The untouched default (the id itself) is stored as "unnamed".
    const label = clean === search ? '' : clean
    if (existing) renameBookmark(existing.id, label)
    else addBookmark(target, label)
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
        <KindTag kind={bookmarkKind(target)} />
        <span className="hash min-w-0 flex-1 truncate" title={search}>
          {displayTarget(search)}
        </span>
        {target.network !== 'mainnet' && (
          <span className="text-muted shrink-0">{target.network}</span>
        )}
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
          // Select the prefilled id so typing replaces it outright.
          onFocus={(e) => e.currentTarget.select()}
          placeholder={search}
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
