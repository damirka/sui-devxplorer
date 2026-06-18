import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { usePolledAsync } from '@/lib/useAsync'
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

  // "Live" mode polls for new transactions. New txs land at the top (the feed is
  // newest-first), so live pins to the first page and hides the pager.
  const [live, setLive] = useState(false)
  const [intervalSec, setIntervalSec] = useState(1)
  const after = live ? null : pager.after
  const pollMs = live ? Math.max(1, intervalSec) * 1000 : null

  const { data, loading, error } = usePolledAsync(
    (signal) =>
      fetchTransactions(
        network,
        filterFor(relation, id),
        { first: pager.pageSize, after },
        signal,
      ),
    [network, id, relation, pager.pageSize, after],
    pollMs,
  )

  const showSender = relation !== 'sent'

  return (
    <Panel>
      <PanelSection
        label={label}
        action={
          <div className="flex items-center gap-3">
            <LiveControl
              live={live}
              onToggle={() => setLive((v) => !v)}
              intervalSec={intervalSec}
              onIntervalChange={setIntervalSec}
            />
            {!live && (
              <Pager
                pageIndex={pager.pageIndex}
                pageSize={pager.pageSize}
                onPageSize={pager.setPageSize}
                hasNext={!!data?.hasNextPage}
                onPrev={pager.prev}
                onNext={() => pager.next(data?.endCursor ?? null)}
                label="transactions"
              />
            )}
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

/** Auto-refresh control: a `live` toggle (pulsing when on) plus the poll interval
 * in seconds. While live, the list refreshes in place to surface new txs. */
function LiveControl({
  live,
  onToggle,
  intervalSec,
  onIntervalChange,
}: {
  live: boolean
  onToggle: () => void
  intervalSec: number
  onIntervalChange: (sec: number) => void
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={live}
        title={
          live
            ? 'stop auto-refresh'
            : 'auto-refresh to watch for new transactions'
        }
        className={cn(
          'inline-flex items-center gap-1.5 border px-2 py-1 transition-colors',
          live
            ? 'border-secondary text-secondary'
            : 'border-line text-muted hover:border-primary hover:text-primary',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            live ? 'bg-secondary animate-pulse' : 'bg-muted',
          )}
        />
        live
      </button>
      {live && (
        <label className="text-muted inline-flex items-center gap-1">
          every
          <input
            type="number"
            min={1}
            value={intervalSec}
            onChange={(e) => onIntervalChange(Math.max(1, Number(e.target.value) || 1))}
            aria-label="refresh interval in seconds"
            className="bg-surface border-line w-10 border px-1 py-0.5 text-center"
          />
          s
        </label>
      )}
    </div>
  )
}
