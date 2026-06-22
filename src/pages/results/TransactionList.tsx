import { DataList } from '@/components/ui/DataList'
import { TransactionRow } from './TransactionRow'
import type { TxListItem } from '@/lib/transaction'

/**
 * The body of a transaction feed: a page of {@link TxListItem}s mapped onto
 * {@link TransactionRow}s inside the shared {@link DataList} chrome (loading /
 * error / empty states + the divided list). Shared by the address/object/function
 * feed ({@link Txs}) and a checkpoint's transactions ({@link CheckpointTxs}) so the
 * per-row wiring lives in exactly one place. Feeds with their own per-row extras
 * (e.g. `ObjectTransactions`' version link) render `TransactionRow` directly.
 */
export function TransactionList({
  items,
  loading,
  error,
  empty,
  showSender = true,
  scroll = false,
}: {
  items: TxListItem[]
  loading: boolean
  error: Error | null
  /** Shown when the fetch resolved with no transactions. */
  empty: string
  /** Show the `by <sender>` cell. Off for a feed already scoped to one sender. */
  showSender?: boolean
  /** Cap the height and scroll — for long in-page lists. */
  scroll?: boolean
}) {
  return (
    <DataList loading={loading} error={error} items={items} empty={empty} scroll={scroll}>
      {(tx, i) => (
        <TransactionRow
          key={tx.digest}
          index={i + 1}
          digest={tx.digest}
          timestamp={tx.timestamp}
          sender={showSender ? tx.sender : null}
          status={tx.status}
          gas={tx.gas}
        />
      )}
    </DataList>
  )
}
