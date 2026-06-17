import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, useCursorPager } from '@/components/ui/Pager'
import { RowIndex } from '@/components/ui/RowIndex'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash, EntityLink } from '@/components/ui/links'
import { Muted } from '@/components/ui/Field'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchMvrDependents, reverseResolveMvrBulk, mvrSupported } from '@/lib/mvr'
import { formatCount } from '@/lib/format'

/**
 * The packages that depend on this one, from the MVR API
 * (`/package-address/{id}/dependents`), ordered by call volume. Cursor-paginated
 * via the shared `Pager`. Each dependent is named with its MVR name when one is
 * registered (the page's ids reverse-resolved in a single bulk call). MVR-only,
 * so it renders nothing on networks without a registry (devnet).
 */
export function PackageDependents({ packageId }: { packageId: string }) {
  const { network } = useNetwork()
  const pager = useCursorPager(`${network}|${packageId}`)

  const { data, loading, error } = useAsync(
    (signal) =>
      fetchMvrDependents(
        network,
        packageId,
        { cursor: pager.after, limit: pager.pageSize },
        signal,
      ),
    [network, packageId, pager.after, pager.pageSize],
  )

  // Name the page's dependents in one bulk reverse-resolution.
  const ids = (data?.dependents ?? []).map((d) => d.packageId)
  const { data: names } = useAsync(
    (signal) =>
      ids.length
        ? reverseResolveMvrBulk(network, ids, signal)
        : Promise.resolve<Record<string, string>>({}),
    [network, ids.join(',')],
  )
  const mvrNames = names ?? {}

  if (!mvrSupported(network)) return null

  const rows = data?.dependents ?? []
  return (
    <Panel>
      <PanelSection
        label="Dependents"
        action={
          <div className="flex items-center gap-3">
            {data?.total != null && (
              <span className="text-muted font-mono text-xs">
                {formatCount(data.total)} total
              </span>
            )}
            {(rows.length > 0 || pager.pageIndex > 0) && (
              <Pager
                pageIndex={pager.pageIndex}
                pageSize={pager.pageSize}
                onPageSize={pager.setPageSize}
                hasNext={!!data?.nextCursor}
                onPrev={pager.prev}
                onNext={() => pager.next(data?.nextCursor ?? null)}
                label="dependents"
              />
            )}
          </div>
        }
      >
        {loading ? (
          <SkeletonLines count={3} />
        ) : error ? (
          <span className="text-danger font-mono text-xs">{error.message}</span>
        ) : rows.length > 0 ? (
          <ul className="divide-line divide-y font-mono text-xs">
            {rows.map((d, i) => {
              const name = mvrNames[d.packageId]
              return (
                <li key={d.packageId} className="flex items-center gap-3 py-2.5">
                  <RowIndex n={pager.pageIndex * pager.pageSize + i + 1} />
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    {name ? <EntityLink id={name} /> : <LinkedHash value={d.packageId} />}
                    {d.totalCalls > 0 && (
                      <span className="text-muted shrink-0">
                        {formatCount(d.totalCalls)} calls
                      </span>
                    )}
                  </span>
                  {name && <LinkedHash value={d.packageId} />}
                </li>
              )
            })}
          </ul>
        ) : (
          <Muted>no known dependents in the Move Registry.</Muted>
        )}
      </PanelSection>
    </Panel>
  )
}
