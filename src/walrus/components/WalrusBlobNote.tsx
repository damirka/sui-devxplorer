import { Database } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useNetwork } from '@/context/useNetwork'
import { cn } from '@/lib/cn'
import { formatBytes, formatNumber } from '@/lib/format'
import { walrusSpanStatus, type WalrusState } from '../epochs'
import { useWalrusState } from '../useWalrusState'
import { walrusEncodingName, type WalrusBlob, type WalrusStorage } from '../types'
import { WalrusBlobId } from './WalrusBlobId'
import { WalrusEpochDate } from './WalrusEpoch'

/**
 * The strip under an object header describing a Walrus blob: its Blob ID in
 * Walrus notation (what `walrus read` and the aggregators take), sizes, the
 * certification state, and its storage span dated through the Walrus epoch
 * clock. A standalone storage resource gets the span part alone.
 */
export function WalrusBlobNote({
  blob,
  retired = null,
}: {
  blob: WalrusBlob
  /** Why the blob is dead (a retired deployment) — no clock, no aggregator link. */
  retired?: string | null
}) {
  const { network } = useNetwork()
  const { state } = useWalrusState(network, !retired)
  const status = walrusSpanStatus(state, blob.storage.startEpoch, blob.storage.endEpoch)
  const certified = blob.certifiedEpoch != null
  const readable = !retired && certified && status !== 'expired'
  return (
    <Strip retired={retired}>
      <Row>
        <Label>blob id</Label>
        <WalrusBlobId blobId={blob.blobId} readable={readable} />
        {!certified && (
          <Badge tone="muted" title="registered on chain but never certified by a storage-node quorum — not readable">
            uncertified
          </Badge>
        )}
        {blob.deletable && (
          <Badge tone="muted" title="the owner can delete this blob before its storage runs out">
            deletable
          </Badge>
        )}
      </Row>
      <Row>
        <Label>size</Label>
        <span className="text-text" title={`${formatNumber(blob.size)} bytes unencoded`}>
          {formatBytes(blob.size)}
        </span>
        <span className="text-muted" title={`${formatNumber(blob.storage.storageSize)} bytes of encoded storage reserved`}>
          ({formatBytes(blob.storage.storageSize)} encoded · {walrusEncodingName(blob.encodingType)})
        </span>
        <Label className="ml-2">certified</Label>
        <span className="text-text">
          {certified ? `epoch ${formatNumber(blob.certifiedEpoch!)}` : '—'}
          <span className="text-muted"> (registered epoch {formatNumber(blob.registeredEpoch)})</span>
        </span>
      </Row>
      <StorageSpan storage={blob.storage} state={state} />
    </Strip>
  )
}

/** The strip for a standalone `storage_resource::Storage`. */
export function WalrusStorageNote({
  storage,
  retired = null,
}: {
  storage: WalrusStorage
  retired?: string | null
}) {
  const { network } = useNetwork()
  const { state } = useWalrusState(network, !retired)
  return (
    <Strip retired={retired}>
      <Row>
        <Label>reserved</Label>
        <span className="text-text" title={`${formatNumber(storage.storageSize)} bytes of encoded storage`}>
          {formatBytes(storage.storageSize)}
        </span>
      </Row>
      <StorageSpan storage={storage} state={state} />
    </Strip>
  )
}

/** `valid walrus epochs 25 – 76 · expires at epoch 77 ~Oct 12, 2026 · in 4w` —
 *  a storage span dated through the Walrus clock; reads as expired once the
 *  end epoch has begun. */
function StorageSpan({
  storage,
  state,
}: {
  storage: WalrusStorage
  state: WalrusState | null
}) {
  const status = walrusSpanStatus(state, storage.startEpoch, storage.endEpoch)
  const now = Date.now()
  return (
    <Row>
      <Label>valid</Label>
      <span
        className="text-text tabular-nums"
        title="the walrus epochs the storage covers — the blob is gone once the epoch after the last one begins"
      >
        walrus epochs {formatNumber(storage.startEpoch)} – {formatNumber(storage.endEpoch - 1)}
      </span>
      <span className="text-muted">·</span>
      {status === 'expired' ? (
        <span className="text-danger">expired at epoch {formatNumber(storage.endEpoch)}</span>
      ) : status === 'pending' ? (
        <span className="text-muted">starts at epoch {formatNumber(storage.startEpoch)}</span>
      ) : (
        <span className="text-muted">expires at epoch {formatNumber(storage.endEpoch)}</span>
      )}
      <WalrusEpochDate
        epoch={status === 'pending' ? storage.startEpoch : storage.endEpoch}
        state={state}
        now={now}
      />
    </Row>
  )
}

function Strip({ children, retired }: { children: React.ReactNode; retired: string | null }) {
  return (
    <div className="border-line bg-surface-2 mb-6 flex flex-col gap-1.5 border px-4 py-3 font-mono text-xs">
      <div className="text-muted flex flex-wrap items-center gap-2">
        <Database size={13} className="text-primary shrink-0" />
        <span className="tracking-wider uppercase">walrus</span>
        {retired && (
          <span className="text-danger">
            retired deployment — {retired}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('panel-label shrink-0', className)}>{children}</span>
}
