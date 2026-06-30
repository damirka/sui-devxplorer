import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { LiveControl, useLivePoll } from '@/components/ui/LiveControl'
import { DataList } from '@/components/ui/DataList'
import { LinkedHash, useVersionHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { describeOwner, fetchObjectVersions } from '@/lib/object'
import { cn } from '@/lib/cn'
import { TransactionRow } from './TransactionRow'

/**
 * The transactions that touched an object, derived from its version history —
 * each on-chain version was produced by exactly one transaction. This is the
 * natural tx history for an object (every mutation is a new version) and is far
 * more reliable than the `affectedObject` tx filter, which is empty for many
 * objects. The `v{version}` tag also links back to that historical snapshot.
 *
 * Note: this surfaces txs that *changed* the object (new versions), not
 * read-only references — those don't bump the version.
 */
export function ObjectTransactions({
  id,
  currentVersion,
  showOwners = false,
}: {
  id: string
  /** The version currently being viewed — its row is marked. */
  currentVersion: number | null
  /** Surface ownership *changes* in the history: a version whose owner differs
   *  from the tx sender (a transfer / receipt) shows the new owner. Only
   *  meaningful for address/object-owned objects — off for shared/immutable. */
  showOwners?: boolean
}) {
  const { network } = useNetwork()
  const versionHref = useVersionHref()

  // "Live" mode polls for new versions — each new version is a new tx that
  // touched the object, landing at the top (the history is newest-first), so
  // `usePagedList` pins to the first page and hides the pager while polling.
  const { pollMs, controlProps } = useLivePoll()

  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}`,
    (args, signal) => fetchObjectVersions(network, id, args, signal),
    { pollMs },
  )

  return (
    <Panel>
      <PanelSection
        label="Transactions"
        action={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <LiveControl {...controlProps} />
            {paged && <Pager {...pagerProps} label="transactions" />}
          </div>
        }
      >
        <DataList loading={loading} error={error} items={items} empty="no transactions.">
          {(v, i) => {
            // Show the owner only when it differs from the tx sender — i.e. the
            // object changed hands at this version. A self-tx (owner == sender)
            // would just repeat the sender, so it's left off.
            const ownerAddr = describeOwner(v.owner).address
            const transferredTo =
              showOwners && ownerAddr && ownerAddr !== v.sender ? ownerAddr : null
            return (
              <TransactionRow
                key={v.version}
                index={pagerProps.pageIndex * pagerProps.pageSize + i + 1}
                digest={v.txDigest}
                timestamp={v.timestamp}
                sender={v.sender}
                status={v.status}
                gas={v.gas}
              >
                <Link
                  to={versionHref(v.version)}
                  title={`view this object at v${v.version}`}
                  className={cn(
                    'inline-block w-[6rem] shrink-0 tabular-nums hover:underline',
                    v.version === currentVersion ? 'text-primary' : 'text-muted',
                  )}
                >
                  v{v.version}
                </Link>
                {transferredTo && (
                  <span
                    className="text-muted inline-flex shrink-0 items-center gap-1.5"
                    title="owner after this transaction"
                  >
                    → <LinkedHash value={transferredTo} />
                  </span>
                )}
              </TransactionRow>
            )
          }}
        </DataList>
      </PanelSection>
    </Panel>
  )
}
