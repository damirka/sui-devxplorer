import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { LiveControl, useLivePoll } from '@/components/ui/LiveControl'
import { DataList } from '@/components/ui/DataList'
import { LinkedHash, useVersionHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { describeOwner, fetchObjectVersions, type ObjectVersionNode } from '@/lib/object'
import type { ObjectRemoval } from '@/lib/transaction'
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
// One row in the feed: either the version-derived tx (a mutation that produced a
// new version) or the removing tx. Deletion doesn't produce a new version, so it
// never appears in `objectVersions` — it's pinned in from the parent instead.
type Row =
  | { kind: 'version'; v: ObjectVersionNode }
  | { kind: 'removal'; removal: ObjectRemoval }

export function ObjectTransactions({
  id,
  currentVersion,
  showOwners = false,
  removal = null,
}: {
  id: string
  /** The version currently being viewed — its row is marked. */
  currentVersion: number | null
  /** Surface ownership *changes* in the history: a version whose owner differs
   *  from the tx sender (a transfer / receipt) shows the new owner. Only
   *  meaningful for address/object-owned objects — off for shared/immutable. */
  showOwners?: boolean
  /** For a now-gone object: the tx that deleted / wrapped it. Pinned to the top
   *  of page 1 (it's the newest event) since it produced no version to derive it
   *  from. Omit for live objects. */
  removal?: ObjectRemoval | null
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

  // Pin the removal tx to the very top, but only on the first page (it's the
  // single newest event). The `01` index then belongs to it and versions follow.
  const showRemoval = !!removal && pagerProps.pageIndex === 0
  const rows: Row[] = [
    ...(showRemoval ? [{ kind: 'removal' as const, removal: removal! }] : []),
    ...items.map((v) => ({ kind: 'version' as const, v })),
  ]
  const removalOffset = removal ? 1 : 0

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
        <DataList loading={loading} error={error} items={rows} empty="no transactions.">
          {(row, i) => {
            if (row.kind === 'removal') {
              const { removal: r } = row
              return (
                <TransactionRow
                  key="removal"
                  index={1}
                  digest={r.digest}
                  timestamp={r.timestamp}
                  sender={r.sender ?? null}
                  status={r.status ?? null}
                  gas={r.gas}
                >
                  <span
                    className="text-danger inline-block w-[6rem] shrink-0"
                    title="this transaction removed the object"
                  >
                    {r.deleted ? 'deleted' : 'wrapped'}
                  </span>
                </TransactionRow>
              )
            }
            const { v } = row
            // Number versions continuously across pages, with the pinned removal
            // (page 1 only) holding `01`. `i` includes that removal row on page 1,
            // so discount it there to get each version's ordinal among versions.
            const versionsBefore = pagerProps.pageIndex === 0 ? i - removalOffset : i
            const index =
              removalOffset + pagerProps.pageIndex * pagerProps.pageSize + versionsBefore + 1
            // Show the owner only when it differs from the tx sender — i.e. the
            // object changed hands at this version. A self-tx (owner == sender)
            // would just repeat the sender, so it's left off.
            const ownerAddr = describeOwner(v.owner).address
            const transferredTo =
              showOwners && ownerAddr && ownerAddr !== v.sender ? ownerAddr : null
            return (
              <TransactionRow
                key={v.version}
                index={index}
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
