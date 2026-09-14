import { ExternalLink } from 'lucide-react'
import { Panel, PanelSection } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { EntityLink } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { fetchMvrForPackage, mvrAppUrl, type MvrPackageInfo } from '@/lib/mvr'

/**
 * The Move Registry identity of a package: the `@namespace/app` name assigned
 * to it and its registry metadata (description + links), from the MVR REST
 * API, not GraphQL. The version chain is NOT repeated here — the registry's
 * `@name/N` versions are the package's on-chain upgrade chain, which the
 * generic `PackageVersions` panel below already lists.
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
  return <MvrContent info={data} />
}

function MvrContent({ info }: { info: MvrPackageInfo }) {
  const { name, record } = info
  const { iconUrl, description, homepageUrl, documentationUrl } = record.metadata

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
    </Panel>
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
