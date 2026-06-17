import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { SkeletonLines } from '@/components/ui/Skeleton'
import { LinkedHash, EntityLink, useSearchHref } from '@/components/ui/links'
import { RowIndex } from '@/components/ui/RowIndex'
import { Muted } from '@/components/ui/Field'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchPackageLinkage } from '@/lib/object'
import { reverseResolveMvrBulk } from '@/lib/mvr'
import { normalizeSuiId } from '@/lib/search'

/** Well-known system packages → friendly names, shown instead of the raw id. */
const SYSTEM_NAMES = new Map<string, string>([
  [normalizeSuiId('1'), 'move stdlib'],
  [normalizeSuiId('2'), 'sui framework'],
  [normalizeSuiId('3'), 'sui system'],
  [normalizeSuiId('b'), 'sui bridge'],
])

interface DepRow {
  /** The dep version actually linked into this package. */
  upgradedId: string
  /** The dep's original (defining) id — used for naming/dedup. */
  originalId: string
  /** The dep's on-chain package version. */
  version: number
  /** Friendly name for a system package (e.g. "sui framework"), else null. */
  framework: string | null
  /** MVR name, when a third-party dep registered a reverse mapping. */
  mvrName: string | null
}

/**
 * A package's dependencies, from its on-chain `linkage` — including the Sui
 * framework / system packages, which are shown by name (move stdlib, sui
 * framework, …) rather than as a bare id. Third-party deps additionally show
 * their MVR name when one is registered, plus the on-chain version and a link to
 * the exact linked package id.
 */
export function PackageDependencies({ packageId }: { packageId: string }) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const { data, loading, error } = useAsync(
    async (signal): Promise<DepRow[]> => {
      const links = await fetchPackageLinkage(network, packageId, signal)
      if (links.length === 0) return []

      // MVR reverse-resolution only matters for third-party deps; system
      // packages get a fixed friendly name, so don't waste a lookup on them.
      const thirdParty = links.filter((l) => !SYSTEM_NAMES.has(l.originalId))
      const ids = [
        ...new Set(thirdParty.flatMap((d) => [d.upgradedId, d.originalId])),
      ]
      const names = ids.length
        ? await reverseResolveMvrBulk(network, ids, signal)
        : {}
      return links.map((d) => ({
        upgradedId: d.upgradedId,
        originalId: d.originalId,
        version: d.version,
        framework: SYSTEM_NAMES.get(d.originalId) ?? null,
        mvrName: names[d.upgradedId] ?? names[d.originalId] ?? null,
      }))
    },
    [network, packageId],
  )

  return (
    <Panel>
      <PanelSection
        label="Dependencies"
        action={
          data && data.length > 0 ? (
            <span className="text-muted font-mono text-xs">{data.length}</span>
          ) : undefined
        }
      >
        {loading ? (
          <SkeletonLines count={3} />
        ) : error ? (
          <span className="text-danger font-mono text-xs">{error.message}</span>
        ) : data && data.length > 0 ? (
          <ul className="divide-line max-h-[28rem] divide-y overflow-y-auto font-mono text-xs">
            {data.map((d, i) => (
              <li key={d.upgradedId} className="flex items-center gap-3 py-2.5">
                <RowIndex n={i + 1} />
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {d.framework ? (
                    <Link
                      to={searchHref(d.upgradedId)}
                      title={d.upgradedId}
                      className="text-primary hover:underline"
                    >
                      {d.framework}
                    </Link>
                  ) : d.mvrName ? (
                    <EntityLink id={d.mvrName} />
                  ) : (
                    <LinkedHash value={d.upgradedId} />
                  )}
                  <span className="text-muted shrink-0">v{d.version}</span>
                </span>
                {(d.framework || d.mvrName) && <LinkedHash value={d.upgradedId} />}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>no dependencies.</Muted>
        )}
      </PanelSection>
    </Panel>
  )
}
