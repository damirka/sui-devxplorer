import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { RowIndex } from '@/components/ui/RowIndex'
import { Badge } from '@/components/ui/Badge'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { LinkedHash, TypeLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  describeOwner,
  fetchObjectsByType,
  fetchTypeDefiningId,
  type ObjectOwner,
  type TypeObject,
} from '@/lib/object'

/** Owner kind as a muted tag (shared / immutable / address / object …). */
function OwnerBadge({ owner }: { owner: ObjectOwner | null }) {
  return (
    <Badge tone="muted" className="shrink-0">
      {describeOwner(owner).kind}
    </Badge>
  )
}

/**
 * Live objects of a Move type, network-wide — a paginated list shown under a
 * type's definition. Backed by the top-level `objects(filter:{type})` connection
 * (see `fetchObjectsByType`), which a struct with the `key` ability can have
 * instances of; the caller gates rendering on that.
 *
 * Collapsed by default — a type can have thousands of objects, so nothing is
 * fetched until the user expands it (`enabled: open`, and the defining-id
 * resolution is gated on `open` too).
 *
 * The type-filter only matches the type's *defining* package id, so we resolve
 * that first via `fetchTypeDefiningId` (the navigated id may be an upgraded one,
 * which matches nothing). A base type with type params lists every concrete
 * combo, so each row shows its full type repr to tell instances apart.
 */
export function TypeObjects({
  packageId,
  module,
  name,
}: {
  packageId: string
  module: string
  name: string
}) {
  const { network } = useNetwork()
  const [open, setOpen] = useState(false)

  // Resolve the defining id (only once opened). On failure we fall back to the
  // navigated id, which is usually already the defining one.
  const defining = useAsync(
    (signal) =>
      open
        ? fetchTypeDefiningId(network, packageId, module, name, signal)
        : Promise.resolve(null),
    [network, packageId, module, name, open],
  )
  const resolved = open && !defining.loading
  const definingType = `${defining.data ?? packageId}::${module}::${name}`

  const list = usePagedList<TypeObject>(
    `${network}|${definingType}`,
    (args, signal) => fetchObjectsByType(network, definingType, args, signal),
    { enabled: resolved },
  )

  return (
    <Panel>
      <PanelSection
        label={
          <CollapseToggle
            open={open}
            onToggle={() => setOpen((o) => !o)}
            label="Objects of this type"
          />
        }
        action={
          open ? (
            list.paged ? (
              <Pager {...list.pagerProps} label="objects" />
            ) : undefined
          ) : (
            <span className="text-muted/60 font-mono text-[0.625rem] tracking-wide">
              show
            </span>
          )
        }
      >
        {open && (
          <DataList
            loading={!resolved || list.loading}
            error={list.error}
            items={list.items}
            empty="no objects of this type exist on this network."
            scroll
          >
            {(o, i) => (
              <li key={o.address} className="flex items-start gap-3 py-2.5">
                <RowIndex n={i + 1} />
                <span className="shrink-0">
                  <LinkedHash value={o.address} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {o.type && <TypeLink type={o.type} />}
                  {o.name && (
                    <span className="text-muted truncate" title={o.name}>
                      {o.name}
                    </span>
                  )}
                </span>
                <OwnerBadge owner={o.owner} />
              </li>
            )}
          </DataList>
        )}
      </PanelSection>
    </Panel>
  )
}
