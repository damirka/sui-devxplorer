import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { LiveControl, useLivePoll } from '@/components/ui/LiveControl'
import { useNetwork } from '@/context/useNetwork'
import { fetchTransactions, type TxFilter } from '@/lib/transaction'
import { TransactionList } from './TransactionList'

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

  const showSender = relation !== 'sent'

  return (
    <Panel>
      <PanelSection
        label={label}
        action={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
