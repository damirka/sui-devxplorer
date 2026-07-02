import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { LiveControl, useLivePoll } from '@/components/ui/LiveControl'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchTransactions, fetchRecentSuccessRate, type TxFilter } from '@/lib/transaction'
import { TransactionList } from './TransactionList'
import { SuccessRate } from './SuccessRate'

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
  const { pollMs, controlProps } = useLivePoll()

  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}|${relation}`,
    (args, signal) =>
      fetchTransactions(network, filterFor(relation, id), args, signal),
    { pollMs },
  )

  // Recent-activity health: success rate over the last 50 matching txs. One
  // small query, independent of the paged list / live polling.
  const successRate = useAsync(
    (signal) => fetchRecentSuccessRate(network, filterFor(relation, id), 50, signal),
    [network, id, relation],
  )

  const showSender = relation !== 'sent'

  return (
    <Panel>
      <PanelSection
        label={label}
        action={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SuccessRate rate={successRate.data} />
            <LiveControl {...controlProps} />
            {paged && <Pager {...pagerProps} label="transactions" />}
          </div>
        }
      >
        <TransactionList
          items={items}
          loading={loading}
          error={error}
          empty="no transactions."
          showSender={showSender}
        />
      </PanelSection>
    </Panel>
  )
}
