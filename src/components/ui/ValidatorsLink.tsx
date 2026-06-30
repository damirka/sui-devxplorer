import { Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSearchHref } from './links'

/**
 * Top-bar shortcut to the validator-set dashboard — the keyword search isn't
 * discoverable, so the header carries a direct link (a sibling to the checkpoints
 * liveness dot). Icon-only on mobile, icon + label from `sm` up, to stay quiet.
 */
export function ValidatorsLink() {
  const searchHref = useSearchHref()
  return (
    <Link
      to={searchHref('validators')}
      title="validator set"
      className="text-muted hover:bg-surface-2 hover:text-primary inline-flex shrink-0 items-center gap-1.5 px-1.5 py-1 font-mono text-xs tracking-wide transition-colors"
    >
      <Users size={14} />
      <span className="hidden sm:inline">validators</span>
    </Link>
  )
}
