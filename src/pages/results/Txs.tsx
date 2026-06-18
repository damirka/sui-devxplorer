import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { useNetwork } from '@/context/useNetwork'
import { fetchTransactions, type TxFilter } from '@/lib/transaction'
import { cn } from '@/lib/cn'
import { TransactionRow } from './TransactionRow'

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

  // "Live" mode polls for new transactions. New txs land at the top (the feed is
  // newest-first), so `usePagedList` pins to the first page and reports
  // `paged: false` while polling — which hides the pager below.
  const [live, setLive] = useState(false)
  const [intervalSec, setIntervalSec] = useState(1)
  const pollMs = live ? Math.max(1, intervalSec) * 1000 : null

  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}|${relation}`,
    (args, signal) =>
      fetchTransactions(network, filterFor(relation, id), args, signal),
    { pollMs },
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
            {paged && <Pager {...pagerProps} label="transactions" />}
          </div>
        }
      >
        <DataList loading={loading} error={error} items={items} empty="no transactions.">
          {(tx, i) => (
            <TransactionRow
              key={tx.digest}
              index={i + 1}
              digest={tx.digest}
              timestamp={tx.timestamp}
              sender={showSender ? tx.sender : null}
              status={tx.status}
            />
          )}
        </DataList>
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
