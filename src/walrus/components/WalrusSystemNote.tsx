import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
import { useSearchHref } from '@/components/ui/links'
import { useNetwork } from '@/context/useNetwork'
import { formatBytes, formatNumber, formatSpan, formatTokenAmount } from '@/lib/format'
import { walrusEpochRemainingMs } from '../epochs'
import { useWalrusState } from '../useWalrusState'
import { walrusDeployment } from '../registry'

/**
 * The callout atop the Walrus System / Staking objects: the Walrus epoch and
 * when it rolls, capacity in use, and the current prices — the numbers a dev
 * otherwise digs out of the versioned inner state one dynamic field down.
 * Each of the two objects links to the other.
 */
export function WalrusSystemNote({ which }: { which: 'system' | 'staking' }) {
  const { network } = useNetwork()
  const searchHref = useSearchHref()
  const d = walrusDeployment(network)
  const { state: s, loading } = useWalrusState(network)
  const remaining = walrusEpochRemainingMs(s)
  const usedPct =
    s && s.capacity.total > 0n ? Number((s.capacity.used * 10_000n) / s.capacity.total) / 100 : null
  const other = which === 'system' ? 'staking' : 'system'
  const otherId = d ? (which === 'system' ? d.stakingId : d.systemId) : null
  return (
    <div className="border-primary/40 bg-primary/5 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3 font-mono text-xs">
      <Database size={13} className="text-primary shrink-0" />
      <p className="text-muted min-w-0 flex-1 leading-relaxed">
        {which === 'system'
          ? 'The Walrus System object — committee, capacity, prices, and blob accounting. '
          : 'The Walrus Staking object — storage-node pools, the epoch clock, and committee selection. '}
        {s ? (
          <>
            Walrus epoch <span className="text-text">{formatNumber(s.epoch)}</span>
            {' · '}next epoch{' '}
            <span className="text-text" title={`epochs last ${d?.epochLength ?? '—'}; the change also needs a transaction, so this drifts late`}>
              {remaining == null ? '—' : remaining <= 0 ? '~now' : `~${formatSpan(remaining)}`}
            </span>
            {' · '}capacity{' '}
            <span className="text-text" title={`${formatNumber(s.capacity.used)} of ${formatNumber(s.capacity.total)} bytes`}>
              {formatBytes(s.capacity.used)} / {formatBytes(s.capacity.total)}
              {usedPct != null && ` (${usedPct}%)`}
            </span>
            {' · '}storage{' '}
            <span className="text-text" title={`${formatNumber(s.storagePrice)} FROST per MiB per epoch`}>
              {formatTokenAmount(s.storagePrice, 9, 'WAL')}/MiB/epoch
            </span>
            {' · '}write{' '}
            <span className="text-text" title={`${formatNumber(s.writePrice)} FROST per MiB written`}>
              {formatTokenAmount(s.writePrice, 9, 'WAL')}/MiB
            </span>
            .
          </>
        ) : loading ? (
          <span className="opacity-60">reading the epoch clock…</span>
        ) : null}
      </p>
      {otherId && (
        <Link
          to={searchHref(otherId)}
          className="text-primary shrink-0 font-semibold whitespace-nowrap hover:underline"
        >
          view {other} →
        </Link>
      )}
    </div>
  )
}
