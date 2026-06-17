import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchTransactions, type TxFilter } from '@/lib/transaction'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/cn'

const PAGE_SIZES = [10, 25, 50]

/** What the id relates to: txs it signed, touched it, or called into it. */
export type TxRelation = 'sent' | 'object' | 'function'

function filterFor(relation: TxRelation, id: string): TxFilter {
  switch (relation) {
    case 'sent':
      return { sentAddress: id }
    case 'object':
      return { affectedObject: id }
    case 'function':
      return { function: id }
  }
}

export function Txs({
  id,
  relation,
  label = 'Transactions',
}: {
  id: string
  relation: TxRelation
  label?: string
}) {
  const { network } = useNetwork()
  const [pageSize, setPageSize] = useState(10)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    setCursors([null])
    setPageIndex(0)
  }, [id, network, relation, pageSize])

  const after = cursors[pageIndex] ?? null
  const { data, loading, error } = useAsync(
    (signal) =>
      fetchTransactions(network, filterFor(relation, id), { first: pageSize, after }, signal),
    [network, id, relation, pageSize, after],
  )

  function nextPage() {
    if (!data?.hasNextPage) return
    const end = data.endCursor
    setCursors((prev) => [...prev.slice(0, pageIndex + 1), end])
    setPageIndex((i) => i + 1)
  }

  const showSender = relation !== 'sent'

  return (
    <Panel>
      <PanelSection
        label={label}
        action={
          <div className="flex items-center gap-3">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-surface border-line text-muted border px-2 py-1 font-mono text-xs"
              aria-label="transactions per page"
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
        }
      >
        {loading ? (
          <SkeletonLines count={5} />
        ) : error ? (
          <span className="text-danger font-mono text-xs">{error.message}</span>
        ) : data && data.transactions.length > 0 ? (
          <ul className="divide-line divide-y font-mono text-xs">
            {data.transactions.map((tx, i) => (
              <li key={tx.digest} className="flex items-center gap-x-3 py-2.5">
                <span className="menu-num shrink-0 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <LinkedHash value={tx.digest} />
                <span className="text-muted shrink-0">
                  {formatTimestamp(tx.timestamp)}
                </span>
                {showSender && tx.sender && (
                  <span className="text-muted inline-flex shrink-0 items-center gap-1.5">
                    by <LinkedHash value={tx.sender} />
                  </span>
                )}
                <span
                  className={cn(
                    'ml-auto shrink-0',
                    tx.status === 'FAILURE' ? 'text-danger' : 'text-secondary',
                  )}
                >
                  {tx.status?.toLowerCase() ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted text-sm">no transactions.</span>
        )}
      </PanelSection>
    </Panel>
  )
}
