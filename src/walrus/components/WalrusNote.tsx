import { useNetwork } from '@/context/useNetwork'
import { walrusDeployment } from '../registry'
import { parseWalrusBlob, parseWalrusStorage, walrusRetiredType, walrusTypeKind } from '../types'
import { WalrusBlobNote, WalrusStorageNote } from './WalrusBlobNote'
import { WalrusSystemNote } from './WalrusSystemNote'
import { WalrusPackageNote } from './WalrusPackageNote'

/**
 * The one Walrus slot under an object header. Picks the callout for the page
 * — the System / Staking summary, the package's protocol objects, a blob's
 * description, a storage resource's span — or renders nothing, so the host
 * mounts it unconditionally.
 */
export function WalrusNote({
  value,
  type,
  json,
  isPackage = false,
}: {
  value: string
  /** The object's Move type repr, when loaded. */
  type: string | null
  /** Its Move contents, when loaded. */
  json: unknown
  /** The page is a Move package — maybe a version of the Walrus package. */
  isPackage?: boolean
}) {
  const { network } = useNetwork()
  const d = walrusDeployment(network)
  if (value === d?.systemId) return <WalrusSystemNote which="system" />
  if (value === d?.stakingId) return <WalrusSystemNote which="staking" />
  if (isPackage) return <WalrusPackageNote value={value} />
  const retired = walrusRetiredType(type)
  switch (walrusTypeKind(type) ?? retired?.kind) {
    case 'blob': {
      const blob = parseWalrusBlob(value, json)
      return blob && <WalrusBlobNote blob={blob} retired={retired?.title ?? null} />
    }
    case 'storage': {
      const storage = parseWalrusStorage(json)
      return storage && <WalrusStorageNote storage={storage} retired={retired?.title ?? null} />
    }
    default:
      return null
  }
}
