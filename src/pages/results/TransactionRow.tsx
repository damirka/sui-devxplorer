import type { ReactNode } from 'react'
import { Fuel } from 'lucide-react'
import { RowIndex } from '@/components/ui/RowIndex'
import { LinkedHash } from '@/components/ui/links'
import { formatSui, formatTimestamp } from '@/lib/format'
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
  gas,
  children,
}: {
  index: number
  /** Tx digest; rendered as `—` when unknown. */
  digest: string | null
  timestamp: string | null
  /** Sender address, shown as `by <hash>`; omit/null to hide. */
  sender?: string | null
  status: string | null
  /** Net gas used in MIST. Omit to hide the cell; `null` shows `—` (unknown). */
  gas?: bigint | null
  /** Extra cell(s) rendered after the timestamp (e.g. a version link). */
  children?: ReactNode
}) {
  // Always wrap — it only breaks to a second line when the row can't fit (mobile),
  // so the columns never force a page-wide horizontal scroll.
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <RowIndex n={index} />
      <span className="inline-flex w-[7rem] shrink-0">
        {digest ? <LinkedHash value={digest} /> : <span className="text-muted">—</span>}
      </span>
      <span className="text-muted shrink-0 tabular-nums">
        {formatTimestamp(timestamp)}
      </span>
      {children}
      {sender && (
        <span className="text-muted inline-flex shrink-0 items-center gap-1.5">
          by <LinkedHash value={sender} />
        </span>
      )}
      {gas !== undefined && (
        <span
          className="text-muted ml-auto inline-flex w-[8.5rem] shrink-0 items-center justify-end gap-1 tabular-nums"
          title="gas used"
        >
          <Fuel size={12} />
          {gas == null ? '—' : formatSui(gas)}
        </span>
      )}
      <TxStatus status={status} />
    </li>
  )
}
