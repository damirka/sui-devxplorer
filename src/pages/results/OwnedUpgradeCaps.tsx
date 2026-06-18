import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { RowIndex } from '@/components/ui/RowIndex'
import { LinkedHash, EntityLink } from '@/components/ui/links'
import { Muted } from '@/components/ui/Field'
import { useNetwork } from '@/context/useNetwork'
import type { Network } from '@/context/network-context'
import { useAsync } from '@/lib/useAsync'
import { fetchOwnedUpgradeCaps, type OwnedUpgradeCapNode } from '@/lib/object'
import { upgradeCapData, policyLabel, type UpgradeCapData } from '@/lib/upgradeCap'
import { reverseResolveMvrBulk } from '@/lib/mvr'

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
 * Shared by the "UpgradeCaps held" panel and the owned-objects list.
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <RowIndex n={n} />
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
    </li>
  )
}

/**
 * The `0x2::package::UpgradeCap` objects an owner holds — the upgrade authority
 * an address has over packages. Each row links to the cap object (whose page
 * decodes it in full) and to the package it governs. Cursor-paginated. With
 * `hideWhenEmpty`, renders nothing once the fetch resolves with no caps held.
 */
export function OwnedUpgradeCaps({
  id,
  hideWhenEmpty = false,
}: {
  id: string
  hideWhenEmpty?: boolean
}) {
  const { network } = useNetwork()
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}`,
    (args, signal) => fetchOwnedUpgradeCaps(network, id, args, signal),
  )

  const rows = toCapRows(items)
  const mvrNames = useUpgradeCapPackageNames(network, rows)

  const [open, setOpen] = useState(true)

  if (hideWhenEmpty && !loading && !error && rows.length === 0) {
    return null
  }

  return (
    <Panel>
      <PanelSection
        label={
          <CollapseToggle
            open={open}
            onToggle={() => setOpen((v) => !v)}
            label="UpgradeCaps held"
          />
        }
        action={
          // Pager only when expanded; the count stays visible either way so a
          // collapsed panel still tells you how many caps are held.
          open && paged ? (
            <Pager {...pagerProps} label="upgrade caps" />
          ) : rows.length > 0 ? (
            <span className="text-muted font-mono text-xs">{rows.length}</span>
          ) : undefined
        }
      >
        {open && (
          <DataList
            loading={loading}
            error={error}
            items={rows}
            empty={<Muted>no UpgradeCaps held.</Muted>}
            skeleton={3}
            scroll
          >
            {(r, i) => (
              <UpgradeCapRow
                key={r.id}
                row={r}
                mvrName={r.package ? mvrNames[r.package] : undefined}
                n={pagerProps.pageIndex * pagerProps.pageSize + i + 1}
              />
            )}
          </DataList>
        )}
      </PanelSection>
    </Panel>
  )
}
