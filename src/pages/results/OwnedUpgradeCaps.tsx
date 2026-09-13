import { LinkedHash, EntityLink } from '@/components/ui/links'
import { Muted } from '@/components/ui/Field'
import type { Network } from '@/context/network-context'
import { useAsync } from '@/lib/useAsync'
import type { OwnedUpgradeCapNode } from '@/lib/object'
import { upgradeCapData, policyLabel, type UpgradeCapData } from '@/lib/upgradeCap'
import { reverseResolveMvrBulk } from '@/lib/mvr'
import { MenuRow } from '@/components/ui/MenuRow'

export interface CapRow extends UpgradeCapData {
  /** The UpgradeCap object's own id. */
  id: string
}

/** Parse owned-cap nodes into rows, dropping anything that isn't a cap. */
export function toCapRows(caps: OwnedUpgradeCapNode[]): CapRow[] {
  return caps.flatMap((n) => {
    const cap = upgradeCapData(n.type, n.json)
    return cap ? [{ id: n.address, ...cap }] : []
  })
}

/**
 * Reverse-resolve the MVR names of the packages a set of cap rows govern, in a
 * single bulk call → `{ packageId: name }`. Re-runs only when the set of ids
 * changes. Names are best-effort (only packages with a registered reverse
 * mapping resolve), so the map is sparse.
 */
export function useUpgradeCapPackageNames(
  network: Network,
  rows: CapRow[],
): Record<string, string> {
  const pkgIds = rows.map((r) => r.package).filter((p): p is string => !!p)
  const { data } = useAsync(
    (signal) =>
      pkgIds.length
        ? reverseResolveMvrBulk(network, pkgIds, signal)
        : Promise.resolve<Record<string, string>>({}),
    [network, pkgIds.join(',')],
  )
  return data ?? {}
}

/**
 * One cap-list row: the cap object id → the package it governs (named with its
 * MVR name when one is registered) → the upgrade policy and package version.
 * Rendered by the owned-objects UPGRADE CAPS view.
 */
export function UpgradeCapRow({
  row,
  mvrName,
  n,
}: {
  row: CapRow
  mvrName?: string
  n: number
}) {
  const meta = [
    row.policy != null ? policyLabel(row.policy) : null,
    row.version != null ? `v${row.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <MenuRow n={n} wrap>
      <LinkedHash value={row.id} />
      <span className="text-muted shrink-0" title="governs this package">
        →
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        {row.package ? (
          <>
            {mvrName && <EntityLink id={mvrName} />}
            <LinkedHash value={row.package} />
          </>
        ) : (
          <Muted>—</Muted>
        )}
      </span>
      {meta && <span className="text-muted shrink-0">{meta}</span>}
    </MenuRow>
  )
}
