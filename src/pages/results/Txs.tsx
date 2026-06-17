import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchTransactions, type TxFilter } from '@/lib/transaction'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/cn'

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
  const pager = useCursorPager(`${network}|${id}|${relation}`)
  const { data, loading, error } = useAsync(
    (signal) =>
      fetchTransactions(
        network,
        filterFor(relation, id),
        { first: pager.pageSize, after: pager.after },
        signal,
      ),
    [network, id, relation, pager.pageSize, pager.after],
  )

  const showSender = relation !== 'sent'

  return (
    <Panel>
      <PanelSection
        label={label}
        action={
          <Pager
            pageIndex={pager.pageIndex}
            pageSize={pager.pageSize}
            onPageSize={pager.setPageSize}
            hasNext={!!data?.hasNextPage}
            onPrev={pager.prev}
            onNext={() => pager.next(data?.endCursor ?? null)}
            label="transactions"
          />
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
                <RowIndex n={i + 1} />
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
