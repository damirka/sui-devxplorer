import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePolledAsync } from '@/lib/useAsync'
import { emptyPage, type Page, type PageArgs } from '@/lib/pagination'

const PAGE_SIZES = [10, 25, 50]

/** Shared stable empty array, so `usePagedList().items` keeps a constant
 *  reference between fetches — callers can safely use it as a memo/effect dep. */
const NO_ITEMS: readonly never[] = []

/**
 * Forward/back cursor pagination shared by the result lists. Holds the page
 * size, the stack of `after` cursors, and the current index, and resets
 * automatically whenever `resetKey` (the data identity, e.g. `network|id`) or
 * the page size changes. Pair with `<Pager>` for the controls.
 */
export function useCursorPager(resetKey: string) {
  const [pageSize, setPageSize] = useState(10)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setCursors([null])
    setPageIndex(0)
  }, [resetKey, pageSize])

  const after = cursors[pageIndex] ?? null

  const prev = useCallback(() => setPageIndex((i) => Math.max(0, i - 1)), [])

  // Advance to the next page, recording the cursor that fetches it so back
  // navigation re-uses it.
  const next = useCallback(
    (endCursor: string | null) => {
      setCursors((cs) => [...cs.slice(0, pageIndex + 1), endCursor])
      setPageIndex((i) => i + 1)
    },
    [pageIndex],
  )

  return { pageSize, setPageSize, pageIndex, after, prev, next }
}

/** Props produced by {@link usePagedList} — spread straight into `<Pager>`. */
export interface PagerProps {
  pageIndex: number
  pageSize: number
  onPageSize: (n: number) => void
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
}

export interface PagedList<T> {
  items: T[]
  loading: boolean
  error: Error | null
  /** Whether the pager is worth showing (not on the first-and-only page). */
  paged: boolean
  /** Spread into `<Pager {...pagerProps} />`. */
  pagerProps: PagerProps
}

/**
 * Cursor-paginated fetching in one hook: it wires {@link useCursorPager} to a
 * `Page`-returning fetcher and hands back the items plus ready-to-spread
 * `<Pager>` props. The fetcher receives a {@link PageArgs} (`{ limit, cursor }`)
 * — the hook owns the cursor stack, so callers never thread it themselves.
 *
 * `resetKey` is the data identity (e.g. `network|id|filter`): pagination resets
 * when it changes. `opts.enabled === false` skips the fetch (an empty page, no
 * request) — for panels that don't load until opened. `opts.pollMs` turns on
 * live polling; while polling, the list pins to the first page (a live feed is
 * newest-first, so paging deeper is meaningless) and `paged` is false so the
 * caller hides the pager.
 */
export function usePagedList<T>(
  resetKey: string,
  fetcher: (args: PageArgs, signal: AbortSignal) => Promise<Page<T>>,
  opts: { enabled?: boolean; pollMs?: number | null } = {},
): PagedList<T> {
  const { enabled = true, pollMs = null } = opts
  const pager = useCursorPager(resetKey)
  const live = pollMs != null && pollMs > 0
  // A live feed surfaces new items at the top, so it always reads the first page.
  const cursor = live ? null : pager.after

  const { data, loading, error } = usePolledAsync(
    (signal) =>
      enabled
        ? fetcher({ limit: pager.pageSize, cursor }, signal)
        : Promise.resolve(emptyPage<T>()),
    [resetKey, pager.pageSize, cursor, enabled],
    live ? pollMs : null,
  )

  const hasNext = data?.hasNextPage === true
  return {
    items: data?.items ?? (NO_ITEMS as readonly T[] as T[]),
    loading,
    error,
    paged: !live && (pager.pageIndex > 0 || hasNext),
    pagerProps: {
      pageIndex: pager.pageIndex,
      pageSize: pager.pageSize,
      onPageSize: pager.setPageSize,
      hasNext,
      onPrev: pager.prev,
      onNext: () => pager.next(data?.endCursor ?? null),
    },
  }
}

/** Page-size select + prev/next controls; render in a PanelSection `action`. */
export function Pager({
  pageIndex,
  pageSize,
  onPageSize,
  hasNext,
  onPrev,
  onNext,
  label = 'items',
}: PagerProps & {
  /** Noun for the per-page select's aria-label, e.g. "transactions". */
  label?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <select
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="bg-surface border-line text-muted border px-2 py-1 font-mono text-xs"
        aria-label={`${label} per page`}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n} / page
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onPrev}
          disabled={pageIndex === 0}
          aria-label="previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-muted w-14 text-center font-mono text-xs">
          page {pageIndex + 1}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
