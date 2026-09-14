import { CopyButton } from '@/components/ui/CopyButton'
import { useNetwork } from '@/context/useNetwork'
import { cn } from '@/lib/cn'
import { walrusBlobUrl } from '../types'

/**
 * A Blob ID in Walrus notation (base64url of the 32 LE bytes — what
 * `walrus read`, aggregators and explorers take): copyable, and a link to the
 * blob at the network's public aggregator when it's readable. The full id
 * always sits in the tooltip and is what copies.
 */
export function WalrusBlobId({
  blobId,
  readable,
  truncate = false,
  className,
}: {
  blobId: string
  /** Certified and unexpired on a live deployment — link it; else plain text. */
  readable: boolean
  /** `9jMB47B3…Yvg` for list rows; the full 43 chars otherwise. */
  truncate?: boolean
  className?: string
}) {
  const { network } = useNetwork()
  const url = readable ? walrusBlobUrl(network, blobId) : null
  const text = truncate ? `${blobId.slice(0, 8)}…${blobId.slice(-3)}` : blobId
  const title = url ? `blob id ${blobId} — open at the public aggregator` : `blob id ${blobId}`
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="hash text-primary truncate hover:underline"
          title={title}
        >
          {text}
        </a>
      ) : (
        <span className="hash text-text truncate" title={title}>
          {text}
        </span>
      )}
      <CopyButton value={blobId} label="Copy blob id" className="shrink-0" />
    </span>
  )
}
