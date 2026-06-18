import type { ReactNode } from 'react'
import { RowIndex } from '@/components/ui/RowIndex'
import { LinkedHash } from '@/components/ui/links'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/cn'

/** A transaction's execution status as a terminal word — green for success,
 *  alarm-red for failure, `—` when unknown. Pushed to the right of its row. */
export function TxStatus({
  status,
  className,
}: {
  status: string | null
  className?: string
}) {
  return (
    <span
      className={cn(
        'ml-auto shrink-0',
        status === 'FAILURE' ? 'text-danger' : 'text-secondary',
        className,
      )}
    >
      {status?.toLowerCase() ?? '—'}
    </span>
  )
}

/**
 * One transaction in a list — index, digest, time, an optional middle slot, the
 * sender, and the status. Shared by the address/object/function tx feed (`Txs`)
 * and an object's version-derived history (`ObjectTransactions`); the latter
 * slots its `v{n}` snapshot link into `children`.
 */
export function TransactionRow({
  index,
  digest,
  timestamp,
  sender,
  status,
  wrap = false,
  children,
}: {
  index: number
  /** Tx digest; rendered as `—` when unknown. */
  digest: string | null
  timestamp: string | null
  /** Sender address, shown as `by <hash>`; omit/null to hide. */
  sender?: string | null
  status: string | null
  /** Allow the row to wrap — denser rows (version history) pack in more cells. */
  wrap?: boolean
  /** Extra cell(s) rendered after the timestamp (e.g. a version link). */
  children?: ReactNode
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-x-3 py-2.5',
        wrap && 'flex-wrap gap-y-1',
      )}
    >
      <RowIndex n={index} />
      {digest ? <LinkedHash value={digest} /> : <span className="text-muted">—</span>}
      <span className="text-muted shrink-0">{formatTimestamp(timestamp)}</span>
      {children}
      {sender && (
        <span className="text-muted inline-flex shrink-0 items-center gap-1.5">
          by <LinkedHash value={sender} />
        </span>
      )}
      <TxStatus status={status} />
    </li>
  )
}
