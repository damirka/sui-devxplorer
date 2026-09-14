import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
import { useSearchHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { walrusDeployment, walrusEntryFor } from '../registry'
import { useWalrusPackage } from '../useWalrusPackage'

/**
 * The callout atop any version of the Walrus package: the protocol's shared
 * objects — System, Staking, upgrade manager, subsidies — which a dev lands
 * on the package page looking for. Which version this is, and the rest of the
 * chain, is the generic Versions panel below. Renders nothing for a package
 * that isn't Walrus (decided from its upgrade chain).
 */
export function WalrusPackageNote({ value }: { value: string }) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const d = walrusDeployment(network)
  const pkg = useWalrusPackage(network, value, !!d)
  if (!d || !pkg) return null
  const objects = [
    { id: d.systemId, label: 'system' },
    { id: d.stakingId, label: 'staking' },
    ...d.entries
      .filter((e) => e.tag === 'walrus upgrade manager' || e.tag === 'walrus subsidies')
      .map((e) => ({ id: e.id, label: e.tag.replace(/^walrus /, '') })),
  ]
  return (
    <div className="border-primary/40 bg-primary/5 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-3 font-mono text-xs">
      <Database size={13} className="text-primary shrink-0" />
      <span className="panel-label shrink-0">walrus objects</span>
      {objects.map((o) => (
        <Link
          key={o.id}
          to={searchHref(o.id)}
          className="text-primary hover:underline"
          title={`${walrusEntryFor(network, o.id)?.title ?? o.label} — ${o.id}`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )
}
