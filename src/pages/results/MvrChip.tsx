import { ExternalLink } from 'lucide-react'
import { useNetwork } from '@/context/useNetwork'
import { useAsync } from '@/lib/useAsync'
import { mvrNameForPackage, mvrAppUrl } from '@/lib/mvr'

/**
 * Compact Move Registry identity for the result header — the package's
 * `@namespace/app` name, sitting next to the package id and linking out to its
 * moveregistry.com preview.
 *
 * `knownName` (set when we arrived via a name search) is used directly; without
 * it we reverse-resolve the id, which only succeeds for packages that
 * registered a reverse mapping. Renders nothing when there's no name.
 */
export function MvrChip({
  packageId,
  knownName,
}: {
  packageId: string
  knownName?: string
}) {
  const { network } = useNetwork()
  const { data: name } = useAsync(
    (signal) => mvrNameForPackage(network, packageId, knownName, signal),
    [network, packageId, knownName],
  )

  if (!name) return null
  return (
    <a
      href={mvrAppUrl(name)}
      target="_blank"
      rel="noreferrer noopener"
      title={`${name} · view on Move Registry`}
      className="border-line text-primary hover:border-primary inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-xs transition-colors"
    >
      {name}
      <ExternalLink size={11} className="shrink-0 opacity-70" />
    </a>
  )
}
