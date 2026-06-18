import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Pager, usePagedList } from '@/components/ui/Pager'
import { DataList } from '@/components/ui/DataList'
import { CollapseToggle } from '@/components/ui/CollapseToggle'
import { useVersionHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { describeOwner, fetchObjectVersions } from '@/lib/object'
import { formatAddress, formatTimestamp } from '@/lib/format'
import { truncateMiddle } from '@/lib/search'
import { cn } from '@/lib/cn'

/**
 * An object's version history, newest-first. Each row pins the object to that
 * version (`?version=`), so you can time-travel its state; the row for the
 * version currently being viewed is highlighted. Pairs with the left/right
 * arrow-key stepper wired up in `ObjectView`.
 *
 * Collapsed by default — a power feature kept out of the way — and the history
 * isn't fetched until it's opened (`enabled: open`).
 */
export function ObjectHistory({
  id,
  currentVersion,
  showOwners = false,
}: {
  id: string
  /** The version currently shown — its row is highlighted. */
  currentVersion: number | null
  /** Show who owned the object at each version. Only meaningful for
   *  address/object-owned objects — off for shared/immutable. */
  showOwners?: boolean
}) {
  const { network } = useNetwork()
  const versionHref = useVersionHref()
  const [open, setOpen] = useState(false)
  const { items, loading, error, paged, pagerProps } = usePagedList(
    `${network}|${id}`,
    (args, signal) => fetchObjectVersions(network, id, args, signal),
    { enabled: open },
  )

  return (
    <Panel>
      <PanelSection
        label={
          <CollapseToggle
            open={open}
            onToggle={() => setOpen((o) => !o)}
            label="Version history"
          />
        }
        action={
          open ? (
            <span className="flex items-center gap-3">
              <span className="text-muted/60 hidden font-mono text-[0.625rem] tracking-wide sm:inline">
                ←/→ to step
              </span>
              {paged && <Pager {...pagerProps} label="versions" />}
            </span>
          ) : (
            <span className="text-muted/60 font-mono text-[0.625rem] tracking-wide">
              show
            </span>
          )
        }
      >
        {open && (
          <DataList
            loading={loading}
            error={error}
            items={items}
            empty="no version history."
          >
            {(v) => {
              const active = v.version === currentVersion
              const ownerAddr = describeOwner(v.owner).address
              return (
                <li key={v.version}>
                  <Link
                    to={versionHref(v.version)}
                    title={`view this object at v${v.version}`}
                    className={cn(
                      '-mx-2 flex items-center gap-x-3 px-2 py-2.5 transition-colors',
                      active ? 'bg-primary/10 text-primary' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular-nums',
                        active ? 'text-primary' : 'text-text',
                      )}
                    >
                      v{v.version}
                    </span>
                    <span className="text-muted shrink-0">
                      {formatTimestamp(v.timestamp)}
                    </span>
                    {showOwners && ownerAddr && (
                      <span className="text-muted shrink-0" title="owner at this version">
                        owner <span className="hash">{formatAddress(ownerAddr)}</span>
                      </span>
                    )}
                    {v.txDigest && (
                      <span className="hash text-muted ml-auto shrink-0">
                        {truncateMiddle(v.txDigest)}
                      </span>
                    )}
                    {active && (
                      <span className="border-primary/40 text-primary shrink-0 border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase">
                        viewing
                      </span>
                    )}
                  </Link>
                </li>
              )
            }}
          </DataList>
        )}
      </PanelSection>
    </Panel>
  )
}
