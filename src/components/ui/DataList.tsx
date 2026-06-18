import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { SkeletonLines } from './Skeleton'
import { ErrorText } from './ErrorText'

/**
 * The body of every result list: it resolves the loading → error → empty →
 * populated states and, when there are items, wraps them in the shared
 * terminal-style divided `<ul>`. Pair it with {@link usePagedList} (its `items`,
 * `loading`, `error` drop straight in). Callers render each row themselves — so
 * the `<li>` (its key, layout, links) stays fully in their hands — while the
 * state handling and list chrome live here, once.
 */
export function DataList<T>({
  loading,
  error,
  items,
  empty,
  skeleton = 5,
  scroll = false,
  className,
  children,
}: {
  loading: boolean
  error: Error | null
  items: T[]
  /** Shown when the fetch resolved with no items. A string becomes the standard
   *  muted "no X." line; a node is rendered as-is. */
  empty: ReactNode
  /** Skeleton line count while loading. */
  skeleton?: number
  /** Cap the height and scroll — for long in-page lists (owned objects, caps). */
  scroll?: boolean
  className?: string
  /** Render one row (its own `<li key>`) per item. */
  children: (item: T, index: number) => ReactNode
}) {
  if (loading) return <SkeletonLines count={skeleton} />
  if (error) return <ErrorText error={error} />
  if (items.length === 0) {
    return typeof empty === 'string' ? (
      <span className="text-muted text-sm">{empty}</span>
    ) : (
      <>{empty}</>
    )
  }
  return (
    <ul
      className={cn(
        'divide-line divide-y font-mono text-xs',
        scroll && 'max-h-[28rem] overflow-y-auto',
        className,
      )}
    >
      {items.map((item, i) => children(item, i))}
    </ul>
  )
}
