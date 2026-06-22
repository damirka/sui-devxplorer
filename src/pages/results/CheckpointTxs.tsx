import { Pager, usePagedList } from '@/components/ui/Pager'
import { useNetwork } from '@/context/useNetwork'
import { fetchTransactions } from '@/lib/transaction'
import { TransactionList } from './TransactionList'

/**
 * The transactions sealed in one checkpoint — lazily loaded (only mounts when its
 * row is expanded) and paginated via the shared tx-list machinery. The feed is
 * frozen while this is open, so the checkpoint never moves out from under it.
 */
export function CheckpointTxs({
  sequenceNumber,
  txCount,
}: {
  sequenceNumber: number
  /** The checkpoint's tx count (for the header), when known. */
  txCount: number | null
}) {
  const { network } = useNetwork()
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|cp:${sequenceNumber}`,
    (args, signal) =>
      fetchTransactions(network, { atCheckpoint: sequenceNumber }, args, signal),
  )
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="panel-label">
          transactions{txCount != null ? ` · ${txCount}` : ''}
        </span>
        <span className="rule" />
        {paged && <Pager {...pagerProps} label="transactions" />}
      </header>
      <TransactionList
        items={items}
        loading={loading}
        error={error}
        empty="no transactions in this checkpoint."
        scroll
      />
    </div>
  )
}
