import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchOwnedPage } from '@/lib/object'
import { formatType } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Network } from '@/context/network-context'

const PAGE_SIZES = [10, 25, 50]

export function OwnedObjects({ id }: { id: string }) {
  const { network } = useNetwork()
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  // Clear the filter when the owner or network changes.
  useEffect(() => setTypeFilter(null), [id, network])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr] lg:items-start">
      <TypesOwned
        network={network}
        id={id}
        selected={typeFilter}
        onSelect={(t) => setTypeFilter((prev) => (prev === t ? null : t))}
      />
      <OwnedList
        network={network}
        id={id}
        typeFilter={typeFilter}
        onClearFilter={() => setTypeFilter(null)}
      />
    </div>
  )
}

/* ── paginated object list (optionally filtered to one type) ─────────── */

function OwnedList({
  network,
  id,
  typeFilter,
  onClearFilter,
}: {
  network: Network
  id: string
  typeFilter: string | null
  onClearFilter: () => void
}) {
  const [pageSize, setPageSize] = useState(10)
  // cursors[i] is the `after` used to fetch page i; cursors[0] is null.
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)

  // Reset paging whenever the owner, network, page size, or filter changes.
  useEffect(() => {
    setCursors([null])
    setPageIndex(0)
  }, [id, network, pageSize, typeFilter])

  const after = cursors[pageIndex] ?? null
  const { data, loading, error } = useAsync(
    (signal) =>
      typeFilter
        ? fetchOwnedPage(
            network,
            id,
            { first: pageSize, after, type: typeFilter, display: true },
            signal,
          )
        : Promise.resolve(null),
    [network, id, pageSize, after, typeFilter],
  )

  function nextPage() {
    if (!data?.hasNextPage) return
    const end = data.endCursor
    setCursors((prev) => [...prev.slice(0, pageIndex + 1), end])
    setPageIndex((i) => i + 1)
  }

  return (
    <Panel>
      <PanelSection
        label="Owned objects"
        action={
          typeFilter ? (
            <div className="flex items-center gap-3">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-surface border-line text-muted border px-2 py-1 font-mono text-xs"
                aria-label="objects per page"
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
                  onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
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
                  onClick={nextPage}
                  disabled={!data?.hasNextPage}
                  aria-label="next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        {!typeFilter ? (
          <EmptyState title="no type selected">
            select a type from the list to list the objects of that type owned
            here.
          </EmptyState>
        ) : (
          <>
            <button
              type="button"
              onClick={onClearFilter}
              className="border-line text-muted hover:text-primary mb-3 inline-flex max-w-full items-center gap-1.5 border px-2 py-1 font-mono text-xs transition-colors"
              title={`clear filter: ${typeFilter}`}
            >
              <span className="hash truncate">{formatType(typeFilter)}</span>
              <X size={12} className="shrink-0" />
            </button>

            {loading ? (
              <SkeletonLines count={5} />
            ) : error ? (
              <span className="text-danger font-mono text-xs">
                {error.message}
              </span>
            ) : data && data.objects.length > 0 ? (
              <ul className="divide-line divide-y font-mono text-xs">
                {data.objects.map((o, i) => (
                  <li key={o.address} className="flex items-center gap-3 py-2.5">
                    <span className="menu-num shrink-0 tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <LinkedHash value={o.address} />
                    {(o.name || o.description) && (
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={[o.name, o.description]
                          .filter(Boolean)
                          .join(' — ')}
                      >
                        {o.name && <span className="text-text">{o.name}</span>}
                        {o.name && o.description && (
                          <span className="text-muted"> · </span>
                        )}
                        {o.description && (
                          <span className="text-muted">{o.description}</span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted text-sm">
                no owned objects of this type.
              </span>
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  )
}

/* ── background full-ownership scan → unique types ───────────────────── */

interface ScanState {
  types: { type: string; count: number }[]
  total: number
  done: boolean
  error: string | null
}

function useOwnedTypeScan(network: Network, id: string): ScanState {
  const [state, setState] = useState<ScanState>({
    types: [],
    total: 0,
    done: false,
    error: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState({ types: [], total: 0, done: false, error: null })

    const counts = new Map<string, number>()
    let total = 0
    let after: string | null = null

    void (async () => {
      try {
        for (;;) {
          const page = await fetchOwnedPage(
            network,
            id,
            { first: 50, after },
            controller.signal,
          )
          for (const o of page.objects) {
            total++
            const t = o.type ?? '(unknown)'
            counts.set(t, (counts.get(t) ?? 0) + 1)
          }
          if (controller.signal.aborted) return
          const types = [...counts.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
          setState({ types, total, done: !page.hasNextPage, error: null })
          if (!page.hasNextPage) break
          after = page.endCursor
        }
      } catch (e) {
        if (controller.signal.aborted) return
        setState((s) => ({
          ...s,
          done: true,
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    })()

    return () => controller.abort()
  }, [network, id])

  return state
}

function TypesOwned({
  network,
  id,
  selected,
  onSelect,
}: {
  network: Network
  id: string
  selected: string | null
  onSelect: (type: string) => void
}) {
  const { types, total, done, error } = useOwnedTypeScan(network, id)
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const shown = q
    ? types.filter((t) => t.type.toLowerCase().includes(q))
    : types

  return (
    <Panel>
      <PanelSection
        label="Types owned"
        action={
          <span className="text-muted inline-flex items-center gap-1.5 font-mono text-xs">
            {!done && <Loader2 size={12} className="animate-spin" />}
            {done
              ? `${types.length} types · ${total} objects`
              : `scanning… ${total}`}
          </span>
        }
      >
        {error ? (
          <span className="text-danger font-mono text-xs">{error}</span>
        ) : types.length > 0 ? (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter types"
              spellCheck={false}
              aria-label="filter owned types"
              className="input mb-3 !py-1.5 !text-xs"
            />
            {shown.length > 0 ? (
              <ul className="divide-line max-h-72 divide-y overflow-y-auto font-mono text-xs">
                {shown.map((t) => {
                  const active = selected === t.type
                  return (
                    <li key={t.type}>
                      <button
                        type="button"
                        onClick={() => onSelect(t.type)}
                        aria-pressed={active}
                        className={cn(
                          'flex w-full items-center justify-between gap-4 px-2 py-2 text-left transition-colors',
                          active
                            ? 'bg-surface-2 text-primary'
                            : 'text-muted hover:bg-surface-2 hover:text-primary',
                        )}
                        title={t.type}
                      >
                        <span className="hash break-all">{formatType(t.type)}</span>
                        <span className="shrink-0">{t.count}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <span className="text-muted text-sm">no types match “{filter}”.</span>
            )}
          </>
        ) : done ? (
          <span className="text-muted text-sm">no owned objects.</span>
        ) : (
          <SkeletonLines count={3} />
        )}
      </PanelSection>
    </Panel>
  )
}
