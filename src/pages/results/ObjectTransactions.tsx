import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash, useVersionHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchObjectVersions } from '@/lib/object'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/cn'

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
}: {
  id: string
  /** The version currently being viewed — its row is marked. */
  currentVersion: number | null
}) {
  const { network } = useNetwork()
  const versionHref = useVersionHref()
  const pager = useCursorPager(`${network}|${id}`)
  const { data, loading, error } = useAsync(
    (signal) =>
      fetchObjectVersions(
        network,
        id,
        { last: pager.pageSize, before: pager.after },
        signal,
      ),
    [network, id, pager.pageSize, pager.after],
  )

  const paged = pager.pageIndex > 0 || !!data?.hasOlder

  return (
    <Panel>
      <PanelSection
        label="Transactions"
        action={
          paged ? (
            <Pager
              pageIndex={pager.pageIndex}
              pageSize={pager.pageSize}
              onPageSize={pager.setPageSize}
              hasNext={!!data?.hasOlder}
              onPrev={pager.prev}
              onNext={() => pager.next(data?.olderCursor ?? null)}
              label="transactions"
            />
          ) : undefined
        }
      >
        {loading ? (
          <SkeletonLines count={5} />
        ) : error ? (
          <span className="text-danger font-mono text-xs">{error.message}</span>
        ) : data && data.versions.length > 0 ? (
          <ul className="divide-line divide-y font-mono text-xs">
            {data.versions.map((v, i) => (
              <li
                key={v.version}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <RowIndex n={pager.pageIndex * pager.pageSize + i + 1} />
                {v.txDigest ? (
                  <LinkedHash value={v.txDigest} />
                ) : (
                  <span className="text-muted">—</span>
                )}
                <span className="text-muted shrink-0">
                  {formatTimestamp(v.timestamp)}
                </span>
                <Link
                  to={versionHref(v.version)}
                  title={`view this object at v${v.version}`}
                  className={cn(
                    'shrink-0 tabular-nums hover:underline',
                    v.version === currentVersion ? 'text-primary' : 'text-muted',
                  )}
                >
                  v{v.version}
                </Link>
                {v.sender && (
                  <span className="text-muted inline-flex shrink-0 items-center gap-1.5">
                    by <LinkedHash value={v.sender} />
                  </span>
                )}
                <span
                  className={cn(
                    'ml-auto shrink-0',
                    v.status === 'FAILURE' ? 'text-danger' : 'text-secondary',
                  )}
                >
                  {v.status?.toLowerCase() ?? '—'}
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
