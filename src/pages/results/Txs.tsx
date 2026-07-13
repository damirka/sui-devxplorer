import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { LiveControl, useLivePoll } from '@/components/ui/LiveControl'
import { TabButton } from '@/components/ui/TabButton'
import { useNetwork } from '@/context/useNetwork'
import { fetchTransactions, type TxFilter } from '@/lib/transaction'
import { TransactionList } from './TransactionList'
import { SuccessRate, useRecentSuccessRate } from './SuccessRate'

/** What the id relates to: txs it signed, that involved it as sender OR as an
 *  input/output recipient (`affected`), that touched it, or called into it. */
export type TxRelation = 'sent' | 'affected' | 'object' | 'function'

function filterFor(relation: TxRelation, id: string): TxFilter {
  switch (relation) {
    case 'sent':
      return { sentAddress: id }
    case 'affected':
      return { affectedAddress: id }
    case 'object':
      return { affectedObject: id }
    case 'function':
      return { function: id }
  }
}

export function Txs({
  id,
  relation: initialRelation,
  label = 'Transactions',
  tabs,
}: {
  id: string
  relation: TxRelation
  label?: string
  /** Offer alternate relations as a tab strip above the list — e.g. the address
   *  view's `sent | affected`. The `relation` prop is the initial tab. */
  tabs?: { relation: TxRelation; label: string }[]
}) {
  const { network } = useNetwork()
  const [relation, setRelation] = useState(initialRelation)
  const filter = filterFor(relation, id)

  // "Live" mode polls for new transactions. New txs land at the top (the feed is
  // newest-first), so `usePagedList` pins to the first page and reports
  // `paged: false` while polling — which hides the pager below.
  const { pollMs, controlProps } = useLivePoll()

  // The reset key carries the relation, so switching tabs resets pagination.
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}|${relation}`,
    (args, signal) => fetchTransactions(network, filter, args, signal),
    { pollMs },
  )

  // Recent-activity health: success rate over the last 50 matching txs. One
  // small query, independent of the paged list / live polling.
  const successRate = useRecentSuccessRate(network, filter)

  // The sender column is redundant when every row was signed by the viewed
  // address; `affected` mixes in txs sent by others, so it names them.
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
        {tabs && tabs.length > 1 && (
          <div className="border-line mb-4 flex gap-1 border-b">
            {tabs.map((t) => (
              <TabButton
                key={t.relation}
                active={relation === t.relation}
                onClick={() => setRelation(t.relation)}
              >
                {t.label}
              </TabButton>
            ))}
          </div>
        )}
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
