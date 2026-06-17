import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { EntityLink, LinkedHash } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import {
  fetchMvrForPackage,
  mvrAppUrl,
  type MvrPackageInfo,
  type MvrVersion,
} from '@/lib/mvr'
import { normalizeSuiId } from '@/lib/search'
import { cn } from '@/lib/cn'

/**
 * The Move Registry identity of a package: the `@namespace/app` name assigned
 * to it, its registry metadata (description + links), and the full list of
 * published versions — each linking to that version's package page. All sourced
 * from the MVR REST API, not GraphQL.
 *
 * Renders nothing for packages with no MVR name (or on networks without a
 * registry), so it can sit unconditionally at the top of the package body.
 *
 * `name`, when set, is the name this package was reached by (a forward search).
 * It's used directly so the panel works even for packages with no reverse
 * mapping; without it we fall back to reverse-resolving the id.
 */
export function MvrPanel({
  packageId,
  name,
}: {
  packageId: string
  name?: string
}) {
  const { network } = useNetwork()
  const { data } = useAsync(
    (signal) => fetchMvrForPackage(network, packageId, name ?? null, signal),
    [network, packageId, name],
  )

  if (!data) return null
  return <MvrContent packageId={packageId} info={data} />
}

function MvrContent({
  packageId,
  info,
}: {
  packageId: string
  info: MvrPackageInfo
}) {
  const { name, record, versions } = info
  const { iconUrl, description, homepageUrl, documentationUrl } = record.metadata
  const viewing = normalizeSuiId(packageId.replace(/^0x/i, '')).toLowerCase()

  return (
    <Panel>
      <PanelSection
        label="Move Registry"
        action={<Badge kind="package">mvr</Badge>}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                className="border-line bg-surface-2 size-14 shrink-0 border object-contain p-1"
              />
            )}
            <span className="flex min-w-0 items-center gap-1.5">
              <EntityLink id={name} />
              <CopyButton value={name} label="Copy name" />
            </span>
            <span className="text-muted shrink-0 font-mono text-xs">
              · v{record.version} latest
            </span>
          </div>

          {description && (
            <p className="text-muted max-w-2xl font-mono text-xs leading-relaxed">
              {description}
            </p>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <ExtLink href={mvrAppUrl(record.name)} label="moveregistry" />
            {homepageUrl && <ExtLink href={homepageUrl} label="homepage" />}
            {documentationUrl && (
              <ExtLink href={documentationUrl} label="docs" />
            )}
            {record.gitInfo && (
              <ExtLink
                href={record.gitInfo.repositoryUrl}
                label="source"
                title={`${record.gitInfo.repositoryUrl}${
                  record.gitInfo.path ? `/${record.gitInfo.path}` : ''
                }${record.gitInfo.tag ? ` @ ${record.gitInfo.tag}` : ''}`}
              />
            )}
          </div>
        </div>
      </PanelSection>

      {versions.length > 0 && (
        <VersionsList
          versions={versions}
          latest={record.version}
          viewing={viewing}
        />
      )}
    </Panel>
  )
}

const COLLAPSE_AT = 5

/** The published versions, collapsed to the first few with a toggle (and a
 * scroll cap when expanded) — a long chain (deepbook/core has ~19) shouldn't
 * dominate the panel. */
function VersionsList({
  versions,
  latest,
  viewing,
}: {
  versions: MvrVersion[]
  latest: number
  viewing: string
}) {
  const [expanded, setExpanded] = useState(false)
  // Latest first — the natural order, and it keeps the most recent versions
  // visible when the list is collapsed.
  const ordered = [...versions].sort((a, b) => b.version - a.version)
  const collapsible = ordered.length > COLLAPSE_AT
  const shown = collapsible && !expanded ? ordered.slice(0, COLLAPSE_AT) : ordered

  return (
    <PanelSection
      label="Versions"
      action={
        <span className="text-muted font-mono text-xs">
          {versions.length} published
        </span>
      }
    >
      <ul
        className={cn(
          'divide-line divide-y font-mono text-xs',
          expanded && 'max-h-[22rem] overflow-y-auto',
        )}
      >
        {shown.map((v) => {
          const isViewing = v.packageId.toLowerCase() === viewing
          const isLatest = v.version === latest
          return (
            <li key={v.version} className="flex items-center gap-3 py-2.5">
              <span className="menu-num shrink-0 tabular-nums">
                {String(v.version).padStart(2, '0')}
              </span>
              <LinkedHash value={v.packageId} />
              {isViewing && <span className="text-primary">· viewing</span>}
              {isLatest && !isViewing && (
                <span className="text-muted">· latest</span>
              )}
            </li>
          )
        })}
      </ul>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-muted hover:text-primary mt-2.5 font-mono text-xs transition-colors"
        >
          {expanded ? '− show fewer' : `+ show all ${versions.length} versions`}
        </button>
      )}
    </PanelSection>
  )
}

/** A dry external link with a trailing out-arrow, terminal-lowercase. */
function ExtLink({
  href,
  label,
  title,
}: {
  href: string
  label: string
  title?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={title ?? href}
      className="text-primary hover:underline inline-flex items-center gap-1.5 font-mono text-xs"
    >
      {label}
      <ExternalLink size={12} className="shrink-0" />
    </a>
  )
}
