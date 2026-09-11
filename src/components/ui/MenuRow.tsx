import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { RowIndex } from './RowIndex'

interface MenuRowStyle {
  /** Content may wrap onto a second line (a long id with trailing meta). */
  wrap?: boolean
  /** Top-align the index with multi-line content. */
  top?: boolean
  /** The row is a click target — highlight on hover. */
  hover?: boolean
  className?: string
}

/**
 * The classes of one indexed list row (the Sifu `01  label ──── meta` line):
 * for rows that must be a `Link` or `button` rather than a plain `li`.
 */
export function menuRowClass({ wrap, top, hover, className }: MenuRowStyle): string {
  return cn(
    'flex py-2.5',
    top ? 'items-start' : 'items-center',
    wrap ? 'flex-wrap gap-x-3 gap-y-1' : 'gap-3',
    hover && 'hover:bg-surface-2 transition-colors',
    className,
  )
}

interface MenuRowProps extends MenuRowStyle, Omit<HTMLAttributes<HTMLElement>, 'className'> {
  as?: 'li' | 'div'
  /** Leading `01` index (see `RowIndex`); omit for an unindexed row. */
  n?: number
  children: ReactNode
}

/** One row of an indexed list: the index, then the row's content, laid out on
 *  the shared `menuRowClass` grid. Lists divide rows with `divide-line divide-y`. */
export function MenuRow({
  as: Tag = 'li',
  n,
  wrap,
  top,
  hover,
  className,
  children,
  ...rest
}: MenuRowProps) {
  return (
    <Tag className={menuRowClass({ wrap, top, hover, className })} {...rest}>
      {n != null && <RowIndex n={n} />}
      {children}
    </Tag>
  )
}
