import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { registerOpenModal } from '@/lib/hotkeys'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Header label (rendered as the terminal-style panel label). */
  title?: ReactNode
  /** Extra header controls, placed left of the close button. */
  actions?: ReactNode
  /** Footer strip below the scrolling body — a status readout and/or a
   *  `KeyHints` legend (put `ml-auto` on a lone legend to right-align it). */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * A centered, portal-rendered modal over a blurred backdrop. Escape and a
 * backdrop click close it; body scroll is locked and the global hotkeys are
 * suspended while open. Renders nothing
 * when closed — but the component stays mounted, so a parent can keep modal
 * state (and any retained content) alive across re-renders.
 */
export function Modal({ open, onClose, title, actions, footer, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Suspend the global hotkeys (`/`, `b`, `B`, `M`…) while we're up.
    const release = registerOpenModal()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      release()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      // Backdrop click closes; mousedown (not click) so a drag-select that ends
      // outside doesn't dismiss it.
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        className={cn(
          'border-line bg-surface relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border shadow-xl',
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="border-line flex items-center gap-3 border-b px-4 py-3">
          {title && <span className="panel-label">{title}</span>}
          <span className="rule" />
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-primary shrink-0 transition-colors"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="border-line flex items-center justify-between gap-3 border-t px-4 py-2">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
