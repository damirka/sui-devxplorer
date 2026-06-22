import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <div className={cn('panel', className)} {...props}>
      {children}
    </div>
  )
}

interface PanelSectionProps {
  /** Optional menu index, e.g. `1` → `01`. Numbers are zero-padded to 2. */
  index?: number | string
  /** Usually the section title text; a node when the header needs to be
   * interactive (e.g. a collapse toggle). */
  label?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Zero-pad a numeric section index to the Sifu menu `01`/`02` form. */
export function fmtIndex(index: number | string): string {
  return typeof index === 'number' ? String(index).padStart(2, '0') : index
}

/**
 * A titled section inside a Panel — the building block for result views.
 * Header reads as a terminal/Sifu menu line: `01  LABEL ───────── [action]`.
 */
export function PanelSection({
  index,
  label,
  action,
  children,
  className,
}: PanelSectionProps) {
  return (
    <section
      className={cn('border-line border-b p-5 last:border-b-0', className)}
    >
      {(label || action) && (
        <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {index != null && <span className="panel-index">{fmtIndex(index)}</span>}
          {label && <span className="panel-label">{label}</span>}
          <span className="rule" />
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
