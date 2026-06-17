import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZES = [10, 25, 50]

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

/** Page-size select + prev/next controls; render in a PanelSection `action`. */
export function Pager({
  pageIndex,
  pageSize,
  onPageSize,
  hasNext,
  onPrev,
  onNext,
  label = 'items',
}: {
  pageIndex: number
  pageSize: number
  onPageSize: (n: number) => void
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
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
