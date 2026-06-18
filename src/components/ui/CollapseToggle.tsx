import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * A panel-section header that collapses its body — a chevron + `panel-label`
 * button. Drop it in a `PanelSection`'s `label`, drive `open` from the page, and
 * gate the section body (and usually the pager) on that state.
 */
export function CollapseToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean
  onToggle: () => void
  label: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? 'collapse' : 'expand'}
      className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <span className="panel-label">{label}</span>
    </button>
  )
}
