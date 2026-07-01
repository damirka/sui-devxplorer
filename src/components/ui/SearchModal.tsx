import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Modal } from './Modal'
import { SearchBar } from './SearchBar'

/**
 * The mobile search surface. The header has no room for an inline field on a
 * narrow screen, so a tap opens the same hero prompt — with its teaching hints —
 * in a modal. It dismisses itself the moment a query navigates: via `onNavigate`
 * for a typed submit, and by watching the URL for a tapped hint `<Link>`.
 */
export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { search } = useLocation()

  // A tapped hint navigates through a `<Link>` (not `onNavigate`), so close when
  // the query in the URL changes while we're open. Opening the modal doesn't
  // touch `search`, so this never fires on open.
  useEffect(() => {
    if (open) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <Modal open={open} onClose={onClose} title="search">
      {/* The hints dropdown drops from the input as an absolute layer and the
          modal clips overflow, so reserve height for it here. */}
      <div className="min-h-[22rem] p-4">
        <SearchBar variant="hero" hints autoFocus onNavigate={onClose} />
      </div>
    </Modal>
  )
}
