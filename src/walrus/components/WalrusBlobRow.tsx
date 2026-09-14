import { Badge } from '@/components/ui/Badge'
import { MenuRow } from '@/components/ui/MenuRow'
import { LinkedHash } from '@/components/ui/links'
import { formatBytes, formatNumber } from '@/lib/format'
import { walrusBlobStatus } from '../blobs'
import type { WalrusState } from '../epochs'
import type { WalrusBlob } from '../types'
import { WalrusBlobId } from './WalrusBlobId'
import { WalrusEpochDate } from './WalrusEpoch'

/**
 * One owned-blobs row: the object id, the Blob ID (Walrus notation — a link to
 * the aggregator when readable, full id in the tooltip), size, a status badge
 * when not simply active, and its expiry dated through the epoch clock,
 * right-aligned (the epoch numbers sit in the tooltip).
 */
export function WalrusBlobRow({
  n,
  blob,
  state,
  now,
}: {
  n: number
  blob: WalrusBlob
  state: WalrusState | null
  now: number
}) {
  const status = walrusBlobStatus(blob, state)
  return (
    <MenuRow n={n} wrap>
      <LinkedHash value={blob.id} />
      <WalrusBlobId blobId={blob.blobId} readable={status === 'active'} truncate />
      <span className="text-muted shrink-0 tabular-nums" title={`${formatNumber(blob.size)} bytes`}>
        {formatBytes(blob.size)}
      </span>
      {status === 'uncertified' && (
        <Badge tone="muted" className="shrink-0" title="registered, never certified — not readable">
          uncertified
        </Badge>
      )}
      {/* Fixed-width, right-aligned expiry column so the dates line up. */}
      <span
        className="ml-auto flex w-[11.5rem] shrink-0 items-center justify-end gap-1.5 text-right"
        title={`storage covers walrus epochs ${formatNumber(blob.storage.startEpoch)} – ${formatNumber(blob.storage.endEpoch - 1)}; gone once epoch ${formatNumber(blob.storage.endEpoch)} begins`}
      >
        <span className={status === 'expired' ? 'text-danger' : 'text-muted'}>
          {status === 'expired' ? 'expired' : 'expires'}
        </span>
        <WalrusEpochDate epoch={blob.storage.endEpoch} state={state} now={now} compact className="text-muted" />
      </span>
    </MenuRow>
  )
}
