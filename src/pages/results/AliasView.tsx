import { EmptyState } from '@/components/ui/EmptyState'
import { useNetwork } from '@/context/useNetwork'
import { NETWORK_ALIASES } from '@/lib/aliases'
import { fetchPackageVersions } from '@/lib/object'
import { useAsync } from '@/lib/useAsync'
import { ObjectView } from './ObjectView'
import { PackageView } from './PackageView'
import { ResultHeader } from './ResultHeader'

/**
 * The `alias` search kind: a keyword from `NETWORK_ALIASES` (`usdc`,
 * `walrus-system`, …) resolved to this network's target — a type path renders
 * as that type's package page, an id as the object. A `latestVersion` alias
 * names a package's original id and opens the newest version of its chain.
 * The URL keeps the keyword, so the same bookmark opens the mainnet or testnet
 * entity.
 */
export function AliasView({ value, version = null }: { value: string; version?: number | null }) {
  const { network } = useNetwork()
  const alias = NETWORK_ALIASES[value]
  const target = (network === 'custom' ? undefined : alias?.targets[network]) ?? null
  const wantLatest = !!alias?.latestVersion && target != null
  const latest = useAsync(
    () =>
      wantLatest && target
        ? fetchPackageVersions(network, target).then((chain) => chain[chain.length - 1]?.address ?? target)
        : Promise.resolve(null),
    [network, target, wantLatest],
  )
  if (target) {
    if (target.includes('::')) return <PackageView value={target} />
    if (!wantLatest) return <ObjectView value={target} version={version} />
    if (latest.data) return <ObjectView value={latest.data} version={version} />
    if (latest.loading) return null
    return <ObjectView value={target} version={version} />
  }
  return (
    <div>
      <ResultHeader kind="alias" label="Alias" value={value} />
      <EmptyState title="not on this network">
        {alias
          ? `${alias.label} isn't on ${network} — it's on ${Object.keys(alias.targets).join(' and ')}.`
          : `no such alias: ${value}`}
      </EmptyState>
    </div>
  )
}
