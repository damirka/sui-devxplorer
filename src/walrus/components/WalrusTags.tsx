import { Badge } from '@/components/ui/Badge'
import { useNetwork } from '@/context/useNetwork'
import { walrusEntryFor } from '../registry'
import { walrusRetiredType, walrusTypeKind, WALRUS_TYPE_TAG } from '../types'
import { useWalrusPackage } from '../useWalrusPackage'

/**
 * The Walrus header tags for an object page: what a well-known id *is*
 * (`walrus system`, `walrus package`, …) and/or what a Walrus-typed object is
 * (`walrus blob`, `staked wal`; `· retired` for a wiped deployment's). A later
 * version of the Walrus package isn't in the registry — it's recognised from
 * the package's upgrade chain. Renders nothing for anything else, so the host
 * drops it into its badge row unconditionally.
 */
export function WalrusTags({
  value,
  type,
  isPackage = false,
}: {
  value: string
  type: string | null
  /** The page is a Move package (so the upgrade chain is worth a look). */
  isPackage?: boolean
}) {
  const { network } = useNetwork()
  const entry = walrusEntryFor(network, value)
  const pkg = useWalrusPackage(network, value, isPackage && !entry)
  const kind = walrusTypeKind(type)
  const retired = walrusRetiredType(type)
  return (
    <>
      {entry && <Badge title={entry.title}>{entry.tag}</Badge>}
      {pkg && (
        <Badge
          title={`v${pkg.version} of the Walrus package${
            pkg.version === pkg.latestVersion ? ' — the latest' : ` — latest is v${pkg.latestVersion}`
          }`}
        >
          walrus package
        </Badge>
      )}
      {kind && <Badge title={WALRUS_TYPE_TAG[kind].title}>{WALRUS_TYPE_TAG[kind].tag}</Badge>}
      {retired && (
        <Badge tone="muted" title={retired.title}>
          {WALRUS_TYPE_TAG[retired.kind].tag} · retired
        </Badge>
      )}
    </>
  )
}
