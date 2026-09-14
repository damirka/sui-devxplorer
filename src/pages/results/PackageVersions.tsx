import { useState } from 'react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { MenuRow } from '@/components/ui/MenuRow'
import { LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/cn'
import { fetchPackageVersions, type PackageVersionRef } from '@/lib/object'
import { formatTimestamp } from '@/lib/format'

const COLLAPSE_AT = 5

/**
 * The package's upgrade chain — every published version as its own immutable
 * object, latest first, each linked. The one being viewed and the latest are
 * marked ("latest", not "live": every version stays callable on chain), and
 * each row names the transaction that published or upgraded it. Collapsed to
 * the first few with a toggle, so a long chain doesn't dominate.
 *
 * Renders nothing until loaded (most packages are never upgraded, so a
 * placeholder would flash and vanish), for a never-upgraded package, and for
 * a system package (0x1, 0x2, 0x3, …), whose versions all live at the same
 * address and so have no chain to walk. This is the one versions list a
 * package page has: an MVR name's registry versions are the same chain, so
 * `MvrPanel` doesn't repeat it.
 */
export function PackageVersions({ packageId }: { packageId: string }) {
  const { network } = useNetwork()
  const { data } = useAsync(
    () => fetchPackageVersions(network, packageId),
    [network, packageId],
  )
  const [expanded, setExpanded] = useState(false)

  if (!data || new Set(data.map((v) => v.address)).size < 2) return null

  // Latest first — the natural order, and it keeps the latest version visible
  // when the list is collapsed.
  const ordered = [...data].sort((a, b) => b.version - a.version)
  const latest = ordered[0]
  const collapsible = ordered.length > COLLAPSE_AT
  const shown = collapsible && !expanded ? ordered.slice(0, COLLAPSE_AT) : ordered

  return (
    <Panel>
      <PanelSection
        label="Versions"
        action={<span className="text-muted font-mono text-xs">{data.length} published</span>}
      >
        <ul
          className={cn(
            'divide-line divide-y font-mono text-xs',
            expanded && 'max-h-[22rem] overflow-y-auto',
          )}
        >
          {shown.map((v) => (
            <VersionRow key={v.version} v={v} viewing={v.address === packageId} latest={v === latest} />
          ))}
        </ul>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-muted hover:text-primary mt-2.5 font-mono text-xs transition-colors"
          >
            {expanded ? '− show fewer' : `+ show all ${data.length} versions`}
          </button>
        )}
      </PanelSection>
    </Panel>
  )
}

function VersionRow({
  v,
  viewing,
  latest,
}: {
  v: PackageVersionRef
  viewing: boolean
  latest: boolean
}) {
  return (
    <MenuRow n={v.version} wrap>
      <LinkedHash value={v.address} />
      {viewing && <span className="text-primary">· viewing</span>}
      {latest && !viewing && <span className="text-muted">· latest</span>}
      {/* Fixed-width trailing columns — verb, digest, time — so rows line up
          whatever the verb, digest, or time-zone suffix. */}
      {v.tx && (
        <span className="text-muted/70 ml-auto flex shrink-0 items-center gap-2">
          <span className="w-[4.75rem] text-right">{v.version === 1 ? 'published' : 'upgraded'}</span>
          <LinkedHash value={v.tx.digest} />
          {v.tx.timestamp && (
            <span className="w-[16.5rem] text-right tabular-nums">{formatTimestamp(v.tx.timestamp)}</span>
          )}
        </span>
      )}
    </MenuRow>
  )
}
